import Cocoa
import Carbon.HIToolbox
import CoreGraphics
import Foundation

// MARK: - C ABI
//
// Every exported function is `@_cdecl` so that the resulting dylib can be
// loaded through koffi exactly like a plain C library. Strings are returned as
// malloc'd UTF-8 buffers and freed by `freeString`.

private func cString(_ value: String?) -> UnsafeMutablePointer<CChar>? {
    guard let value else { return nil }
    return strdup(value)
}

@_cdecl("freeString")
public func freeString(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}

/// Whether the process may post synthetic keyboard events.
@_cdecl("checkAccessibilityPermission")
public func checkAccessibilityPermission(_ prompt: Int32) -> Int32 {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt != 0]
    return AXIsProcessTrustedWithOptions(options as CFDictionary) ? 1 : 0
}

/// Inserts plain text into the currently focused element.
///
/// Strategy mirrors the reference implementation: prefer the pasteboard-backed
/// paste path (works in Electron, browsers and most native editors), and fall
/// back to per-character Unicode key events when the paste shortcut is
/// swallowed.
@_cdecl("insertText")
public func insertText(_ textPointer: UnsafeMutablePointer<CChar>?) -> Int32 {
    guard let textPointer else { return -1 }
    let text = String(cString: textPointer)
    guard !text.isEmpty else { return 0 }

    let pasteboard = NSPasteboard.general
    let saved = savePasteboard(pasteboard)
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)

    let pasted = simulatePasteCommand()
    if !pasted {
        typeUnicode(text)
    }

    // Restore the user's clipboard after the paste has had time to land.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
        restorePasteboard(pasteboard, from: saved)
    }
    return 0
}

@_cdecl("insertRichText")
public func insertRichText(
    _ htmlPointer: UnsafeMutablePointer<CChar>?,
    _ textPointer: UnsafeMutablePointer<CChar>?
) -> Int32 {
    guard let textPointer else { return -1 }
    let text = String(cString: textPointer)
    let html = htmlPointer.map { String(cString: $0) }

    let pasteboard = NSPasteboard.general
    let saved = savePasteboard(pasteboard)
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    if let html {
        pasteboard.setString(html, forType: .html)
    }
    let pasted = simulatePasteCommand()
    if !pasted { typeUnicode(text) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
        restorePasteboard(pasteboard, from: saved)
    }
    return 0
}

/// Deletes `count` characters backwards from the caret.
@_cdecl("deleteBackward")
public func deleteBackward(_ count: Int32) -> Int32 {
    guard count > 0 else { return 0 }
    let source = CGEventSource(stateID: .combinedSessionState)
    let keyCode = CGKeyCode(kVK_Delete)
    for _ in 0..<count {
        if let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
           let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
            down.post(tap: .cgAnnotatedSessionEventTap)
            up.post(tap: .cgAnnotatedSessionEventTap)
        }
    }
    return 0
}

/// Reads the current selection, falling back to a synthetic copy when the
/// accessibility tree does not expose it.
@_cdecl("getSelectedText")
public func getSelectedText(_ timeoutMs: Int32) -> UnsafeMutablePointer<CChar>? {
    if let viaAX = selectedTextViaAccessibility(), !viaAX.isEmpty {
        return cString(viaAX)
    }
    return cString(selectedTextViaCopy(timeoutMs: timeoutMs))
}

/// Snapshot of the caret surroundings, used to decide whether a trailing space
/// or capitalisation is needed.
@_cdecl("getCurrentInputState")
public func getCurrentInputState(_ timeoutMs: Int32) -> UnsafeMutablePointer<CChar>? {
    var payload: [String: Any] = [:]
    if let element = focusedElement() {
        var range: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &range) == .success,
           let cfRange = range, CFGetTypeID(cfRange) == AXValueGetTypeID() {
            var nsRange = CFRange()
            if AXValueGetValue(cfRange as! AXValue, .cfRange, &nsRange) {
                payload["caretLocation"] = nsRange.location
                payload["selectionLength"] = nsRange.length
            }
        }
        var role: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success {
            payload["role"] = role as? String
        }
        payload["hasFocus"] = true
    } else {
        payload["hasFocus"] = false
    }
    payload["secureInput"] = IsSecureEventInputEnabled()
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else {
        return cString("{}")
    }
    return cString(json)
}

// MARK: - Private

private struct ArchivedItem {
    let type: NSPasteboard.PasteboardType
    let data: Data
}

private func savePasteboard(_ pasteboard: NSPasteboard) -> [ArchivedItem] {
    (pasteboard.pasteboardItems ?? []).flatMap { item in
        item.types.compactMap { type in
            item.data(forType: type).map { ArchivedItem(type: type, data: $0) }
        }
    }
}

private func restorePasteboard(_ pasteboard: NSPasteboard, from items: [ArchivedItem]) {
    pasteboard.clearContents()
    guard !items.isEmpty else { return }
    let item = NSPasteboardItem()
    for archived in items {
        item.setData(archived.data, forType: archived.type)
    }
    pasteboard.writeObjects([item])
}

@discardableResult
private func simulatePasteCommand() -> Bool {
    let source = CGEventSource(stateID: .combinedSessionState)
    let flags: CGEventFlags = .maskCommand
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false) else {
        return false
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cgAnnotatedSessionEventTap)
    up.post(tap: .cgAnnotatedSessionEventTap)
    return true
}

private func typeUnicode(_ text: String) {
    let source = CGEventSource(stateID: .combinedSessionState)
    for scalar in text.unicodeScalars {
        var unit = UniChar(scalar.value & 0xFFFF)
        for isDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: isDown) else { continue }
            event.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
            event.post(tap: .cgAnnotatedSessionEventTap)
        }
    }
}

private func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
          let element = focused, CFGetTypeID(element) == AXUIElementGetTypeID() else {
        return nil
    }
    return (element as! AXUIElement)
}

private func selectedTextViaAccessibility() -> String? {
    guard let element = focusedElement() else { return nil }
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &value) == .success else {
        return nil
    }
    return value as? String
}

private func selectedTextViaCopy(timeoutMs: Int32) -> String? {
    let pasteboard = NSPasteboard.general
    let saved = savePasteboard(pasteboard)
    let marker = "sayrel-selection-\(UUID().uuidString)"
    pasteboard.clearContents()
    pasteboard.setString(marker, forType: .string)

    simulateCopyCommand()

    let deadline = Date().addingTimeInterval(Double(max(timeoutMs, 100)) / 1000)
    var result: String?
    while Date() < deadline {
        if let candidate = pasteboard.string(forType: .string), candidate != marker {
            result = candidate
            break
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    restorePasteboard(pasteboard, from: saved)
    return result
}

private func simulateCopyCommand() {
    let source = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false) else {
        return
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cgAnnotatedSessionEventTap)
    up.post(tap: .cgAnnotatedSessionEventTap)
}

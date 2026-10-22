import Cocoa
import CoreGraphics
import Foundation
import IOKit

// MARK: - C ABI

public typealias EventCallback = @convention(c) (UnsafePointer<CChar>?) -> Void
public typealias DevicesCallback = @convention(c) (UnsafePointer<CChar>?) -> Void

private var eventTap: CFMachPort?
private var runLoopSource: CFRunLoopSource?
private var callback: EventCallback?
private var targetShortcuts: Set<String> = ["Fn", "Fn+Shift", "Fn+Space"]
private var monitorRunLoop: CFRunLoop?
private var watcherIntervalMs: Int = 30
private var shortcutCaptureEnabled = false
private var capturedCombination: String?

@_cdecl("freeString")
public func freeString(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}

/// Keyboard devices visible to IOKit. Used by the settings UI to explain why a
/// shortcut may not fire (e.g. only an external keyboard is attached).
@_cdecl("getKeyboardDeviceList")
public func getKeyboardDeviceList() -> UnsafeMutablePointer<CChar>? {
    var payload: [[String: Any]] = []
    let matching = IOServiceMatching("IOHIDDevice")
    var iterator: io_iterator_t = 0
    if IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == KERN_SUCCESS {
        defer { IOObjectRelease(iterator) }
        var service = IOIteratorNext(iterator)
        while service != 0 {
            defer { IOObjectRelease(service); service = IOIteratorNext(iterator) }
            var props: Unmanaged<CFMutableDictionary>?
            if IORegistryEntryCreateCFProperties(service, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS,
               let dict = props?.takeRetainedValue() as? [String: Any] {
                let usagePage = dict["PrimaryUsagePage"] as? Int ?? 0
                let usage = dict["PrimaryUsage"] as? Int ?? 0
                guard usagePage == 0x01, usage == 0x06 else { continue }
                payload.append([
                    "product": dict["Product"] as? String ?? "Keyboard",
                    "vendorId": dict["VendorID"] as? Int ?? 0,
                    "productId": dict["ProductID"] as? Int ?? 0,
                    "transport": dict["Transport"] as? String ?? "USB",
                    "builtIn": (dict["Built-In"] as? Bool) ?? false
                ])
            }
        }
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return strdup(json)
}

/// Registers the callback invoked for every key transition the watcher cares
/// about. The callback receives a JSON object:
/// `{ "key": "Fn", "pressed": true, "combination": "Fn+Shift", "ts": 0 }`
@_cdecl("startMonitor")
public func startMonitor(_ cb: EventCallback?) -> Int32 {
    guard eventTap == nil else { return 0 }
    guard let cb else { return -1 }
    callback = cb

    let mask: CGEventMask =
        (1 << CGEventType.keyDown.rawValue) |
        (1 << CGEventType.keyUp.rawValue) |
        (1 << CGEventType.flagsChanged.rawValue) |
        (1 << CGEventType.otherMouseDown.rawValue) |
        (1 << CGEventType.otherMouseUp.rawValue)

    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: mask,
        callback: { _, type, event, _ in
            let blocked = handle(type: type, event: event)
            return blocked ? nil : Unmanaged.passUnretained(event)
        },
        userInfo: nil
    ) else {
        callback = nil
        return -1
    }

    eventTap = tap
    runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    monitorRunLoop = CFRunLoopGetCurrent()
    CFRunLoopAddSource(monitorRunLoop, runLoopSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return 0
}

@_cdecl("stopMonitor")
public func stopMonitor() -> Int32 {
    resetGesture(cancelled: true)
    shortcutCaptureEnabled = false
    capturedCombination = nil
    if let tap = eventTap {
        CGEvent.tapEnable(tap: tap, enable: false)
        if let source = runLoopSource {
            CFRunLoopRemoveSource(monitorRunLoop, source, .commonModes)
        }
    }
    eventTap = nil
    monitorRunLoop = nil
    runLoopSource = nil
    callback = nil
    return 0
}

/// Polling interval for the synthetic "is the monitor alive" check.
@_cdecl("setWatcherInterval")
public func setWatcherInterval(_ ms: Int32) -> Int32 {
    watcherIntervalMs = max(10, Int(ms))
    return Int32(watcherIntervalMs)
}

/// Replaces the shortcuts the watcher reports on.
@_cdecl("updateTargetShortcuts")
public func updateTargetShortcuts(_ jsonPointer: UnsafeMutablePointer<CChar>?) -> Int32 {
    guard let jsonPointer else { return -1 }
    let raw = String(cString: jsonPointer)
    guard let data = raw.data(using: .utf8),
          let list = try? JSONSerialization.jsonObject(with: data) as? [String] else {
        return -1
    }
    resetGesture(cancelled: true)
    targetShortcuts = Set(list.filter { !$0.isEmpty })
    return 0
}

/// Captures a new shortcut while the settings editor owns keyboard focus.
@_cdecl("setShortcutCaptureEnabled")
public func setShortcutCaptureEnabled(_ enabled: Int32) -> Int32 {
    resetGesture(cancelled: true)
    capturedCombination = nil
    shortcutCaptureEnabled = enabled != 0
    return 0
}

/// Manual reset used when a key-up is lost because the monitor was disabled by
/// the system (e.g. the tap timed out).
@_cdecl("resetPressingKeycodes")
public func resetPressingKeycodes() -> Int32 {
    resetGesture(cancelled: true)
    return 0
}

/// Drains pending events on the caller's thread. The monitor callback is
/// invoked synchronously from the tap; this exists for symmetry with the
/// reference API and is a no-op outside of a run loop spin.
@_cdecl("processEvents")
public func processEvents() -> Int32 {
    RunLoop.current.run(until: Date().addingTimeInterval(0.001))
    return 0
}

// MARK: - Private

// The active combination is latched until all keys are released. Adding a
// more specific shortcut upgrades this gesture without a fake key-up/down pair.
private var pressingKeys: Set<String> = []
private var activeCombination: String?
private var blockedKeycodes: Set<Int64> = []
private var pressingFnKeycodes: Set<Int64> = []
// macOS can append a Globe keyDown/keyUp pair after the physical Fn release.
// Prefer modifier events for keyboards that provide them; retain key events
// for keyboards that expose only Globe/Fn as a normal key.
private var fnModifierKeyboards: Set<Int64> = []

private let modifierGroups: [(CGEventFlags, String, String, Int64, Int64, UInt64, UInt64)] = [
    (.maskShift, "LeftShift", "RightShift", 56, 60, 0x2, 0x4),
    (.maskControl, "LeftControl", "RightControl", 59, 62, 0x1, 0x2000),
    (.maskAlternate, "LeftAlt", "RightAlt", 58, 61, 0x20, 0x40),
    (.maskCommand, "LeftCommand", "RightCommand", 55, 54, 0x8, 0x10)
]

private func updateModifiers(_ flags: CGEventFlags, changedKey: Int64?) {
    if !pressingFnKeycodes.isEmpty { pressingKeys.insert("Fn") }
    else { pressingKeys.remove("Fn") }
    for (mask, left, right, leftCode, rightCode, leftBit, rightBit) in modifierGroups {
        if !flags.contains(mask) {
            pressingKeys.remove(left); pressingKeys.remove(right)
        } else if flags.rawValue & (leftBit | rightBit) != 0 {
            if flags.rawValue & leftBit != 0 { pressingKeys.insert(left) }
            else { pressingKeys.remove(left) }
            if flags.rawValue & rightBit != 0 { pressingKeys.insert(right) }
            else { pressingKeys.remove(right) }
        } else if changedKey == leftCode || changedKey == rightCode {
            let name = changedKey == leftCode ? left : right
            pressingKeys.insert(name)
        } else if !pressingKeys.contains(left) && !pressingKeys.contains(right) {
            // Aggregate-only synthetic events have no side information.
            pressingKeys.insert(left)
        }
    }
}

private func canonical(_ key: String) -> String {
    switch key.lowercased() {
    case "ctrl", "control": return "Control"
    case "cmd", "command", "meta": return "Command"
    case "option", "alt": return "Alt"
    case "shift": return "Shift"
    case "fn", "globe": return "Fn"
    case "space", "spacebar": return "Space"
    case "esc", "escape": return "Escape"
    case "return", "enter": return "Enter"
    case "leftctrl", "leftcontrol": return "LeftControl"
    case "rightctrl", "rightcontrol": return "RightControl"
    case "leftcmd", "leftcommand": return "LeftCommand"
    case "rightcmd", "rightcommand": return "RightCommand"
    case "leftoption", "leftalt": return "LeftAlt"
    case "rightoption", "rightalt": return "RightAlt"
    case "leftshift": return "LeftShift"
    case "rightshift": return "RightShift"
    default: return key.count == 1 ? key.uppercased() : key
    }
}

private func generic(_ key: String) -> String {
    for (_, left, right, _, _, _, _) in modifierGroups {
        if key == left || key == right { return String(left.dropFirst(4)) }
    }
    return key
}

private func parts(_ combination: String) -> Set<String> {
    Set(combination.split(separator: "+").map { canonical(String($0)) })
}

private func matches(_ combination: String) -> Bool {
    let wanted = parts(combination)
    let actual = Set(pressingKeys.map { wanted.contains($0) ? $0 : generic($0) })
    return wanted == actual
}

private let keyNames: [Int64: String] = [
    0:"A", 1:"S", 2:"D", 3:"F", 4:"H", 5:"G", 6:"Z", 7:"X", 8:"C", 9:"V", 11:"B",
    12:"Q", 13:"W", 14:"E", 15:"R", 16:"Y", 17:"T", 18:"1", 19:"2", 20:"3", 21:"4",
    22:"6", 23:"5", 24:"=", 25:"9", 26:"7", 27:"-", 28:"8", 29:"0", 30:"]", 31:"O",
    32:"U", 33:"[", 34:"I", 35:"P", 36:"Enter", 37:"L", 38:"J", 39:"'", 40:"K",
    41:";", 42:"\\", 43:",", 44:"/", 45:"N", 46:"M", 47:".", 48:"Tab", 49:"Space",
    50:"`", 51:"Backspace", 53:"Escape", 63:"Fn", 179:"Fn", 65:"Decimal", 67:"Multiply", 69:"Add",
    71:"Clear", 75:"Divide", 76:"Enter", 78:"Subtract", 81:"=", 82:"0", 83:"1",
    84:"2", 85:"3", 86:"4", 87:"5", 88:"6", 89:"7", 91:"8", 92:"9",
    96:"F5", 97:"F6", 98:"F7", 99:"F3", 100:"F8", 101:"F9", 103:"F11", 109:"F10",
    111:"F12", 118:"F4", 120:"F2", 122:"F1", 123:"Left", 124:"Right", 125:"Down", 126:"Up"
]

private func resetGesture(cancelled: Bool) {
    if let combo = activeCombination {
        emit(key: combo, pressed: false, combination: combo, cancelled: cancelled)
    }
    activeCombination = nil
    pressingKeys.removeAll()
    blockedKeycodes.removeAll()
    pressingFnKeycodes.removeAll()
}

@discardableResult
private func handle(type: CGEventType, event: CGEvent) -> Bool {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        resetGesture(cancelled: true)
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return false
    }
    guard type == .flagsChanged || type == .keyDown || type == .keyUp || type == .otherMouseDown || type == .otherMouseUp else { return false }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    let repeated = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let wasBlocked = blockedKeycodes.contains(code)
    if type == .keyDown && repeated { return wasBlocked }
    if code == 63 || code == 179 {
        let keyboardType = event.getIntegerValueField(.keyboardEventKeyboardType)
        if type == .flagsChanged {
            fnModifierKeyboards.insert(keyboardType)
        } else if fnModifierKeyboards.contains(keyboardType) {
            return true
        }
    }
    let previousKeys = pressingKeys
    if code == 63 || code == 179 {
        if type == .keyDown { pressingFnKeycodes.insert(code) }
        else if type == .keyUp { pressingFnKeycodes.remove(code) }
        // Arrow and function keys also carry this flag; only Fn's own event
        // can change whether the physical modifier is held.
        else if type == .flagsChanged {
            if event.flags.contains(.maskSecondaryFn) { pressingFnKeycodes.insert(code) }
            else { pressingFnKeycodes.remove(code) }
        }
    }
    updateModifiers(event.flags, changedKey: type == .flagsChanged ? code : nil)
    if type != .flagsChanged && !((code == 63 || code == 179) && (type == .keyDown || type == .keyUp)) {
        let name = (type == .otherMouseDown || type == .otherMouseUp) ? "Mouse\(event.getIntegerValueField(.mouseEventButtonNumber) + 1)" : (keyNames[code] ?? "KeyCode\(code)")
        if type == .keyDown || type == .otherMouseDown { pressingKeys.insert(name) }
        else { pressingKeys.remove(name); blockedKeycodes.remove(code) }
        // Escape is observable but never swallowed when another app owns it.
        if name == "Escape" && !shortcutCaptureEnabled {
            emit(key: name, pressed: type == .keyDown, combination: name)
        }
    }
    if shortcutCaptureEnabled {
        if pressingKeys.count < previousKeys.count, let captured = capturedCombination {
            emit(key: captured, pressed: false, combination: captured, capture: true)
            capturedCombination = nil
        } else if pressingKeys.count > previousKeys.count {
            let order = ["Fn", "Command", "Control", "Alt", "Shift"]
            let keys = pressingKeys.sorted { left, right in
                let l = order.firstIndex(of: generic(left)) ?? 99, r = order.firstIndex(of: generic(right)) ?? 99
                return l == r ? left < right : l < r
            }
            capturedCombination = keys.joined(separator: "+")
            emit(key: capturedCombination!, pressed: true, combination: capturedCombination!, capture: true)
        }
        return true
    }
    if pressingKeys.isEmpty {
        if let combo = activeCombination { emit(key: combo, pressed: false, combination: combo, sourceCode: code, sourceType: type.rawValue) }
        activeCombination = nil
        return wasBlocked
    }
    let candidate = targetShortcuts.filter { matches($0) }.sorted {
        if parts($0).count != parts($1).count { return parts($0).count > parts($1).count }
        return $0 < $1
    }.first
    if let candidate, candidate != activeCombination {
        let previous = activeCombination
        // A partial release must not turn Fn+Space/Fn+Shift back into Fn.
        if previous == nil || parts(candidate).count > parts(previous!).count {
            activeCombination = candidate
            emit(key: keyNames[code] ?? candidate, pressed: true,
                 combination: candidate, replacedCombination: previous, sourceCode: code, sourceType: type.rawValue)
        }
    }
    let shouldBlock = (type == .keyDown || type == .otherMouseDown) && candidate != nil
    if shouldBlock { blockedKeycodes.insert(code) }
    return wasBlocked || shouldBlock || (type == .flagsChanged && (code == 63 || code == 179) && candidate != nil)
}

private func emit(key: String, pressed: Bool, combination: String,
                  replacedCombination: String? = nil, cancelled: Bool = false, capture: Bool = false,
                  sourceCode: Int64? = nil, sourceType: UInt32? = nil) {
    guard let callback else { return }
    var payload: [String: Any] = [
        "key": key, "pressed": pressed, "combination": combination,
        "ts": Date().timeIntervalSince1970 * 1000
    ]
    if capture { payload["capture"] = true }
    if let sourceCode { payload["sourceCode"] = sourceCode }
    if let sourceType { payload["sourceType"] = sourceType }
    if let replacedCombination { payload["replacedCombination"] = replacedCombination }
    if cancelled { payload["cancelled"] = true }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else { return }
    json.withCString { callback($0) }
}

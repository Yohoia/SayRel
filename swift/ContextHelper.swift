import Cocoa
import Carbon
import CoreGraphics
import Foundation

// MARK: - C ABI
//
// Each `get*Async` receives a C callback which is invoked once on a background
// queue with a malloc'd JSON string (freed by the caller via `freeString`).

public typealias StringCallback = @convention(c) (UnsafePointer<CChar>?) -> Void

@_cdecl("freeString")
public func freeString(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}

/// Frontmost application metadata.
@_cdecl("getFocusedAppInfoAsync")
public func getFocusedAppInfoAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .userInitiated).async {
        let info = focusedAppInfo()
        deliver(info, to: cb)
    }
}

/// Focused accessibility element: role, value, selection and bounds.
@_cdecl("getFocusedElementInfoAsync")
public func getFocusedElementInfoAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .userInitiated).async {
        deliver(focusedElementInfo(), to: cb)
    }
}

/// Text surrounding the caret inside the focused element, used to give the
/// model local context without shipping an entire document.
@_cdecl("getFocusedElementRelatedContentAsync")
public func getFocusedElementRelatedContentAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .userInitiated).async {
        deliver(focusedElementRelatedContent(), to: cb)
    }
}

/// Visible text of the focused window (best effort, capped).
@_cdecl("getFocusedVisibleTextAsync")
public func getFocusedVisibleTextAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .utility).async {
        deliver(focusedVisibleText(), to: cb)
    }
}

/// Toggles the "enhanced user interface" flag on the focused window so that
/// hidden toolbars become readable through accessibility.
@_cdecl("setFocusedWindowEnhancedUserInterface")
public func setFocusedWindowEnhancedUserInterface(_ enabled: Int32) -> Int32 {
    guard let app = NSWorkspace.shared.frontmostApplication else { return -1 }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    var windows: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windows) == .success,
          let list = windows as? [AXUIElement], let first = list.first else {
        return -1
    }
    let value = enabled != 0
    return AXUIElementSetAttributeValue(first, "AXEnhancedUserInterface" as CFString, value as CFBoolean) == .success ? 0 : -1
}

// MARK: - Private

private func deliver(_ payload: [String: Any], to cb: StringCallback) {
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    let json = String(data: data, encoding: .utf8) ?? "{}"
    json.withCString { cb($0) }
}

private func focusedAppInfo() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
    let bundleId = app.bundleIdentifier
    var result: [String: Any] = [
        "appName": app.localizedName ?? "",
        "bundleId": bundleId ?? "",
        "pid": app.processIdentifier,
        "capturedAt": Date().timeIntervalSince1970 * 1000
    ]

    // Window title (and, for browsers, the address bar value).
    if let windowInfo = focusedWindowInfo(pid: app.processIdentifier) {
        result.merge(windowInfo) { _, new in new }
    }

    if let bundleId, browserBundleIds.contains(bundleId) {
        if let url = browserURL(for: app) {
            result["webUrl"] = url
            result["webDomain"] = URL(string: url)?.host ?? ""
            if let title = result["windowTitle"] as? String, !title.isEmpty {
                result["webTitle"] = title
            }
        }
    }
    return result
}

private func focusedWindowInfo(pid: pid_t) -> [String: Any]? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for window in list {
        guard (window[kCGWindowOwnerPID as String] as? pid_t) == pid,
              (window[kCGWindowLayer as String] as? Int) == 0 else { continue }
        var result: [String: Any] = [:]
        if let title = window[kCGWindowName as String] as? String {
            result["windowTitle"] = title
        }
        if let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] {
            result["windowBounds"] = [
                "x": bounds["X"] ?? 0,
                "y": bounds["Y"] ?? 0,
                "width": bounds["Width"] ?? 0,
                "height": bounds["Height"] ?? 0
            ]
        }
        return result
    }
    return nil
}

private let browserBundleIds: Set<String> = [
    "com.google.Chrome", "com.apple.Safari", "com.microsoft.edgemac",
    "org.mozilla.firefox", "company.thebrowser.Browser", "com.brave.Browser",
    "com.google.Chrome.canary", "com.apple.SafariTechnologyPreview"
]

/// Browsers expose their address through the AX "AXURL" attribute on the
/// focused window's web area.
private func browserURL(for app: NSRunningApplication) -> String? {
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    var windows: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windows) == .success,
          let first = (windows as? [AXUIElement])?.first else { return nil }
    var url: CFTypeRef?
    if AXUIElementCopyAttributeValue(first, "AXURL" as CFString, &url) == .success {
        if let u = url as? URL { return u.absoluteString }
        if let s = url as? String { return s }
    }
    return nil
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

private func focusedElementInfo() -> [String: Any] {
    guard let element = focusedElement() else { return ["hasFocus": false] }
    var result: [String: Any] = ["hasFocus": true]

    func read(_ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
    }

    if let role = read(kAXRoleAttribute) as? String { result["role"] = role }
    if let subrole = read(kAXSubroleAttribute) as? String { result["subrole"] = subrole }
    if let placeholder = read(kAXPlaceholderValueAttribute) as? String { result["placeholder"] = placeholder }
    if let value = read(kAXValueAttribute) as? String { result["valuePreview"] = String(value.prefix(2000)) }
    if let selected = read(kAXSelectedTextAttribute) as? String {
        result["selectedText"] = String(selected.prefix(4000))
    }
    if let title = read(kAXTitleAttribute) as? String { result["title"] = title }

    var position: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
       let pos = position, CFGetTypeID(pos) == AXValueGetTypeID() {
        var point = CGPoint.zero
        if AXValueGetValue(pos as! AXValue, .cgPoint, &point) {
            var size: CFTypeRef?
            var dimensions = CGSize.zero
            if AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
               let sz = size, CFGetTypeID(sz) == AXValueGetTypeID() {
                AXValueGetValue(sz as! AXValue, .cgSize, &dimensions)
            }
            result["bounds"] = [
                "x": point.x, "y": point.y,
                "width": dimensions.width, "height": dimensions.height
            ]
        }
    }

    var secure: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, "AXSecureTextField" as CFString, &secure) == .success {
        result["isSecure"] = (secure as? Bool) ?? false
    }
    result["secureInput"] = IsSecureEventInputEnabled()
    return result
}

private func focusedElementRelatedContent() -> [String: Any] {
    guard let element = focusedElement() else { return [:] }
    var result: [String: Any] = [:]

    func read(_ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    if let selected = read(kAXSelectedTextAttribute) { result["selectedText"] = String(selected.prefix(8000)) }
    if let value = read(kAXValueAttribute) { result["value"] = String(value.prefix(8000)) }
    if let marker = read("AXSelectedTextMarkerRange"), let before = read("AXTextMarkerRange") {
        result["markerRange"] = marker
        result["textMarkerRange"] = before
    }
    return result
}

private func focusedVisibleText() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    var windows: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windows) == .success,
          let list = windows as? [AXUIElement], let window = list.first else {
        return ["visibleText": ""]
    }
    var collected: [String] = []
    func walk(_ element: AXUIElement, depth: Int) {
        guard depth < 12, collected.reduce(0, { $0 + $1.count }) < 20_000 else { return }
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
           let text = value as? String, !text.isEmpty {
            collected.append(text)
        }
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
           let kids = children as? [AXUIElement] {
            for child in kids.prefix(40) { walk(child, depth: depth + 1) }
        }
    }
    walk(window, depth: 0)
    return ["visibleText": collected.prefix(40).joined(separator: "\n")]
}

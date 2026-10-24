"""Replay actual Swift key handling without a system event tap or keyboard input."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
TAIL = r'''
private var auditEvents: [String] = []
private var auditReplacements: [String] = []
callback = { pointer in
    guard let pointer, let data = String(cString: pointer).data(using: .utf8),
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    auditEvents.append("\(value["combination"]!) \((value["pressed"] as? Bool) == true ? "down" : "up")\((value["cancelled"] as? Bool) == true ? " cancelled" : "")")
    if let previous = value["replacedCombination"] as? String { auditReplacements.append(previous) }
}
func replay(_ type: CGEventType, _ code: Int64, _ flags: CGEventFlags, repeatKey: Bool = false, keyboardType: Int64 = 0) -> Bool {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: type != .keyUp)!
    event.flags = flags
    event.setIntegerValueField(.keyboardEventKeycode, value: code)
    event.setIntegerValueField(.keyboardEventAutorepeat, value: repeatKey ? 1 : 0)
    event.setIntegerValueField(.keyboardEventKeyboardType, value: keyboardType)
    return handle(type: type, event: event)
}
func check(_ name: String, _ expected: [String], _ body: () -> Void) {
    resetGesture(cancelled: true); fnModifierKeyboards.removeAll(); auditEvents.removeAll(); auditReplacements.removeAll()
    body()
    precondition(auditEvents == expected, "FAIL \(name): \(auditEvents)")
    print("PASS \(name): \(auditEvents)"); fflush(stdout)
}
for (code, name) in [(Int64(123), "Left"), (124, "Right"), (125, "Down"), (126, "Up")] {
    check("\(name) never synthesizes Fn on release", []) {
        let flags: CGEventFlags = [.maskSecondaryFn, .maskNumericPad]
        precondition(!replay(.keyDown, code, flags), "arrow keydown must reach the focused app")
        precondition(!replay(.keyDown, code, flags, repeatKey: true), "arrow repeat must reach the focused app")
        precondition(!replay(.keyUp, code, flags), "arrow keyup must reach the focused app")
    }
    check("Shift+\(name) never starts translation", []) {
        _ = replay(.flagsChanged, 56, .maskShift)
        let flags: CGEventFlags = [.maskSecondaryFn, .maskNumericPad, .maskShift]
        precondition(!replay(.keyDown, code, flags))
        precondition(!replay(.keyUp, code, flags))
        _ = replay(.flagsChanged, 56, [])
    }
}
for code in [Int64(122), 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 115, 119, 116, 121, 117] {
    check("function/navigation key \(code) never synthesizes Fn", []) {
        precondition(!replay(.keyDown, code, .maskSecondaryFn))
        precondition(!replay(.keyUp, code, .maskSecondaryFn))
    }
}
for fnFirst in [true, false] {
    for fnReleasedFirst in [true, false] {
        check("Fn+Shift order \(fnFirst)/\(fnReleasedFirst)", fnFirst ? ["Fn down", "Fn+Shift down", "Fn+Shift up"] : ["Fn+Shift down", "Fn+Shift up"]) {
            _ = replay(.flagsChanged, fnFirst ? 63 : 56, fnFirst ? .maskSecondaryFn : .maskShift)
            _ = replay(.flagsChanged, fnFirst ? 56 : 63, [.maskSecondaryFn, .maskShift])
            _ = replay(.flagsChanged, fnReleasedFirst ? 63 : 56, fnReleasedFirst ? .maskShift : .maskSecondaryFn)
            _ = replay(.flagsChanged, fnReleasedFirst ? 56 : 63, [])
            if fnFirst { precondition(auditReplacements == ["Fn"]) }
        }
    }
}
for fnFirst in [true, false] {
    for fnReleasedFirst in [true, false] {
        check("Fn+Space order \(fnFirst)/\(fnReleasedFirst)", fnFirst ? ["Fn down", "Fn+Space down", "Fn+Space up"] : ["Fn+Space down", "Fn+Space up"]) {
            if fnFirst {
                _ = replay(.flagsChanged, 63, .maskSecondaryFn)
                precondition(replay(.keyDown, 49, .maskSecondaryFn))
            } else {
                _ = replay(.keyDown, 49, [])
                _ = replay(.flagsChanged, 63, .maskSecondaryFn)
            }
            if fnReleasedFirst {
                _ = replay(.flagsChanged, 63, [])
                _ = replay(.keyUp, 49, [])
            } else {
                _ = replay(.keyUp, 49, .maskSecondaryFn)
                _ = replay(.flagsChanged, 63, [])
            }
        }
    }
}
check("nonmodifier flags do not hide release", ["Fn down", "Fn up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.flagsChanged, 63, .maskNonCoalesced)
}
for (code, name) in [(Int64(123), "Left"), (124, "Right"), (125, "Down"), (126, "Up")] {
    check("real Fn stays held across \(name) without repeated Fn edges", ["Fn down", "Fn up"]) {
        _ = replay(.flagsChanged, 63, .maskSecondaryFn)
        precondition(!replay(.keyDown, code, []))
        precondition(!replay(.keyUp, code, .maskSecondaryFn))
        precondition(auditEvents == ["Fn down"], "arrow release must not release a held Fn")
        _ = replay(.flagsChanged, 63, [])
    }
    check("\(name) cannot restore Fn after its physical release", ["Fn down", "Fn up"]) {
        _ = replay(.flagsChanged, 63, .maskSecondaryFn)
        precondition(!replay(.keyDown, code, .maskSecondaryFn))
        _ = replay(.flagsChanged, 63, [])
        precondition(!replay(.keyUp, code, .maskSecondaryFn))
    }
}
check("repeated space does not retrigger", ["Fn down", "Fn+Space down", "Fn+Space up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.keyDown, 49, .maskSecondaryFn)
    precondition(replay(.keyDown, 49, .maskSecondaryFn, repeatKey: true))
    precondition(replay(.keyUp, 49, .maskSecondaryFn))
    _ = replay(.flagsChanged, 63, [])
}
check("tap timeout cancels active gesture", ["Fn down", "Fn up cancelled"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.tapDisabledByTimeout, 0, [])
}
targetShortcuts = ["RightShift"]
check("right-specific binding", ["RightShift down", "RightShift up"]) {
    _ = replay(.flagsChanged, 56, CGEventFlags(rawValue: CGEventFlags.maskShift.rawValue | 0x2))
    _ = replay(.flagsChanged, 56, [])
    _ = replay(.flagsChanged, 60, CGEventFlags(rawValue: CGEventFlags.maskShift.rawValue | 0x4))
    _ = replay(.flagsChanged, 60, [])
}
targetShortcuts = ["Fn"]
_ = setShortcutCaptureEnabled(1)
for (code, name) in [(Int64(123), "Left"), (124, "Right"), (125, "Down"), (126, "Up")] {
    check("shortcut editor captures \(name) without a phantom Fn modifier", ["\(name) down", "\(name) up"]) {
        _ = replay(.keyDown, code, [.maskSecondaryFn, .maskNumericPad])
        _ = replay(.keyUp, code, [.maskSecondaryFn, .maskNumericPad])
    }
}
check("shortcut editor captures a new Fn chord on first release", ["Fn down", "Fn+K down", "Fn+K up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.keyDown, 40, .maskSecondaryFn)
    _ = replay(.keyUp, 40, .maskSecondaryFn)
    _ = replay(.flagsChanged, 63, [])
}
for code in [Int64(63), Int64(179)] {
    check("Fn keydown/up code \(code)", ["Fn down", "Fn up"]) {
        _ = replay(.keyDown, code, [])
        _ = replay(.keyUp, code, [])
    }
    check("Fn chord with omitted flags code \(code)", ["Fn down", "Fn+Space down", "Fn+Space up"]) {
        _ = replay(.keyDown, code, [])
        _ = replay(.keyDown, 49, [])
        _ = replay(.keyUp, 49, [])
        _ = replay(.keyUp, code, [])
    }
}
check("Fn duplicate Globe and modifier events", ["Fn down", "Fn up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.keyDown, 179, .maskSecondaryFn)
    _ = replay(.keyUp, 179, [])
    _ = replay(.flagsChanged, 63, [])
}
check("Globe events emitted after Fn release do not finish a single tap", ["Fn down", "Fn up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn, keyboardType: 40)
    _ = replay(.flagsChanged, 63, [], keyboardType: 40)
    _ = replay(.keyDown, 179, [], keyboardType: 40)
    _ = replay(.keyUp, 179, [], keyboardType: 40)
}
check("two physical Fn taps remain two gestures despite Globe echoes", ["Fn down", "Fn up", "Fn down", "Fn up"]) {
    for _ in 0..<2 {
        _ = replay(.flagsChanged, 63, .maskSecondaryFn, keyboardType: 40)
        _ = replay(.flagsChanged, 63, [], keyboardType: 40)
        _ = replay(.keyDown, 179, [], keyboardType: 40)
        _ = replay(.keyUp, 179, [], keyboardType: 40)
    }
}
check("external Globe-only keyboard still works after built-in Fn", ["Fn down", "Fn up", "Fn down", "Fn up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn, keyboardType: 40)
    _ = replay(.flagsChanged, 63, [], keyboardType: 40)
    _ = replay(.keyDown, 179, [], keyboardType: 41)
    _ = replay(.keyUp, 179, [], keyboardType: 41)
}
check("capture retains left Shift", ["LeftShift down", "LeftShift up"]) {
    _ = replay(.flagsChanged, 56, CGEventFlags(rawValue: CGEventFlags.maskShift.rawValue | 0x2))
    _ = replay(.flagsChanged, 56, [])
}
check("capture retains right Shift", ["RightShift down", "RightShift up"]) {
    _ = replay(.flagsChanged, 60, CGEventFlags(rawValue: CGEventFlags.maskShift.rawValue | 0x4))
    _ = replay(.flagsChanged, 60, [])
}
_ = setShortcutCaptureEnabled(0)
check("Globe keydown works after capturing", ["Fn down", "Fn up"]) {
    _ = replay(.keyDown, 179, [])
    _ = replay(.keyUp, 179, [])
}
check("leaving shortcut editor restores normal shortcut matching", ["Fn down", "Fn up"]) {
    _ = replay(.flagsChanged, 63, .maskSecondaryFn)
    _ = replay(.flagsChanged, 63, [])
    _ = replay(.keyDown, 40, [])
    _ = replay(.keyUp, 40, [])
}
'''
with tempfile.TemporaryDirectory(prefix="sayrel-hotkey-audit-") as directory:
    temp = Path(directory)
    source = temp / "main.swift"
    source.write_text((ROOT / "swift/KeyboardHelper.swift").read_text() + "\n" + TAIL)
    subprocess.run(["swift", "-module-cache-path", str(ROOT / ".build/modulecache"), str(source)], check=True)

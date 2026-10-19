import Cocoa
import CoreAudio
import CoreGraphics
import Foundation
import IOKit
import IOKit.pwr_mgt

public typealias StringCallback = @convention(c) (UnsafePointer<CChar>?) -> Void

@_cdecl("freeString")
public func freeString(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}

@_cdecl("checkAccessibilityPermission")
public func checkAccessibilityPermission(_ prompt: Int32) -> Int32 {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt != 0]
    return AXIsProcessTrustedWithOptions(options as CFDictionary) ? 1 : 0
}

/// Whether the laptop lid is closed; used to skip the built-in microphone.
@_cdecl("deviceIsLidOpen")
public func deviceIsLidOpen() -> Int32 {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    guard service != 0 else { return 1 }
    defer { IOObjectRelease(service) }
    let property = IORegistryEntryCreateCFProperty(service, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0)
    guard let value = property?.takeRetainedValue() as? Bool else { return 1 }
    return value ? 0 : 1
}

@_cdecl("deviceIsLidOpenAsync")
public func deviceIsLidOpenAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .userInitiated).async {
        let payload: [String: Any] = ["lidOpen": deviceIsLidOpen() == 1]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        json.withCString { cb($0) }
    }
}

/// Stable, non-identifying device id derived from the platform UUID.
@_cdecl("getDeviceId")
public func getDeviceId() -> UnsafeMutablePointer<CChar>? {
    let platform = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
    guard platform != 0 else { return nil }
    defer { IOObjectRelease(platform) }
    let property = IORegistryEntryCreateCFProperty(platform, kIOPlatformUUIDKey as CFString, kCFAllocatorDefault, 0)
    guard let uuid = property?.takeRetainedValue() as? String else { return nil }
    return strdup(uuid)
}

/// Every input device CoreAudio currently exposes, as JSON.
@_cdecl("getAudioDevicesJSON")
public func getAudioDevicesJSON() -> UnsafeMutablePointer<CChar>? {
    let devices = audioDevices()
    guard let data = try? JSONSerialization.data(withJSONObject: devices),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return strdup(json)
}

@_cdecl("getAudioDevicesJSONAsync")
public func getAudioDevicesJSONAsync(_ cb: StringCallback?) {
    guard let cb else { return }
    DispatchQueue.global(qos: .userInitiated).async {
        let json = getAudioDevicesJSON().map { String(cString: $0) } ?? "[]"
        json.withCString { cb($0) }
    }
}

/// Whether the system output is muted, so the app can duck playback while
/// recording.
@_cdecl("isAudioMuted")
public func isAudioMuted() -> Int32 {
    guard let device = defaultOutputDevice() else { return 0 }
    return outputMuted(device) ? 1 : 0
}

private var mutedDevices: [AudioDeviceID] = []

@_cdecl("muteAudio")
public func muteAudio() -> Int32 {
    guard let device = defaultOutputDevice() else { return -1 }
    if outputMuted(device) { return 0 }
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyMute,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 1
    let status = AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
    if status == noErr { mutedDevices.append(device) }
    return status == noErr ? 0 : Int32(status)
}

@_cdecl("unmuteAudio")
public func unmuteAudio() -> Int32 {
    guard let device = defaultOutputDevice() else { return -1 }
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyMute,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    let status = AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
    return status == noErr ? 0 : Int32(status)
}

/// Opens an application by display name, e.g. `launchApplicationByName("Slack")`.
@_cdecl("launchApplicationByName")
public func launchApplicationByName(_ pointer: UnsafeMutablePointer<CChar>?) -> Int32 {
    guard let pointer else { return -1 }
    let name = String(cString: pointer)
    guard !name.isEmpty else { return -1 }
    let config = NSWorkspace.OpenConfiguration()
    var launched = false
    let semaphore = DispatchSemaphore(value: 0)
    let candidates = [
        name,
        name.hasSuffix(".app") ? name : "\(name).app"
    ]
    for candidate in candidates {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: candidate) {
            NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in semaphore.signal() }
            launched = true
            break
        }
    }
    if launched { _ = semaphore.wait(timeout: .now() + 2) }
    return launched ? 0 : -1
}

// MARK: - CoreAudio helpers

private func defaultOutputDevice() -> AudioDeviceID? {
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    return status == noErr ? device : nil
}

private func outputMuted(_ device: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyMute,
        mScope: kAudioDevicePropertyScopeOutput,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value)
    return status == noErr && value != 0
}

private func audioDevices() -> [[String: Any]] {
    var size = UInt32(0)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else {
        return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else {
        return []
    }
    let defaultInput = defaultInputDevice()
    return ids.compactMap { id in
        guard inputChannelCount(id) > 0 else { return nil }
        return [
            "deviceId": deviceUID(id) ?? String(id),
            "label": deviceName(id) ?? "Input \(id)",
            "isDefault": id == defaultInput,
            "transport": transportName(transportType(id))
        ]
    }
}

private func defaultInputDevice() -> AudioDeviceID? {
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    return AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr ? device : nil
}

private func stringProperty(_ device: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &value) { ptr in
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, ptr)
    }
    return status == noErr ? (value as String) : nil
}

private func deviceName(_ device: AudioDeviceID) -> String? {
    stringProperty(device, kAudioObjectPropertyName)
}

private func deviceUID(_ device: AudioDeviceID) -> String? {
    stringProperty(device, kAudioDevicePropertyDeviceUID)
}

private func transportType(_ device: AudioDeviceID) -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyTransportType,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value)
    return status == noErr ? value : 0
}

private func transportName(_ type: UInt32) -> String {
    switch type {
    case kAudioDeviceTransportTypeBuiltIn: return "builtin"
    case kAudioDeviceTransportTypeBluetooth: return "bluetooth"
    case kAudioDeviceTransportTypeUSB: return "usb"
    case kAudioDeviceTransportTypeAggregate: return "aggregate"
    case kAudioDeviceTransportTypeVirtual: return "virtual"
    default: return "other"
    }
}

private func inputChannelCount(_ device: AudioDeviceID) -> Int {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioObjectPropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain
    )
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr else { return 0 }
    let bufferList = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer { bufferList.deallocate() }
    guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, bufferList) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(bufferList.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

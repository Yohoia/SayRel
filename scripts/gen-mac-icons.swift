import AppKit
import CryptoKit

let root = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("resources/build/icon.png")
let sourceImage = NSImage(data: try Data(contentsOf: source))!
let build = root.appendingPathComponent("resources/build")
let iconset = root.appendingPathComponent(".build/mac-icons/Sayrel.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

// Fixed V2 already includes the 100px inset. Scale the complete canvas once.
func render(size: Int) throws -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    sourceImage.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
                     from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}

let dock = build.appendingPathComponent("mac-icon.png")
try render(size: 1024).write(to: dock)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        try render(size: size * scale).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
let compiler = Process()
compiler.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
compiler.arguments = ["-c", "icns", iconset.path, "-o", build.appendingPathComponent("icon.icns").path]
try compiler.run()
compiler.waitUntilExit()
guard compiler.terminationStatus == 0 else { fatalError("iconutil failed") }

let manifestURL = root.appendingPathComponent("public/assets/brand/manifest.json")
var manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as! [String: Any]
var assets = manifest["assets"] as! [[String: Any]]
for path in ["resources/build/mac-icon.png", "resources/build/icon.icns"] {
    let data = try Data(contentsOf: root.appendingPathComponent(path))
    let asset: [String: Any] = [
        "path": path, "source": "application-icons/png/1024x1024.png",
        "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
        "bytes": data.count, "pixels": [1024, 1024],
        "transform": ["generator": "scripts/gen-mac-icons.swift", "canvas": 1024, "artwork": 824, "padding": 100, "sourceIncludesPadding": true]
    ]
    if let index = assets.firstIndex(where: { $0["path"] as? String == path }) { assets[index] = asset }
    else { assets.append(asset) }
}
manifest["assets"] = assets
try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]).write(to: manifestURL)
print("Generated macOS Dock PNG and ICNS with 100px transparent margins on a 1024px canvas")

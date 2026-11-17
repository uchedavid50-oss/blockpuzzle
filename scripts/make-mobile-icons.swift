// Rebuild the native launcher icons from the existing web logo. Run on macOS:
// swift scripts/make-mobile-icons.swift [repository-root]
import CoreGraphics
import Foundation
import ImageIO

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("public/icon-512.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Cannot read public/icon-512.png")
}

func icon(_ size: Int, inset: CGFloat = 0, path: String) throws {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
            bytesPerRow: size * 4, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        throw NSError(domain: "BunblocksIcons", code: 1)
    }
    context.setFillColor(CGColor(colorSpace: space, components: [20.0 / 255, 22.0 / 255, 28.0 / 255, 1])!)
    context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    context.interpolationQuality = .high
    let margin = CGFloat(size) * inset
    context.draw(logo, in: CGRect(x: margin, y: margin,
        width: CGFloat(size) - 2 * margin, height: CGFloat(size) - 2 * margin))
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(root.appendingPathComponent(path) as CFURL,
            "public.png" as CFString, 1, nil) else {
        throw NSError(domain: "BunblocksIcons", code: 2)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "BunblocksIcons", code: 3) }
}

for (density, size) in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)] {
    for name in ["ic_launcher", "ic_launcher_round"] {
        try icon(size, path: "android/app/src/main/res/mipmap-\(density)/\(name).png")
    }
    // Keep every corner of the existing mark inside Android's 66dp circular safe region.
    try icon(size * 108 / 48, inset: 0.20,
        path: "android/app/src/main/res/mipmap-\(density)/ic_launcher_foreground.png")
}
try icon(1024, path: "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
print("Native icons generated from public/icon-512.png")

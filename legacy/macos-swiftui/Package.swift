// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Rackbook",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Rackbook", path: "Sources/Rackbook")
    ]
)

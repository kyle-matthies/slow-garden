// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SlowGardenCore",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "SlowGardenCore", targets: ["SlowGardenCore"]),
        .executable(name: "SlowGardenCoreChecks", targets: ["SlowGardenCoreChecks"]),
    ],
    targets: [
        .target(
            name: "SlowGardenCore",
            swiftSettings: [
                .define("SLOW_GARDEN_SWIFTDATA", .when(platforms: [.iOS])),
            ]
        ),
        .executableTarget(name: "SlowGardenCoreChecks", dependencies: ["SlowGardenCore"]),
        .testTarget(name: "SlowGardenCoreTests", dependencies: ["SlowGardenCore"]),
    ]
)

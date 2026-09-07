# Slow Garden for iPhone

The native client is a preserved local prototype. The current dogfood target is
[slowgarden.app](https://slowgarden.app), per ADR-006. This prototype contains:

- `SlowGarden.xcodeproj`: iPhone app and UI-test targets.
- `SlowGardenApp`: SwiftUI Meadow and Cabinet experience.
- `SlowGardenCore`: local Swift package containing the domain, SwiftData adapter, outbox, deterministic tending engine, and portable behavior checks.

## Prerequisite

Install the latest stable full Xcode, select it with `xcode-select`, and install an iOS simulator runtime. Command Line Tools alone can build the portable core but do not include the SwiftData macro plug-in or simulator tooling.

## Verification

Portable checks available without full Xcode:

```sh
swift build --package-path applications/ios/SlowGardenCore
swift run --package-path applications/ios/SlowGardenCore SlowGardenCoreChecks
```

After Xcode is installed:

```sh
xcodebuild -project applications/ios/SlowGarden.xcodeproj -scheme SlowGarden -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

The UI test launches with an ephemeral local repository and a zero-second test clock. The normal app always uses the protected SwiftData store and a five-minute delay.

## Reconciled native work — 2026-09-07

Named seeds and proposed connection metadata are preserved. The scope picker is
disabled: the v1 deterministic fixture still selects three garden seeds and does not
enforce plot/seed permissions. It sends no material to a model or hosted service.
SwiftData fields have legacy defaults, but store migration, UI, and device behavior
require full-Xcode validation before a native release.

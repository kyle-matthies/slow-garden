import Foundation

public protocol GardenClock: Sendable {
    var now: Date { get }
}

public struct SystemGardenClock: GardenClock {
    public init() {}
    public var now: Date { Date() }
}

public final class MutableGardenClock: GardenClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    public init(now: Date) {
        value = now
    }

    public var now: Date {
        lock.withLock { value }
    }

    public func advance(by interval: TimeInterval) {
        lock.withLock { value = value.addingTimeInterval(interval) }
    }
}

public protocol GardenIdentifierGenerator: Sendable {
    func next() -> UUID
}

public struct RandomGardenIdentifierGenerator: GardenIdentifierGenerator {
    public init() {}
    public func next() -> UUID { UUID() }
}

public final class SequenceGardenIdentifierGenerator: GardenIdentifierGenerator, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [UUID]

    public init(values: [UUID]) {
        self.values = values
    }

    public func next() -> UUID {
        lock.withLock {
            precondition(!values.isEmpty, "SequenceGardenIdentifierGenerator exhausted")
            return values.removeFirst()
        }
    }
}

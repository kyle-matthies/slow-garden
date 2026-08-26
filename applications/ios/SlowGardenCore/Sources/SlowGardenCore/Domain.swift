import Foundation
#if SLOW_GARDEN_SWIFTDATA
import SwiftData
#endif

public enum GardenStatus: String, Codable, CaseIterable, Sendable {
    case active
    case archived
}

public enum SeedStatus: String, Codable, CaseIterable, Sendable {
    case active
    case archived
}

public enum GardenPassStatus: String, Codable, CaseIterable, Sendable {
    case queued
    case processing
    case complete
    case failed
    case cancelled
}

public enum BloomStatus: String, Codable, CaseIterable, Sendable {
    case new
    case viewed
    case kept
    case corrected
    case pruned
}

public enum BloomResponseKind: String, Codable, CaseIterable, Sendable {
    case kept
    case corrected
    case pruned
}

public enum OutboxState: String, Codable, CaseIterable, Sendable {
    case localPending = "local_pending"
    case acknowledged
}

#if SLOW_GARDEN_SWIFTDATA
@Model
public final class GardenRecord {
    @Attribute(.unique) public var id: UUID
    public var name: String
    public var statusRaw: String
    public var createdAt: Date
    public var modifiedAt: Date

    public init(id: UUID, name: String, status: GardenStatus = .active, createdAt: Date) {
        self.id = id
        self.name = name
        self.statusRaw = status.rawValue
        self.createdAt = createdAt
        self.modifiedAt = createdAt
    }

    public var status: GardenStatus {
        get { GardenStatus(rawValue: statusRaw) ?? .active }
        set { statusRaw = newValue.rawValue }
    }
}

@Model
public final class SeedRecord {
    @Attribute(.unique) public var id: UUID
    public var gardenID: UUID
    public var statusRaw: String
    public var currentRevisionID: UUID
    public var createdAt: Date
    public var modifiedAt: Date

    public init(id: UUID, gardenID: UUID, currentRevisionID: UUID, createdAt: Date) {
        self.id = id
        self.gardenID = gardenID
        self.statusRaw = SeedStatus.active.rawValue
        self.currentRevisionID = currentRevisionID
        self.createdAt = createdAt
        self.modifiedAt = createdAt
    }

    public var status: SeedStatus {
        get { SeedStatus(rawValue: statusRaw) ?? .active }
        set { statusRaw = newValue.rawValue }
    }
}

@Model
public final class SeedRevisionRecord {
    @Attribute(.unique) public var id: UUID
    public var gardenID: UUID
    public var seedID: UUID
    public var revisionNumber: Int
    public var text: String
    public var createdAt: Date

    public init(id: UUID, gardenID: UUID, seedID: UUID, revisionNumber: Int, text: String, createdAt: Date) {
        self.id = id
        self.gardenID = gardenID
        self.seedID = seedID
        self.revisionNumber = revisionNumber
        self.text = text
        self.createdAt = createdAt
    }
}

@Model
public final class GardenPassRecord {
    @Attribute(.unique) public var id: UUID
    public var gardenID: UUID
    public var requestedAt: Date
    public var dueAt: Date
    public var completedAt: Date?
    public var statusRaw: String
    public var workflowVersion: String
    public var failureCode: String?

    public init(id: UUID, gardenID: UUID, requestedAt: Date, dueAt: Date, workflowVersion: String) {
        self.id = id
        self.gardenID = gardenID
        self.requestedAt = requestedAt
        self.dueAt = dueAt
        self.statusRaw = GardenPassStatus.queued.rawValue
        self.workflowVersion = workflowVersion
    }

    public var status: GardenPassStatus {
        get { GardenPassStatus(rawValue: statusRaw) ?? .failed }
        set { statusRaw = newValue.rawValue }
    }
}

@Model
public final class SnapshotItemRecord {
    @Attribute(.unique) public var id: UUID
    public var passID: UUID
    public var gardenID: UUID
    public var seedID: UUID
    public var seedRevisionID: UUID
    public var ordinal: Int

    public init(id: UUID, passID: UUID, gardenID: UUID, seedID: UUID, seedRevisionID: UUID, ordinal: Int) {
        self.id = id
        self.passID = passID
        self.gardenID = gardenID
        self.seedID = seedID
        self.seedRevisionID = seedRevisionID
        self.ordinal = ordinal
    }
}

@Model
public final class BloomRecord {
    @Attribute(.unique) public var id: UUID
    public var passID: UUID
    public var gardenID: UUID
    public var title: String
    public var summary: String
    public var uncertainty: String
    public var statusRaw: String
    public var createdAt: Date

    public init(id: UUID, passID: UUID, gardenID: UUID, title: String, summary: String, uncertainty: String, createdAt: Date) {
        self.id = id
        self.passID = passID
        self.gardenID = gardenID
        self.title = title
        self.summary = summary
        self.uncertainty = uncertainty
        self.statusRaw = BloomStatus.new.rawValue
        self.createdAt = createdAt
    }

    public var status: BloomStatus {
        get { BloomStatus(rawValue: statusRaw) ?? .new }
        set { statusRaw = newValue.rawValue }
    }
}

@Model
public final class BloomClaimRecord {
    @Attribute(.unique) public var id: UUID
    public var bloomID: UUID
    public var gardenID: UUID
    public var text: String

    public init(id: UUID, bloomID: UUID, gardenID: UUID, text: String) {
        self.id = id
        self.bloomID = bloomID
        self.gardenID = gardenID
        self.text = text
    }
}

@Model
public final class EvidenceLinkRecord {
    @Attribute(.unique) public var id: UUID
    public var claimID: UUID
    public var bloomID: UUID
    public var gardenID: UUID
    public var seedID: UUID
    public var seedRevisionID: UUID
    public var excerpt: String
    public var ordinal: Int

    public init(id: UUID, claimID: UUID, bloomID: UUID, gardenID: UUID, seedID: UUID, seedRevisionID: UUID, excerpt: String, ordinal: Int) {
        self.id = id
        self.claimID = claimID
        self.bloomID = bloomID
        self.gardenID = gardenID
        self.seedID = seedID
        self.seedRevisionID = seedRevisionID
        self.excerpt = excerpt
        self.ordinal = ordinal
    }
}

@Model
public final class BloomResponseRecord {
    @Attribute(.unique) public var id: UUID
    public var bloomID: UUID
    public var gardenID: UUID
    public var kindRaw: String
    public var note: String?
    public var createdAt: Date

    public init(id: UUID, bloomID: UUID, gardenID: UUID, kind: BloomResponseKind, note: String?, createdAt: Date) {
        self.id = id
        self.bloomID = bloomID
        self.gardenID = gardenID
        self.kindRaw = kind.rawValue
        self.note = note
        self.createdAt = createdAt
    }

    public var kind: BloomResponseKind {
        get { BloomResponseKind(rawValue: kindRaw) ?? .corrected }
        set { kindRaw = newValue.rawValue }
    }
}

@Model
public final class OutboxMutationRecord {
    @Attribute(.unique) public var id: UUID
    @Attribute(.unique) public var idempotencyKey: String
    public var entityType: String
    public var entityID: UUID
    public var operation: String
    public var baseRevisionID: UUID?
    public var stateRaw: String
    public var createdAt: Date

    public init(id: UUID, idempotencyKey: String, entityType: String, entityID: UUID, operation: String, baseRevisionID: UUID?, createdAt: Date) {
        self.id = id
        self.idempotencyKey = idempotencyKey
        self.entityType = entityType
        self.entityID = entityID
        self.operation = operation
        self.baseRevisionID = baseRevisionID
        self.stateRaw = OutboxState.localPending.rawValue
        self.createdAt = createdAt
    }

    public var state: OutboxState {
        get { OutboxState(rawValue: stateRaw) ?? .localPending }
        set { stateRaw = newValue.rawValue }
    }
}
#endif

public struct GardenSummary: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let status: GardenStatus
    public let createdAt: Date
    public let modifiedAt: Date
}

public struct SeedSnapshot: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let gardenID: UUID
    public let revisionID: UUID
    public let revisionNumber: Int
    public let text: String
    public let createdAt: Date
    public let modifiedAt: Date
}

public struct GardenPassSnapshot: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let gardenID: UUID
    public let requestedAt: Date
    public let dueAt: Date
    public let status: GardenPassStatus
    public let workflowVersion: String
    public let seedRevisionIDs: [UUID]
}

public struct BloomSummary: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let gardenID: UUID
    public let title: String
    public let status: BloomStatus
    public let createdAt: Date
}

public struct EvidenceSnapshot: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let seedID: UUID
    public let seedRevisionID: UUID
    public let revisionNumber: Int
    public let excerpt: String
    public let sourceText: String
    public let sourceCreatedAt: Date
    public let isEarlierVersion: Bool
}

public struct BloomDetail: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let gardenID: UUID
    public let title: String
    public let summary: String
    public let uncertainty: String
    public let status: BloomStatus
    public let createdAt: Date
    public let claim: String
    public let evidence: [EvidenceSnapshot]
    public let latestResponse: BloomResponseKind?

    public var isStale: Bool { evidence.contains(where: \.isEarlierVersion) }
}

public struct BloomDraft: Equatable, Sendable {
    public struct Evidence: Equatable, Sendable {
        public let seedID: UUID
        public let seedRevisionID: UUID
        public let excerpt: String

        public init(seedID: UUID, seedRevisionID: UUID, excerpt: String) {
            self.seedID = seedID
            self.seedRevisionID = seedRevisionID
            self.excerpt = excerpt
        }
    }

    public let title: String
    public let summary: String
    public let uncertainty: String
    public let claim: String
    public let evidence: [Evidence]

    public init(title: String, summary: String, uncertainty: String, claim: String, evidence: [Evidence]) {
        self.title = title
        self.summary = summary
        self.uncertainty = uncertainty
        self.claim = claim
        self.evidence = evidence
    }
}

public enum SlowGardenError: Error, Equatable, LocalizedError {
    case gardenNotFound
    case gardenArchived
    case seedNotFound
    case bloomNotFound
    case insufficientSeeds(required: Int, available: Int)
    case invalidEvidence

    public var errorDescription: String? {
        switch self {
        case .gardenNotFound: "The garden could not be found."
        case .gardenArchived: "Restore this garden before changing it."
        case .seedNotFound: "The seed could not be found."
        case .bloomNotFound: "The bloom could not be found."
        case let .insufficientSeeds(required, available): "Plant at least \(required) seeds. This garden has \(available)."
        case .invalidEvidence: "The bloom evidence did not match its frozen snapshot."
        }
    }
}

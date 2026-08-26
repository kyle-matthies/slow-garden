import Foundation
#if SLOW_GARDEN_SWIFTDATA
import SwiftData

public enum SlowGardenStore {
    public static let schema = Schema([
        GardenRecord.self,
        SeedRecord.self,
        SeedRevisionRecord.self,
        GardenPassRecord.self,
        SnapshotItemRecord.self,
        BloomRecord.self,
        BloomClaimRecord.self,
        EvidenceLinkRecord.self,
        BloomResponseRecord.self,
        OutboxMutationRecord.self,
    ])

    public static func makeContainer(inMemoryOnly: Bool = false, storeURL: URL? = nil) throws -> ModelContainer {
        let configuration: ModelConfiguration
        if inMemoryOnly {
            configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        } else if let storeURL {
            try protectStoreDirectory(containing: storeURL)
            configuration = ModelConfiguration("SlowGarden-v1", schema: schema, url: storeURL, allowsSave: true)
        } else {
            configuration = ModelConfiguration("SlowGarden-v1", schema: schema, isStoredInMemoryOnly: false)
        }
        return try ModelContainer(for: schema, configurations: [configuration])
    }

    public static func defaultStoreURL() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return base.appending(path: "SlowGarden", directoryHint: .isDirectory)
            .appending(path: "SlowGarden-v1.store")
    }

    private static func protectStoreDirectory(containing storeURL: URL) throws {
        let directory = storeURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directory.path
        )
        #endif
    }
}

@MainActor
public final class SwiftDataGardenRepository: GardenRepository {
    public let container: ModelContainer
    private let context: ModelContext

    public init(container: ModelContainer) {
        self.container = container
        self.context = container.mainContext
        self.context.autosaveEnabled = false
    }

    public func ensureDefaultGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary {
        if let existing = try fetchAll(GardenRecord.self).sorted(by: { $0.createdAt < $1.createdAt }).first {
            return summary(existing)
        }
        return try createGarden(id: id, name: name, at: date)
    }

    public func gardens(includeArchived: Bool = false) throws -> [GardenSummary] {
        try fetchAll(GardenRecord.self)
            .filter { includeArchived || $0.status == .active }
            .sorted { lhs, rhs in
                if lhs.status != rhs.status { return lhs.status == .active }
                return lhs.modifiedAt > rhs.modifiedAt
            }
            .map(summary)
    }

    public func createGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary {
        let cleaned = cleanedName(name)
        let record = GardenRecord(id: id, name: cleaned, createdAt: date)
        context.insert(record)
        insertOutbox(id: id, entityType: "garden", entityID: id, operation: "create", baseRevisionID: nil, at: date)
        try save()
        return summary(record)
    }

    public func renameGarden(id: UUID, name: String, at date: Date, mutationID: UUID) throws {
        guard let garden = try garden(id) else { throw SlowGardenError.gardenNotFound }
        guard garden.status == .active else { throw SlowGardenError.gardenArchived }
        garden.name = cleanedName(name)
        garden.modifiedAt = date
        insertOutbox(id: mutationID, entityType: "garden", entityID: id, operation: "rename", baseRevisionID: nil, at: date)
        try save()
    }

    public func setGardenArchived(id: UUID, archived: Bool, at date: Date, mutationID: UUID) throws {
        guard let garden = try garden(id) else { throw SlowGardenError.gardenNotFound }
        garden.status = archived ? .archived : .active
        garden.modifiedAt = date
        insertOutbox(id: mutationID, entityType: "garden", entityID: id, operation: archived ? "archive" : "restore", baseRevisionID: nil, at: date)
        try save()
    }

    public func plantSeed(gardenID: UUID, seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot {
        guard let garden = try garden(gardenID) else { throw SlowGardenError.gardenNotFound }
        guard garden.status == .active else { throw SlowGardenError.gardenArchived }
        let cleaned = cleanedText(text)
        let seed = SeedRecord(id: seedID, gardenID: gardenID, currentRevisionID: revisionID, createdAt: date)
        let revision = SeedRevisionRecord(id: revisionID, gardenID: gardenID, seedID: seedID, revisionNumber: 1, text: cleaned, createdAt: date)
        context.insert(seed)
        context.insert(revision)
        garden.modifiedAt = date
        insertOutbox(id: mutationID, entityType: "seed_revision", entityID: revisionID, operation: "create", baseRevisionID: nil, at: date)
        try save()
        return snapshot(seed: seed, revision: revision)
    }

    public func reviseSeed(seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot {
        guard let seed = try seed(seedID) else { throw SlowGardenError.seedNotFound }
        guard let garden = try garden(seed.gardenID) else { throw SlowGardenError.gardenNotFound }
        guard garden.status == .active else { throw SlowGardenError.gardenArchived }
        let previousRevisionID = seed.currentRevisionID
        let revisionNumber = try revisions(seedID: seedID).map(\.revisionNumber).max().map { $0 + 1 } ?? 1
        let revision = SeedRevisionRecord(
            id: revisionID,
            gardenID: seed.gardenID,
            seedID: seedID,
            revisionNumber: revisionNumber,
            text: cleanedText(text),
            createdAt: date
        )
        context.insert(revision)
        seed.currentRevisionID = revisionID
        seed.modifiedAt = date
        garden.modifiedAt = date
        insertOutbox(id: mutationID, entityType: "seed_revision", entityID: revisionID, operation: "revise", baseRevisionID: previousRevisionID, at: date)
        try save()
        return snapshot(seed: seed, revision: revision)
    }

    public func seeds(gardenID: UUID) throws -> [SeedSnapshot] {
        let allRevisions = try fetchAll(SeedRevisionRecord.self)
        let revisionsByID = Dictionary(uniqueKeysWithValues: allRevisions.map { ($0.id, $0) })
        return try fetchAll(SeedRecord.self)
            .filter { $0.gardenID == gardenID && $0.status == .active }
            .compactMap { seed in revisionsByID[seed.currentRevisionID].map { snapshot(seed: seed, revision: $0) } }
            .sorted { lhs, rhs in
                if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
                return lhs.id.uuidString < rhs.id.uuidString
            }
    }

    public func requestPass(id: UUID, gardenID: UUID, requestedAt: Date, dueAt: Date, workflowVersion: String, snapshotItemIDs: [UUID], mutationID: UUID) throws -> GardenPassSnapshot {
        guard let garden = try garden(gardenID) else { throw SlowGardenError.gardenNotFound }
        guard garden.status == .active else { throw SlowGardenError.gardenArchived }
        if let existing = try fetchAll(GardenPassRecord.self)
            .first(where: { $0.gardenID == gardenID && ($0.status == .queued || $0.status == .processing) }) {
            return try passSnapshot(existing)
        }
        let eligible = try seeds(gardenID: gardenID)
        guard eligible.count >= 3 else {
            throw SlowGardenError.insufficientSeeds(required: 3, available: eligible.count)
        }
        let selected = Array(eligible.prefix(3))
        precondition(snapshotItemIDs.count >= selected.count)
        let pass = GardenPassRecord(id: id, gardenID: gardenID, requestedAt: requestedAt, dueAt: dueAt, workflowVersion: workflowVersion)
        context.insert(pass)
        for (index, seed) in selected.enumerated() {
            context.insert(SnapshotItemRecord(
                id: snapshotItemIDs[index],
                passID: id,
                gardenID: gardenID,
                seedID: seed.id,
                seedRevisionID: seed.revisionID,
                ordinal: index
            ))
        }
        insertOutbox(id: mutationID, entityType: "garden_pass", entityID: id, operation: "request", baseRevisionID: nil, at: requestedAt)
        try save()
        return try passSnapshot(pass)
    }

    public func passes(gardenID: UUID) throws -> [GardenPassSnapshot] {
        try fetchAll(GardenPassRecord.self)
            .filter { $0.gardenID == gardenID }
            .sorted { $0.requestedAt > $1.requestedAt }
            .map(passSnapshot)
    }

    public func duePasses(at date: Date) throws -> [GardenPassSnapshot] {
        try fetchAll(GardenPassRecord.self)
            .filter { ($0.status == .queued || $0.status == .processing) && $0.dueAt <= date }
            .sorted { $0.dueAt < $1.dueAt }
            .map(passSnapshot)
    }

    public func markPassProcessing(id: UUID) throws {
        guard let pass = try pass(id) else { return }
        guard pass.status == .queued else { return }
        pass.status = .processing
        try save()
    }

    public func markPassFailed(id: UUID, code: String) throws {
        guard let pass = try pass(id) else { return }
        pass.status = .failed
        pass.failureCode = code
        try save()
    }

    public func snapshotSeeds(passID: UUID) throws -> [SeedSnapshot] {
        let items = try fetchAll(SnapshotItemRecord.self)
            .filter { $0.passID == passID }
            .sorted { $0.ordinal < $1.ordinal }
        let allSeeds = Dictionary(uniqueKeysWithValues: try fetchAll(SeedRecord.self).map { ($0.id, $0) })
        let allRevisions = Dictionary(uniqueKeysWithValues: try fetchAll(SeedRevisionRecord.self).map { ($0.id, $0) })
        return items.compactMap { item in
            guard let seed = allSeeds[item.seedID], let revision = allRevisions[item.seedRevisionID] else { return nil }
            return snapshot(seed: seed, revision: revision)
        }
    }

    public func completePass(passID: UUID, bloomID: UUID, claimID: UUID, evidenceIDs: [UUID], draft: BloomDraft, at date: Date, mutationID: UUID) throws -> BloomDetail {
        guard let pass = try pass(passID) else { throw SlowGardenError.invalidEvidence }
        if let existing = try fetchAll(BloomRecord.self).first(where: { $0.passID == passID }) {
            return try bloomDetail(id: existing.id)
        }
        let snapshotItems = try fetchAll(SnapshotItemRecord.self).filter { $0.passID == passID }
        let allowedRevisionIDs = Set(snapshotItems.map(\.seedRevisionID))
        guard draft.evidence.count == 3,
              draft.evidence.allSatisfy({ $0.seedRevisionID != UUID.zero && allowedRevisionIDs.contains($0.seedRevisionID) }),
              Set(draft.evidence.map(\.seedRevisionID)).count == draft.evidence.count,
              evidenceIDs.count >= draft.evidence.count
        else { throw SlowGardenError.invalidEvidence }

        let bloom = BloomRecord(id: bloomID, passID: passID, gardenID: pass.gardenID, title: draft.title, summary: draft.summary, uncertainty: draft.uncertainty, createdAt: date)
        let claim = BloomClaimRecord(id: claimID, bloomID: bloomID, gardenID: pass.gardenID, text: draft.claim)
        context.insert(bloom)
        context.insert(claim)
        for (index, evidence) in draft.evidence.enumerated() {
            context.insert(EvidenceLinkRecord(
                id: evidenceIDs[index],
                claimID: claimID,
                bloomID: bloomID,
                gardenID: pass.gardenID,
                seedID: evidence.seedID,
                seedRevisionID: evidence.seedRevisionID,
                excerpt: evidence.excerpt,
                ordinal: index
            ))
        }
        pass.status = .complete
        pass.completedAt = date
        insertOutbox(id: mutationID, entityType: "bloom", entityID: bloomID, operation: "fixture_complete", baseRevisionID: nil, at: date)
        try save()
        return try bloomDetail(id: bloomID)
    }

    public func blooms(gardenID: UUID) throws -> [BloomSummary] {
        try fetchAll(BloomRecord.self)
            .filter { $0.gardenID == gardenID }
            .sorted { $0.createdAt > $1.createdAt }
            .map { BloomSummary(id: $0.id, gardenID: $0.gardenID, title: $0.title, status: $0.status, createdAt: $0.createdAt) }
    }

    public func bloomDetail(id: UUID) throws -> BloomDetail {
        guard let bloom = try fetchAll(BloomRecord.self).first(where: { $0.id == id }) else { throw SlowGardenError.bloomNotFound }
        guard let claim = try fetchAll(BloomClaimRecord.self).first(where: { $0.bloomID == id }) else { throw SlowGardenError.invalidEvidence }
        let seedByID = Dictionary(uniqueKeysWithValues: try fetchAll(SeedRecord.self).map { ($0.id, $0) })
        let revisionByID = Dictionary(uniqueKeysWithValues: try fetchAll(SeedRevisionRecord.self).map { ($0.id, $0) })
        let evidence = try fetchAll(EvidenceLinkRecord.self)
            .filter { $0.bloomID == id }
            .sorted { $0.ordinal < $1.ordinal }
            .compactMap { link -> EvidenceSnapshot? in
                guard link.gardenID == bloom.gardenID,
                      let seed = seedByID[link.seedID], seed.gardenID == bloom.gardenID,
                      let revision = revisionByID[link.seedRevisionID], revision.gardenID == bloom.gardenID
                else { return nil }
                return EvidenceSnapshot(
                    id: link.id,
                    seedID: link.seedID,
                    seedRevisionID: link.seedRevisionID,
                    revisionNumber: revision.revisionNumber,
                    excerpt: link.excerpt,
                    sourceText: revision.text,
                    sourceCreatedAt: revision.createdAt,
                    isEarlierVersion: seed.currentRevisionID != revision.id
                )
            }
        guard evidence.count == 3 else { throw SlowGardenError.invalidEvidence }
        let latestResponse = try fetchAll(BloomResponseRecord.self)
            .filter { $0.bloomID == id }
            .max(by: { $0.createdAt < $1.createdAt })?.kind
        return BloomDetail(
            id: bloom.id,
            gardenID: bloom.gardenID,
            title: bloom.title,
            summary: bloom.summary,
            uncertainty: bloom.uncertainty,
            status: bloom.status,
            createdAt: bloom.createdAt,
            claim: claim.text,
            evidence: evidence,
            latestResponse: latestResponse
        )
    }

    public func appendResponse(id: UUID, bloomID: UUID, kind: BloomResponseKind, note: String?, at date: Date, mutationID: UUID) throws {
        if try fetchAll(BloomResponseRecord.self).contains(where: { $0.id == id }) { return }
        guard let bloom = try fetchAll(BloomRecord.self).first(where: { $0.id == bloomID }) else { throw SlowGardenError.bloomNotFound }
        let response = BloomResponseRecord(id: id, bloomID: bloomID, gardenID: bloom.gardenID, kind: kind, note: note, createdAt: date)
        context.insert(response)
        switch kind {
        case .kept: bloom.status = .kept
        case .corrected: bloom.status = .corrected
        case .pruned: bloom.status = .pruned
        }
        insertOutbox(id: mutationID, entityType: "bloom_response", entityID: id, operation: kind.rawValue, baseRevisionID: nil, at: date)
        try save()
    }

    public func pendingOutboxCount() throws -> Int {
        try fetchAll(OutboxMutationRecord.self).filter { $0.state == .localPending }.count
    }

    private func passSnapshot(_ pass: GardenPassRecord) throws -> GardenPassSnapshot {
        let revisionIDs = try fetchAll(SnapshotItemRecord.self)
            .filter { $0.passID == pass.id }
            .sorted { $0.ordinal < $1.ordinal }
            .map(\.seedRevisionID)
        return GardenPassSnapshot(
            id: pass.id,
            gardenID: pass.gardenID,
            requestedAt: pass.requestedAt,
            dueAt: pass.dueAt,
            status: pass.status,
            workflowVersion: pass.workflowVersion,
            seedRevisionIDs: revisionIDs
        )
    }

    private func summary(_ garden: GardenRecord) -> GardenSummary {
        GardenSummary(id: garden.id, name: garden.name, status: garden.status, createdAt: garden.createdAt, modifiedAt: garden.modifiedAt)
    }

    private func snapshot(seed: SeedRecord, revision: SeedRevisionRecord) -> SeedSnapshot {
        SeedSnapshot(
            id: seed.id,
            gardenID: seed.gardenID,
            revisionID: revision.id,
            revisionNumber: revision.revisionNumber,
            text: revision.text,
            createdAt: seed.createdAt,
            modifiedAt: seed.modifiedAt
        )
    }

    private func garden(_ id: UUID) throws -> GardenRecord? {
        try fetchAll(GardenRecord.self).first(where: { $0.id == id })
    }

    private func seed(_ id: UUID) throws -> SeedRecord? {
        try fetchAll(SeedRecord.self).first(where: { $0.id == id })
    }

    private func pass(_ id: UUID) throws -> GardenPassRecord? {
        try fetchAll(GardenPassRecord.self).first(where: { $0.id == id })
    }

    private func revisions(seedID: UUID) throws -> [SeedRevisionRecord] {
        try fetchAll(SeedRevisionRecord.self).filter { $0.seedID == seedID }
    }

    private func fetchAll<T: PersistentModel>(_ type: T.Type) throws -> [T] {
        try context.fetch(FetchDescriptor<T>())
    }

    private func insertOutbox(id: UUID, entityType: String, entityID: UUID, operation: String, baseRevisionID: UUID?, at date: Date) {
        context.insert(OutboxMutationRecord(
            id: id,
            idempotencyKey: id.uuidString.lowercased(),
            entityType: entityType,
            entityID: entityID,
            operation: operation,
            baseRevisionID: baseRevisionID,
            createdAt: date
        ))
    }

    private func cleanedName(_ name: String) -> String {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Untitled Garden" : String(value.prefix(80))
    }

    private func cleanedText(_ text: String) -> String {
        String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000))
    }

    private func save() throws {
        do {
            try context.save()
        } catch {
            context.rollback()
            throw error
        }
    }
}

private extension UUID {
    static let zero = UUID(uuidString: "00000000-0000-0000-0000-000000000000")!
}
#endif

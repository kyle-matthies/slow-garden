import Foundation

/// A deterministic repository used by tests and SwiftUI previews.
/// The shipping iOS app uses `SwiftDataGardenRepository`.
@MainActor
public final class InMemoryGardenRepository: GardenRepository {
    private struct SeedState {
        var current: SeedSnapshot
        var revisions: [SeedSnapshot]
    }

    private struct PassState {
        var snapshot: GardenPassSnapshot
        var failureCode: String?
    }

    private var gardenValues: [UUID: GardenSummary] = [:]
    private var seedValues: [UUID: SeedState] = [:]
    private var passValues: [UUID: PassState] = [:]
    private var bloomValues: [UUID: BloomDetail] = [:]
    private var bloomIDByPassID: [UUID: UUID] = [:]
    private var responseIDs: Set<UUID> = []
    private var outboxIDs: Set<UUID> = []

    public init() {}

    public func ensureDefaultGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary {
        if let existing = gardenValues.values.sorted(by: { $0.createdAt < $1.createdAt }).first { return existing }
        return try createGarden(id: id, name: name, at: date)
    }

    public func gardens(includeArchived: Bool = false) throws -> [GardenSummary] {
        gardenValues.values
            .filter { includeArchived || $0.status == .active }
            .sorted { lhs, rhs in
                if lhs.status != rhs.status { return lhs.status == .active }
                return lhs.modifiedAt > rhs.modifiedAt
            }
    }

    public func createGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary {
        let garden = GardenSummary(id: id, name: cleanName(name), status: .active, createdAt: date, modifiedAt: date)
        gardenValues[id] = garden
        outboxIDs.insert(id)
        return garden
    }

    public func renameGarden(id: UUID, name: String, at date: Date, mutationID: UUID) throws {
        let garden = try editableGarden(id)
        gardenValues[id] = GardenSummary(id: id, name: cleanName(name), status: garden.status, createdAt: garden.createdAt, modifiedAt: date)
        outboxIDs.insert(mutationID)
    }

    public func setGardenArchived(id: UUID, archived: Bool, at date: Date, mutationID: UUID) throws {
        guard let garden = gardenValues[id] else { throw SlowGardenError.gardenNotFound }
        gardenValues[id] = GardenSummary(
            id: garden.id,
            name: garden.name,
            status: archived ? .archived : .active,
            createdAt: garden.createdAt,
            modifiedAt: date
        )
        outboxIDs.insert(mutationID)
    }

    public func plantSeed(gardenID: UUID, seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot {
        _ = try editableGarden(gardenID)
        let seed = SeedSnapshot(
            id: seedID,
            gardenID: gardenID,
            revisionID: revisionID,
            revisionNumber: 1,
            text: cleanText(text),
            createdAt: date,
            modifiedAt: date
        )
        seedValues[seedID] = SeedState(current: seed, revisions: [seed])
        touchGarden(gardenID, at: date)
        outboxIDs.insert(mutationID)
        return seed
    }

    public func reviseSeed(seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot {
        guard var state = seedValues[seedID] else { throw SlowGardenError.seedNotFound }
        _ = try editableGarden(state.current.gardenID)
        let revision = SeedSnapshot(
            id: seedID,
            gardenID: state.current.gardenID,
            revisionID: revisionID,
            revisionNumber: state.revisions.count + 1,
            text: cleanText(text),
            createdAt: state.current.createdAt,
            modifiedAt: date
        )
        state.current = revision
        state.revisions.append(revision)
        seedValues[seedID] = state
        touchGarden(revision.gardenID, at: date)
        outboxIDs.insert(mutationID)
        return revision
    }

    public func seeds(gardenID: UUID) throws -> [SeedSnapshot] {
        seedValues.values.map(\.current)
            .filter { $0.gardenID == gardenID }
            .sorted { lhs, rhs in
                if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
                return lhs.id.uuidString < rhs.id.uuidString
            }
    }

    public func requestPass(id: UUID, gardenID: UUID, requestedAt: Date, dueAt: Date, workflowVersion: String, snapshotItemIDs: [UUID], mutationID: UUID) throws -> GardenPassSnapshot {
        _ = try editableGarden(gardenID)
        if let existing = passValues.values.map(\.snapshot).first(where: {
            $0.gardenID == gardenID && ($0.status == .queued || $0.status == .processing)
        }) { return existing }
        let eligible = try seeds(gardenID: gardenID)
        guard eligible.count >= 3 else { throw SlowGardenError.insufficientSeeds(required: 3, available: eligible.count) }
        let pass = GardenPassSnapshot(
            id: id,
            gardenID: gardenID,
            requestedAt: requestedAt,
            dueAt: dueAt,
            status: .queued,
            workflowVersion: workflowVersion,
            seedRevisionIDs: Array(eligible.prefix(3)).map(\.revisionID)
        )
        passValues[id] = PassState(snapshot: pass)
        outboxIDs.insert(mutationID)
        return pass
    }

    public func passes(gardenID: UUID) throws -> [GardenPassSnapshot] {
        passValues.values.map(\.snapshot).filter { $0.gardenID == gardenID }.sorted { $0.requestedAt > $1.requestedAt }
    }

    public func duePasses(at date: Date) throws -> [GardenPassSnapshot] {
        passValues.values.map(\.snapshot)
            .filter { ($0.status == .queued || $0.status == .processing) && $0.dueAt <= date }
            .sorted { $0.dueAt < $1.dueAt }
    }

    public func markPassProcessing(id: UUID) throws {
        guard var state = passValues[id], state.snapshot.status == .queued else { return }
        state.snapshot = copyPass(state.snapshot, status: .processing)
        passValues[id] = state
    }

    public func markPassFailed(id: UUID, code: String) throws {
        guard var state = passValues[id] else { return }
        state.snapshot = copyPass(state.snapshot, status: .failed)
        state.failureCode = code
        passValues[id] = state
    }

    public func snapshotSeeds(passID: UUID) throws -> [SeedSnapshot] {
        guard let pass = passValues[passID]?.snapshot else { throw SlowGardenError.invalidEvidence }
        return pass.seedRevisionIDs.compactMap { revisionID in
            seedValues.values.flatMap(\.revisions).first(where: { $0.revisionID == revisionID && $0.gardenID == pass.gardenID })
        }
    }

    public func completePass(passID: UUID, bloomID: UUID, claimID: UUID, evidenceIDs: [UUID], draft: BloomDraft, at date: Date, mutationID: UUID) throws -> BloomDetail {
        if let existingID = bloomIDByPassID[passID] { return try bloomDetail(id: existingID) }
        guard var passState = passValues[passID] else { throw SlowGardenError.invalidEvidence }
        let allowed = Set(passState.snapshot.seedRevisionIDs)
        guard draft.evidence.count == 3,
              evidenceIDs.count >= 3,
              draft.evidence.allSatisfy({ allowed.contains($0.seedRevisionID) }),
              Set(draft.evidence.map(\.seedRevisionID)).count == 3
        else { throw SlowGardenError.invalidEvidence }
        let sourceRevisions = seedValues.values.flatMap(\.revisions)
        let evidence: [EvidenceSnapshot] = draft.evidence.enumerated().compactMap { index, item in
            guard let source = sourceRevisions.first(where: { $0.revisionID == item.seedRevisionID && $0.gardenID == passState.snapshot.gardenID }),
                  let current = seedValues[item.seedID]?.current
            else { return nil }
            return EvidenceSnapshot(
                id: evidenceIDs[index],
                seedID: item.seedID,
                seedRevisionID: item.seedRevisionID,
                revisionNumber: source.revisionNumber,
                excerpt: item.excerpt,
                sourceText: source.text,
                sourceCreatedAt: source.modifiedAt,
                isEarlierVersion: current.revisionID != item.seedRevisionID
            )
        }
        guard evidence.count == 3 else { throw SlowGardenError.invalidEvidence }
        let bloom = BloomDetail(
            id: bloomID,
            gardenID: passState.snapshot.gardenID,
            title: draft.title,
            summary: draft.summary,
            uncertainty: draft.uncertainty,
            status: .new,
            createdAt: date,
            claim: draft.claim,
            evidence: evidence,
            latestResponse: nil
        )
        bloomValues[bloomID] = bloom
        bloomIDByPassID[passID] = bloomID
        passState.snapshot = copyPass(passState.snapshot, status: .complete)
        passValues[passID] = passState
        outboxIDs.insert(mutationID)
        return bloom
    }

    public func blooms(gardenID: UUID) throws -> [BloomSummary] {
        bloomValues.values.filter { $0.gardenID == gardenID }.sorted { $0.createdAt > $1.createdAt }.map {
            BloomSummary(id: $0.id, gardenID: $0.gardenID, title: $0.title, status: $0.status, createdAt: $0.createdAt)
        }
    }

    public func bloomDetail(id: UUID) throws -> BloomDetail {
        guard let bloom = bloomValues[id] else { throw SlowGardenError.bloomNotFound }
        let evidence = bloom.evidence.map { item -> EvidenceSnapshot in
            let currentRevisionID = seedValues[item.seedID]?.current.revisionID
            return EvidenceSnapshot(
                id: item.id,
                seedID: item.seedID,
                seedRevisionID: item.seedRevisionID,
                revisionNumber: item.revisionNumber,
                excerpt: item.excerpt,
                sourceText: item.sourceText,
                sourceCreatedAt: item.sourceCreatedAt,
                isEarlierVersion: currentRevisionID != item.seedRevisionID
            )
        }
        return BloomDetail(
            id: bloom.id,
            gardenID: bloom.gardenID,
            title: bloom.title,
            summary: bloom.summary,
            uncertainty: bloom.uncertainty,
            status: bloom.status,
            createdAt: bloom.createdAt,
            claim: bloom.claim,
            evidence: evidence,
            latestResponse: bloom.latestResponse
        )
    }

    public func appendResponse(id: UUID, bloomID: UUID, kind: BloomResponseKind, note: String?, at date: Date, mutationID: UUID) throws {
        guard !responseIDs.contains(id) else { return }
        guard let bloom = bloomValues[bloomID] else { throw SlowGardenError.bloomNotFound }
        let status: BloomStatus = switch kind {
        case .kept: .kept
        case .corrected: .corrected
        case .pruned: .pruned
        }
        bloomValues[bloomID] = BloomDetail(
            id: bloom.id,
            gardenID: bloom.gardenID,
            title: bloom.title,
            summary: bloom.summary,
            uncertainty: bloom.uncertainty,
            status: status,
            createdAt: bloom.createdAt,
            claim: bloom.claim,
            evidence: bloom.evidence,
            latestResponse: kind
        )
        responseIDs.insert(id)
        outboxIDs.insert(mutationID)
    }

    public func pendingOutboxCount() throws -> Int { outboxIDs.count }

    private func editableGarden(_ id: UUID) throws -> GardenSummary {
        guard let garden = gardenValues[id] else { throw SlowGardenError.gardenNotFound }
        guard garden.status == .active else { throw SlowGardenError.gardenArchived }
        return garden
    }

    private func touchGarden(_ id: UUID, at date: Date) {
        guard let garden = gardenValues[id] else { return }
        gardenValues[id] = GardenSummary(id: garden.id, name: garden.name, status: garden.status, createdAt: garden.createdAt, modifiedAt: date)
    }

    private func copyPass(_ pass: GardenPassSnapshot, status: GardenPassStatus) -> GardenPassSnapshot {
        GardenPassSnapshot(
            id: pass.id,
            gardenID: pass.gardenID,
            requestedAt: pass.requestedAt,
            dueAt: pass.dueAt,
            status: status,
            workflowVersion: pass.workflowVersion,
            seedRevisionIDs: pass.seedRevisionIDs
        )
    }

    private func cleanName(_ name: String) -> String {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Untitled Garden" : String(value.prefix(80))
    }

    private func cleanText(_ text: String) -> String {
        String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000))
    }
}

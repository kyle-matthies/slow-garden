import Foundation

public protocol BloomGenerator: Sendable {
    func generate(from seeds: [SeedSnapshot]) throws -> BloomDraft
}

public struct DeterministicFixtureBloomGenerator: BloomGenerator {
    public init() {}

    public func generate(from seeds: [SeedSnapshot]) throws -> BloomDraft {
        guard seeds.count == 3 else { throw SlowGardenError.invalidEvidence }
        let evidence = seeds.map { seed in
            BloomDraft.Evidence(
                seedID: seed.id,
                seedRevisionID: seed.revisionID,
                excerpt: excerpt(from: seed.text)
            )
        }
        return BloomDraft(
            title: "The work gets clearer when I leave it alone",
            summary: "Across these three seeds, space appears to be part of the thinking—not an absence from it.",
            uncertainty: "A pattern to consider, not a conclusion.",
            claim: "This thought echoes across time.",
            evidence: evidence
        )
    }

    private func excerpt(from text: String) -> String {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.count <= 110 { return cleaned }
        let end = cleaned.index(cleaned.startIndex, offsetBy: 109)
        return String(cleaned[...end]) + "…"
    }
}

@MainActor
public final class LocalTendingEngine {
    public static let workflowVersion = "fixture-connect-v1"
    public static let delay: TimeInterval = 5 * 60

    private let repository: any GardenRepository
    private let clock: any GardenClock
    private let identifiers: any GardenIdentifierGenerator
    private let generator: any BloomGenerator
    private let delay: TimeInterval

    public init(
        repository: any GardenRepository,
        clock: any GardenClock = SystemGardenClock(),
        identifiers: any GardenIdentifierGenerator = RandomGardenIdentifierGenerator(),
        generator: any BloomGenerator = DeterministicFixtureBloomGenerator(),
        delay: TimeInterval = LocalTendingEngine.delay
    ) {
        self.repository = repository
        self.clock = clock
        self.identifiers = identifiers
        self.generator = generator
        self.delay = delay
    }

    @discardableResult
    public func requestTending(gardenID: UUID) throws -> GardenPassSnapshot {
        let requestedAt = clock.now
        return try repository.requestPass(
            id: identifiers.next(),
            gardenID: gardenID,
            requestedAt: requestedAt,
            dueAt: requestedAt.addingTimeInterval(delay),
            workflowVersion: Self.workflowVersion,
            snapshotItemIDs: [identifiers.next(), identifiers.next(), identifiers.next()],
            mutationID: identifiers.next()
        )
    }

    @discardableResult
    public func reconcile() throws -> [BloomDetail] {
        var completed: [BloomDetail] = []
        for pass in try repository.duePasses(at: clock.now) {
            do {
                try repository.markPassProcessing(id: pass.id)
                let seeds = try repository.snapshotSeeds(passID: pass.id)
                let draft = try generator.generate(from: seeds)
                let bloom = try repository.completePass(
                    passID: pass.id,
                    bloomID: identifiers.next(),
                    claimID: identifiers.next(),
                    evidenceIDs: [identifiers.next(), identifiers.next(), identifiers.next()],
                    draft: draft,
                    at: clock.now,
                    mutationID: identifiers.next()
                )
                completed.append(bloom)
            } catch {
                try? repository.markPassFailed(id: pass.id, code: String(describing: error))
                throw error
            }
        }
        return completed
    }
}

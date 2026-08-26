import Foundation
import SlowGardenCore

enum CheckFailure: Error, CustomStringConvertible {
    case failed(String)
    var description: String {
        switch self { case let .failed(message): "Check failed: \(message)" }
    }
}

@main
struct SlowGardenCoreChecks {
    @MainActor
    static func main() throws {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let repository = InMemoryGardenRepository()
        let work = try repository.createGarden(id: uuid(1), name: "Work", at: start)
        let personal = try repository.createGarden(id: uuid(2), name: "Personal", at: start)
        _ = try repository.plantSeed(gardenID: personal.id, seedID: uuid(3), revisionID: uuid(4), text: "Private boundary", at: start, mutationID: uuid(5))
        try require(try repository.seeds(gardenID: work.id).isEmpty, "garden boundary leaked a seed")

        let seedIDs = [uuid(10), uuid(13), uuid(16)]
        let revisionIDs = [uuid(11), uuid(14), uuid(17)]
        let texts = [
            "Leave room before naming the solution.",
            "What changes once this becomes a roadmap?",
            "The form should not interrupt the idea.",
        ]
        for index in texts.indices {
            _ = try repository.plantSeed(
                gardenID: work.id,
                seedID: seedIDs[index],
                revisionID: revisionIDs[index],
                text: texts[index],
                at: start.addingTimeInterval(Double(index)),
                mutationID: uuid(20 + index)
            )
        }

        let clock = MutableGardenClock(now: start)
        let engine = LocalTendingEngine(
            repository: repository,
            clock: clock,
            identifiers: SequenceGardenIdentifierGenerator(values: (30...90).map(uuid))
        )
        let firstPass = try engine.requestTending(gardenID: work.id)
        let duplicatePass = try engine.requestTending(gardenID: work.id)
        try require(firstPass.id == duplicatePass.id, "duplicate request created a second pass")
        try require(firstPass.dueAt == start.addingTimeInterval(300), "pass delay was not five minutes")
        try require(firstPass.seedRevisionIDs == revisionIDs, "pass did not freeze exact source revisions")
        try require(try engine.reconcile().isEmpty, "bloom completed before its due time")

        _ = try repository.reviseSeed(
            seedID: seedIDs[0], revisionID: uuid(91),
            text: "A later edit that must not rewrite old evidence.",
            at: start.addingTimeInterval(120), mutationID: uuid(92)
        )
        clock.advance(by: 300)
        let completed = try engine.reconcile()
        try require(completed.count == 1, "due pass did not create exactly one bloom")
        guard let bloom = completed.first else { throw CheckFailure.failed("missing bloom") }
        try require(bloom.evidence.map(\.seedRevisionID) == revisionIDs, "bloom provenance changed after a source edit")
        try require(bloom.isStale, "older evidence was not disclosed")
        try require(try engine.reconcile().isEmpty, "reconciliation duplicated a bloom")

        try repository.appendResponse(id: uuid(93), bloomID: bloom.id, kind: .kept, note: nil, at: clock.now, mutationID: uuid(94))
        let kept = try repository.bloomDetail(id: bloom.id)
        try require(kept.latestResponse == .kept, "response was not appended")
        try require(kept.evidence.first?.sourceText == texts[0], "response mutated source evidence")

        try repository.setGardenArchived(id: personal.id, archived: true, at: clock.now, mutationID: uuid(95))
        do {
            _ = try repository.plantSeed(gardenID: personal.id, seedID: uuid(96), revisionID: uuid(97), text: "Blocked", at: clock.now, mutationID: uuid(98))
            throw CheckFailure.failed("archived garden accepted a new seed")
        } catch SlowGardenError.gardenArchived {
            // Expected.
        }
        try repository.setGardenArchived(id: personal.id, archived: false, at: clock.now, mutationID: uuid(99))

        let recoveryRepository = InMemoryGardenRepository()
        let recoveryGarden = try recoveryRepository.createGarden(id: uuid(200), name: "Recovery", at: start)
        for index in 0..<3 {
            _ = try recoveryRepository.plantSeed(
                gardenID: recoveryGarden.id,
                seedID: uuid(201 + index * 3), revisionID: uuid(202 + index * 3),
                text: "Recovery seed \(index)", at: start, mutationID: uuid(203 + index * 3)
            )
        }
        let recoveryClock = MutableGardenClock(now: start)
        let recoveryEngine = LocalTendingEngine(
            repository: recoveryRepository,
            clock: recoveryClock,
            identifiers: SequenceGardenIdentifierGenerator(values: (220...280).map(uuid))
        )
        let interruptedPass = try recoveryEngine.requestTending(gardenID: recoveryGarden.id)
        recoveryClock.advance(by: 300)
        try recoveryRepository.markPassProcessing(id: interruptedPass.id)
        try require(try recoveryEngine.reconcile().count == 1, "an interrupted processing pass did not recover")

        print("SlowGardenCoreChecks passed: isolation, immutable revisions, five-minute tending, exact evidence, idempotency, interrupted-pass recovery, responses, archive/restore")
    }

    private static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try condition() else { throw CheckFailure.failed(message) }
    }

    private static func uuid(_ value: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", value))!
    }
}

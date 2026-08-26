import Foundation
#if canImport(XCTest)
import XCTest
@testable import SlowGardenCore

@MainActor
final class SlowGardenCoreTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    func testMultipleGardensRemainIsolatedAndArchivedGardensAreReadOnly() throws {
        let repository = InMemoryGardenRepository()
        let first = try repository.createGarden(id: uuid(1), name: "Work", at: start)
        let second = try repository.createGarden(id: uuid(2), name: "Personal", at: start)
        _ = try repository.plantSeed(gardenID: first.id, seedID: uuid(3), revisionID: uuid(4), text: "A work seed", at: start, mutationID: uuid(5))
        _ = try repository.plantSeed(gardenID: second.id, seedID: uuid(6), revisionID: uuid(7), text: "A personal seed", at: start, mutationID: uuid(8))
        XCTAssertEqual(try repository.seeds(gardenID: first.id).map(\.text), ["A work seed"])
        XCTAssertEqual(try repository.seeds(gardenID: second.id).map(\.text), ["A personal seed"])

        try repository.setGardenArchived(id: first.id, archived: true, at: start, mutationID: uuid(9))
        XCTAssertEqual(try repository.gardens(includeArchived: false).map(\.id), [second.id])
        XCTAssertThrowsError(
            try repository.plantSeed(gardenID: first.id, seedID: uuid(10), revisionID: uuid(11), text: "Blocked", at: start, mutationID: uuid(12))
        ) { error in
            XCTAssertEqual(error as? SlowGardenError, .gardenArchived)
        }
        try repository.setGardenArchived(id: first.id, archived: false, at: start, mutationID: uuid(13))
        XCTAssertEqual(Set(try repository.gardens(includeArchived: false).map(\.id)), Set([first.id, second.id]))
    }

    func testPassFreezesRevisionsAndYieldsOneBloomAfterFiveMinutes() throws {
        let repository = InMemoryGardenRepository()
        let garden = try repository.createGarden(id: uuid(20), name: "Ideas", at: start)
        let seedIDs = [uuid(21), uuid(24), uuid(27)]
        let revisionIDs = [uuid(22), uuid(25), uuid(28)]
        let texts = [
            "Leave room before naming the solution.",
            "What changes once this becomes a roadmap?",
            "The form should not interrupt the idea.",
        ]
        for index in texts.indices {
            _ = try repository.plantSeed(
                gardenID: garden.id,
                seedID: seedIDs[index],
                revisionID: revisionIDs[index],
                text: texts[index],
                at: start.addingTimeInterval(Double(index)),
                mutationID: uuid(30 + index)
            )
        }
        let clock = MutableGardenClock(now: start)
        let identifiers = SequenceGardenIdentifierGenerator(values: (40...90).map(uuid))
        let engine = LocalTendingEngine(repository: repository, clock: clock, identifiers: identifiers)
        let pass = try engine.requestTending(gardenID: garden.id)
        XCTAssertEqual(pass.dueAt, start.addingTimeInterval(300))
        XCTAssertEqual(pass.seedRevisionIDs, revisionIDs)
        XCTAssertTrue(try engine.reconcile().isEmpty)

        _ = try repository.reviseSeed(
            seedID: seedIDs[0], revisionID: uuid(91),
            text: "A later edit that must not rewrite old evidence.",
            at: start.addingTimeInterval(120), mutationID: uuid(92)
        )
        clock.advance(by: 300)
        let completed = try engine.reconcile()
        XCTAssertEqual(completed.count, 1)
        let bloom = try XCTUnwrap(completed.first)
        XCTAssertEqual(bloom.evidence.count, 3)
        XCTAssertEqual(bloom.evidence.map(\.seedRevisionID), revisionIDs)
        XCTAssertTrue(bloom.isStale)
        XCTAssertEqual(bloom.evidence.first?.sourceText, texts[0])
        XCTAssertTrue(try engine.reconcile().isEmpty)

        try repository.appendResponse(id: uuid(93), bloomID: bloom.id, kind: .kept, note: nil, at: clock.now, mutationID: uuid(94))
        let kept = try repository.bloomDetail(id: bloom.id)
        XCTAssertEqual(kept.latestResponse, .kept)
        XCTAssertEqual(kept.evidence.first?.sourceText, texts[0])
        XCTAssertEqual(try repository.pendingOutboxCount(), 7)
    }

    func testDuplicateTendingRequestsReuseTheQueuedPass() throws {
        let repository = InMemoryGardenRepository()
        let garden = try repository.createGarden(id: uuid(100), name: "Queue", at: start)
        for index in 0..<3 {
            _ = try repository.plantSeed(
                gardenID: garden.id, seedID: uuid(101 + index * 3), revisionID: uuid(102 + index * 3),
                text: "Seed \(index)", at: start, mutationID: uuid(103 + index * 3)
            )
        }
        let identifiers = SequenceGardenIdentifierGenerator(values: (120...180).map(uuid))
        let engine = LocalTendingEngine(repository: repository, clock: MutableGardenClock(now: start), identifiers: identifiers)
        let first = try engine.requestTending(gardenID: garden.id)
        let second = try engine.requestTending(gardenID: garden.id)
        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(try repository.passes(gardenID: garden.id).count, 1)
    }

    private func uuid(_ value: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", value))!
    }
}
#endif

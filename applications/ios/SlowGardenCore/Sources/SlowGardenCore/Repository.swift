import Foundation

@MainActor
public protocol GardenRepository: AnyObject {
    func ensureDefaultGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary
    func gardens(includeArchived: Bool) throws -> [GardenSummary]
    func createGarden(id: UUID, name: String, at date: Date) throws -> GardenSummary
    func renameGarden(id: UUID, name: String, at date: Date, mutationID: UUID) throws
    func setGardenArchived(id: UUID, archived: Bool, at date: Date, mutationID: UUID) throws
    func plantSeed(gardenID: UUID, seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot
    func reviseSeed(seedID: UUID, revisionID: UUID, text: String, at date: Date, mutationID: UUID) throws -> SeedSnapshot
    func seeds(gardenID: UUID) throws -> [SeedSnapshot]
    func requestPass(id: UUID, gardenID: UUID, requestedAt: Date, dueAt: Date, workflowVersion: String, snapshotItemIDs: [UUID], mutationID: UUID) throws -> GardenPassSnapshot
    func passes(gardenID: UUID) throws -> [GardenPassSnapshot]
    func duePasses(at date: Date) throws -> [GardenPassSnapshot]
    func markPassProcessing(id: UUID) throws
    func markPassFailed(id: UUID, code: String) throws
    func snapshotSeeds(passID: UUID) throws -> [SeedSnapshot]
    func completePass(passID: UUID, bloomID: UUID, claimID: UUID, evidenceIDs: [UUID], draft: BloomDraft, at date: Date, mutationID: UUID) throws -> BloomDetail
    func blooms(gardenID: UUID) throws -> [BloomSummary]
    func bloomDetail(id: UUID) throws -> BloomDetail
    func appendResponse(id: UUID, bloomID: UUID, kind: BloomResponseKind, note: String?, at date: Date, mutationID: UUID) throws
    func pendingOutboxCount() throws -> Int
}

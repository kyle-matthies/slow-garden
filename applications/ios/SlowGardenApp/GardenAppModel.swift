import Foundation
import Observation
import SlowGardenCore

enum GardenMode: String, CaseIterable, Identifiable {
    case meadow = "Meadow"
    case cabinet = "Cabinet"
    var id: Self { self }
}

@Observable
@MainActor
final class GardenAppModel {
    private let repository: any GardenRepository
    private let tendingEngine: LocalTendingEngine
    private let identifiers: any GardenIdentifierGenerator
    private let clock: any GardenClock
    private let defaults: UserDefaults

    var gardens: [GardenSummary] = []
    var selectedGardenID: UUID?
    var seeds: [SeedSnapshot] = []
    var blooms: [BloomSummary] = []
    var selectedBloom: BloomDetail?
    var latestPass: GardenPassSnapshot?
    var pendingOutboxCount = 0
    var mode: GardenMode = .meadow
    var isGardenSheetPresented = false
    var isSeedSheetPresented = false
    var seedBeingEdited: SeedSnapshot?
    var errorMessage: String?

    private static let selectedGardenKey = "slow-garden.selected-garden-id"

    init(
        repository: any GardenRepository,
        tendingEngine: LocalTendingEngine,
        identifiers: any GardenIdentifierGenerator = RandomGardenIdentifierGenerator(),
        clock: any GardenClock = SystemGardenClock(),
        defaults: UserDefaults = .standard
    ) {
        self.repository = repository
        self.tendingEngine = tendingEngine
        self.identifiers = identifiers
        self.clock = clock
        self.defaults = defaults
        bootstrap()
    }

    var selectedGarden: GardenSummary? {
        gardens.first(where: { $0.id == selectedGardenID })
    }

    var activeGardens: [GardenSummary] { gardens.filter { $0.status == .active } }
    var archivedGardens: [GardenSummary] { gardens.filter { $0.status == .archived } }
    var isSelectedGardenArchived: Bool { selectedGarden?.status == .archived }
    var canRequestTending: Bool {
        !isSelectedGardenArchived && seeds.count >= 3 && latestPass?.status != .queued && latestPass?.status != .processing
    }

    var tendingStatus: String {
        guard let latestPass else {
            return seeds.count < 3 ? "Three seeds give a bloom enough evidence." : "Ready when you are."
        }
        switch latestPass.status {
        case .queued:
            return latestPass.dueAt > clock.now ? "Growing quietly · ready in a few minutes" : "Ready when you return"
        case .processing: return "Tending your frozen sources"
        case .complete: return blooms.isEmpty ? "Tending complete" : "A bloom is ready"
        case .failed: return "Tending paused · tap to try again"
        case .cancelled: return "Tending cancelled"
        }
    }

    func selectGarden(_ id: UUID) {
        guard gardens.contains(where: { $0.id == id && $0.status == .active }) else { return }
        selectedGardenID = id
        defaults.set(id.uuidString, forKey: Self.selectedGardenKey)
        mode = .meadow
        selectedBloom = nil
        refreshGarden()
    }

    func inspectArchivedGarden(_ id: UUID) {
        guard gardens.contains(where: { $0.id == id && $0.status == .archived }) else { return }
        selectedGardenID = id
        mode = .meadow
        selectedBloom = nil
        refreshGarden()
    }

    func createGarden(named name: String) {
        perform {
            let garden = try repository.createGarden(id: identifiers.next(), name: name, at: clock.now)
            selectedGardenID = garden.id
            defaults.set(garden.id.uuidString, forKey: Self.selectedGardenKey)
            try refresh()
        }
    }

    func renameGarden(_ garden: GardenSummary, to name: String) {
        perform {
            try repository.renameGarden(id: garden.id, name: name, at: clock.now, mutationID: identifiers.next())
            try refresh()
        }
    }

    func archiveGarden(_ garden: GardenSummary) {
        guard activeGardens.count > 1 else {
            errorMessage = "Keep at least one active garden."
            return
        }
        perform {
            try repository.setGardenArchived(id: garden.id, archived: true, at: clock.now, mutationID: identifiers.next())
            if selectedGardenID == garden.id {
                selectedGardenID = try repository.gardens(includeArchived: false).first?.id
            }
            try refresh()
        }
    }

    func restoreGarden(_ garden: GardenSummary) {
        perform {
            try repository.setGardenArchived(id: garden.id, archived: false, at: clock.now, mutationID: identifiers.next())
            try refresh()
        }
    }

    func presentNewSeed() {
        seedBeingEdited = nil
        isSeedSheetPresented = true
    }

    func presentEditSeed(_ seed: SeedSnapshot) {
        seedBeingEdited = seed
        isSeedSheetPresented = true
    }

    func saveSeed(text: String) {
        guard let gardenID = selectedGardenID else { return }
        perform {
            if let seedBeingEdited {
                _ = try repository.reviseSeed(
                    seedID: seedBeingEdited.id,
                    revisionID: identifiers.next(),
                    text: text,
                    at: clock.now,
                    mutationID: identifiers.next()
                )
            } else {
                _ = try repository.plantSeed(
                    gardenID: gardenID,
                    seedID: identifiers.next(),
                    revisionID: identifiers.next(),
                    text: text,
                    at: clock.now,
                    mutationID: identifiers.next()
                )
            }
            isSeedSheetPresented = false
            self.seedBeingEdited = nil
            try refreshGardenState(gardenID: gardenID)
        }
    }

    func requestTending() {
        guard let gardenID = selectedGardenID else { return }
        perform {
            _ = try tendingEngine.requestTending(gardenID: gardenID)
            try refreshGardenState(gardenID: gardenID)
        }
    }

    func reconcile() {
        perform {
            _ = try tendingEngine.reconcile()
            if let gardenID = selectedGardenID { try refreshGardenState(gardenID: gardenID) }
        }
    }

    func openBloom(_ id: UUID) {
        perform {
            selectedBloom = try repository.bloomDetail(id: id)
            mode = .cabinet
        }
    }

    func showCabinet() {
        if let bloomID = selectedBloom?.id ?? blooms.first?.id {
            openBloom(bloomID)
        } else {
            mode = .cabinet
        }
    }

    func respond(_ kind: BloomResponseKind, note: String? = nil) {
        guard let bloomID = selectedBloom?.id else { return }
        perform {
            try repository.appendResponse(
                id: identifiers.next(), bloomID: bloomID, kind: kind, note: note,
                at: clock.now, mutationID: identifiers.next()
            )
            selectedBloom = try repository.bloomDetail(id: bloomID)
            if let gardenID = selectedGardenID { try refreshGardenState(gardenID: gardenID, preserveBloom: true) }
        }
    }

    private func bootstrap() {
        perform {
            let defaultGarden = try repository.ensureDefaultGarden(id: identifiers.next(), name: "First Garden", at: clock.now)
            let rememberedID = defaults.string(forKey: Self.selectedGardenKey).flatMap(UUID.init(uuidString:))
            let active = try repository.gardens(includeArchived: false)
            selectedGardenID = active.contains(where: { $0.id == rememberedID }) ? rememberedID : defaultGarden.id
            try refresh()
        }
    }

    private func refresh() throws {
        gardens = try repository.gardens(includeArchived: true)
        if let gardenID = selectedGardenID, gardens.contains(where: { $0.id == gardenID && $0.status == .active }) {
            try refreshGardenState(gardenID: gardenID)
        } else if let first = gardens.first(where: { $0.status == .active }) {
            selectedGardenID = first.id
            try refreshGardenState(gardenID: first.id)
        }
    }

    private func refreshGarden() {
        guard let gardenID = selectedGardenID else { return }
        perform { try refreshGardenState(gardenID: gardenID) }
    }

    private func refreshGardenState(gardenID: UUID, preserveBloom: Bool = false) throws {
        gardens = try repository.gardens(includeArchived: true)
        seeds = try repository.seeds(gardenID: gardenID)
        blooms = try repository.blooms(gardenID: gardenID)
        latestPass = try repository.passes(gardenID: gardenID).first
        pendingOutboxCount = try repository.pendingOutboxCount()
        if preserveBloom, let bloomID = selectedBloom?.id {
            selectedBloom = try repository.bloomDetail(id: bloomID)
        } else if let selectedBloom, selectedBloom.gardenID != gardenID {
            self.selectedBloom = nil
        }
    }

    private func perform(_ operation: () throws -> Void) {
        do {
            try operation()
            errorMessage = nil
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Something interrupted the garden. Your sources are unchanged."
        }
    }
}

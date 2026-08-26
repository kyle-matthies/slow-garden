import SwiftUI
import SlowGardenCore

@main
struct SlowGardenApp: App {
    @State private var model: GardenAppModel?

    init() {
        do {
            let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
            let repository: any GardenRepository
            let tendingDelay: TimeInterval
            if isUITesting {
                repository = InMemoryGardenRepository()
                tendingDelay = 0
            } else {
            #if os(iOS)
                let storeURL = try SlowGardenStore.defaultStoreURL()
                let container = try SlowGardenStore.makeContainer(storeURL: storeURL)
                repository = SwiftDataGardenRepository(container: container)
            #else
                repository = InMemoryGardenRepository()
            #endif
                tendingDelay = LocalTendingEngine.delay
            }
            let engine = LocalTendingEngine(repository: repository, delay: tendingDelay)
            _model = State(initialValue: GardenAppModel(repository: repository, tendingEngine: engine))
        } catch {
            _model = State(initialValue: nil)
        }
    }

    var body: some Scene {
        WindowGroup {
            if let model {
                GardenRootView(model: model)
                    .preferredColorScheme(.light)
            } else {
                ContentUnavailableView(
                    "The garden could not open",
                    systemImage: "lock.trianglebadge.exclamationmark",
                    description: Text("Your local sources were not changed. Close and reopen Slow Garden before trying recovery.")
                )
                .preferredColorScheme(.light)
            }
        }
    }
}

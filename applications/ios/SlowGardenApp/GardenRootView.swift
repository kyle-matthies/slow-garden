import SwiftUI
import SlowGardenCore

struct GardenRootView: View {
    @Bindable var model: GardenAppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            GardenTheme.canvas.ignoresSafeArea()
            VStack(spacing: 0) {
                GardenHeader(model: model)
                Group {
                    switch model.mode {
                    case .meadow: MeadowView(model: model)
                    case .cabinet: CabinetView(model: model)
                    }
                }
                .animation(.easeInOut(duration: 0.28), value: model.mode)
            }
        }
        .sheet(isPresented: $model.isGardenSheetPresented) { GardenManagerView(model: model) }
        .sheet(isPresented: $model.isSeedSheetPresented) { SeedEditorView(model: model) }
        .alert("The garden paused", isPresented: errorBinding) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Your sources are unchanged.")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.reconcile() }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if scenePhase == .active { model.reconcile() }
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })
    }
}

private struct GardenHeader: View {
    @Bindable var model: GardenAppModel

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Slow Garden", systemImage: "wind")
                        .font(.system(.title2, design: .serif, weight: .semibold))
                        .foregroundStyle(GardenTheme.ink)
                    Text(model.tendingStatus)
                        .font(.caption)
                        .foregroundStyle(GardenTheme.secondaryInk)
                }
                Spacer()
                Button {
                    model.isGardenSheetPresented = true
                } label: {
                    HStack(spacing: 5) {
                        Text(model.selectedGarden?.name ?? "Garden").lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2.bold())
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.white.opacity(0.72), in: Capsule())
                }
                .accessibilityIdentifier("garden-manager-button")
            }

            Picker("Garden view", selection: $model.mode) {
                ForEach(GardenMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("garden-mode-picker")
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(.ultraThinMaterial.opacity(0.82))
    }
}

enum GardenTheme {
    static let canvas = Color(red: 0.95, green: 0.95, blue: 0.89)
    static let ink = Color(red: 0.13, green: 0.19, blue: 0.13)
    static let secondaryInk = Color(red: 0.29, green: 0.37, blue: 0.28)
    static let leaf = Color(red: 0.20, green: 0.43, blue: 0.25)
    static let moss = Color(red: 0.42, green: 0.55, blue: 0.34)
    static let paper = Color(red: 0.99, green: 0.98, blue: 0.93)
    static let blush = Color(red: 0.93, green: 0.68, blue: 0.56)
}

import SwiftUI
import SlowGardenCore

struct GardenManagerView: View {
    @Bindable var model: GardenAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var newGardenName = ""
    @State private var renameGarden: GardenSummary?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            List {
                activeGardenSection
                newGardenSection
                archivedGardenSection
                localOnlySection
            }
            .navigationTitle("Gardens")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Rename garden", isPresented: Binding(
                get: { renameGarden != nil },
                set: { if !$0 { renameGarden = nil } }
            )) {
                TextField("Garden name", text: $renameText)
                Button("Cancel", role: .cancel) { renameGarden = nil }
                Button("Rename") {
                    if let renameGarden { model.renameGarden(renameGarden, to: renameText) }
                    renameGarden = nil
                }
            }
        }
    }

    private var activeGardenSection: some View {
        Section("Active gardens") {
            ForEach(model.activeGardens) { garden in
                activeGardenRow(garden)
            }
        }
    }

    private func activeGardenRow(_ garden: GardenSummary) -> some View {
        Button {
            model.selectGarden(garden.id)
            dismiss()
        } label: {
            HStack {
                Image(systemName: garden.id == model.selectedGardenID ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(GardenTheme.leaf)
                Text(garden.name).foregroundStyle(GardenTheme.ink)
                Spacer()
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("Archive", systemImage: "archivebox") { model.archiveGarden(garden) }
                .tint(.orange)
            Button("Rename", systemImage: "pencil") {
                renameGarden = garden
                renameText = garden.name
            }
            .tint(GardenTheme.leaf)
        }
    }

    private var newGardenSection: some View {
        Section("New garden") {
            TextField("Garden name", text: $newGardenName)
            Button("Create garden", systemImage: "plus") {
                model.createGarden(named: newGardenName)
                newGardenName = ""
            }
            .disabled(newGardenName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("create-garden-button")
        }
    }

    @ViewBuilder
    private var archivedGardenSection: some View {
        if !model.archivedGardens.isEmpty {
            Section("Archived") {
                ForEach(model.archivedGardens) { garden in
                    HStack {
                        Button(garden.name) {
                            model.inspectArchivedGarden(garden.id)
                            dismiss()
                        }
                        Spacer()
                        Button("Restore") { model.restoreGarden(garden) }
                    }
                }
            }
        }
    }

    private var localOnlySection: some View {
        Section {
            Label("All changes are local to this iPhone in this milestone.", systemImage: "lock.iphone")
                .font(.caption)
                .foregroundStyle(GardenTheme.secondaryInk)
        }
    }
}

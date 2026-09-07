import SwiftUI

struct SeedEditorView: View {
    @Bindable var model: GardenAppModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var title = ""
    @State private var connectionScope: ConnectionScope = .withinPlot
    @State private var text = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(model.seedBeingEdited == nil ? "Put down the unfinished version." : "A revision preserves what came before.")
                    .font(.system(.title3, design: .serif, weight: .semibold))
                    .foregroundStyle(GardenTheme.ink)
                if model.seedBeingEdited == nil {
                    TextField("Seed name", text: $title)
                        .textInputAutocapitalization(.sentences)
                        .padding(12)
                        .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                Picker("Proposed connection scope", selection: $connectionScope) {
                    Text("Isolated").tag(ConnectionScope.isolated)
                    Text("This plot").tag(ConnectionScope.withinPlot)
                    Text("Whole garden").tag(ConnectionScope.acrossGarden)
                }
                .pickerStyle(.segmented)
                .disabled(true)
                Text("Connection controls are not active in this local prototype. Its sample return uses three seeds; no AI runs.")
                    .font(.caption)
                    .foregroundStyle(GardenTheme.secondaryInk)
                TextEditor(text: $text)
                    .focused($focused)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(GardenTheme.leaf.opacity(0.15)))
                    .accessibilityIdentifier("seed-text-editor")
                Label("Slow Garden will not answer, autocomplete, or rearrange this thought.", systemImage: "leaf")
                    .font(.caption)
                    .foregroundStyle(GardenTheme.secondaryInk)
                Spacer()
            }
            .padding(20)
            .background(GardenTheme.canvas.ignoresSafeArea())
            .navigationTitle(model.seedBeingEdited == nil ? "Plant a seed" : "Revise seed")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { model.saveSeed(title: title, connectionScope: connectionScope, text: text) }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("save-seed-button")
                }
            }
            .onAppear {
                title = model.seedBeingEdited?.title ?? ""
                connectionScope = model.seedBeingEdited?.connectionScope ?? .withinPlot
                text = model.seedBeingEdited?.text ?? ""
                focused = true
            }
        }
        .interactiveDismissDisabled(!text.isEmpty && text != model.seedBeingEdited?.text)
    }
}

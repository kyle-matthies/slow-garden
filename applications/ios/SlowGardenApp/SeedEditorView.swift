import SwiftUI

struct SeedEditorView: View {
    @Bindable var model: GardenAppModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var text = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(model.seedBeingEdited == nil ? "Put down the unfinished version." : "A revision preserves what came before.")
                    .font(.system(.title3, design: .serif, weight: .semibold))
                    .foregroundStyle(GardenTheme.ink)
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
                    Button("Save") { model.saveSeed(text: text) }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("save-seed-button")
                }
            }
            .onAppear {
                text = model.seedBeingEdited?.text ?? ""
                focused = true
            }
        }
        .interactiveDismissDisabled(!text.isEmpty && text != model.seedBeingEdited?.text)
    }
}

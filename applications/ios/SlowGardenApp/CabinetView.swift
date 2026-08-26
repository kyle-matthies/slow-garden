import SwiftUI
import SlowGardenCore

struct CabinetView: View {
    @Bindable var model: GardenAppModel

    var body: some View {
        ScrollView {
            if let bloom = model.selectedBloom {
                VStack(spacing: 18) {
                    specimen(bloom)
                    evidence(bloom)
                    meaning(bloom)
                    responseControls(bloom)
                }
                .padding(20)
            } else {
                ContentUnavailableView(
                    "No clippings yet",
                    systemImage: "camera.macro",
                    description: Text("Plant three seeds and let them grow. The Cabinet will keep the evidence here.")
                )
                .padding(.top, 90)
                Button("Return to meadow") { model.mode = .meadow }
                    .buttonStyle(GardenSecondaryButtonStyle())
                    .padding(20)
            }
        }
        .background(
            LinearGradient(colors: [GardenTheme.canvas, .white.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        )
    }

    private func specimen(_ bloom: BloomDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Selected bloom", systemImage: "camera.macro")
                .font(.caption.bold()).textCase(.uppercase).foregroundStyle(GardenTheme.leaf)
            Text(bloom.title)
                .font(.system(.title, design: .serif, weight: .semibold))
                .foregroundStyle(GardenTheme.ink)
            Image("PressedCosmos")
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 310)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Pressed white cosmos specimen")
            HStack {
                Text("Cosmos bipinnatus").italic()
                Spacer()
                Text(bloom.createdAt, format: .dateTime.month(.abbreviated).day())
            }
            .font(.caption)
            .foregroundStyle(GardenTheme.secondaryInk)
            if bloom.isStale {
                Label("Some evidence comes from an earlier version", systemImage: "clock.arrow.circlepath")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("stale-evidence-indicator")
            }
        }
        .padding(20)
        .background(GardenTheme.paper, in: RoundedRectangle(cornerRadius: 4))
        .rotationEffect(.degrees(-0.35))
        .shadow(color: GardenTheme.ink.opacity(0.12), radius: 14, y: 8)
    }

    private func evidence(_ bloom: BloomDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Evidence").font(.caption.bold()).textCase(.uppercase).foregroundStyle(GardenTheme.leaf)
                    Text("Source clippings").font(.system(.title2, design: .serif, weight: .semibold))
                }
                Spacer()
                Label("\(bloom.evidence.count)", systemImage: "square.stack.3d.up")
                    .font(.caption.bold())
            }
            ForEach(bloom.evidence) { item in
                DisclosureGroup {
                    Text(item.sourceText)
                        .font(.body)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                } label: {
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Text("Source seed").font(.caption2.bold()).textCase(.uppercase)
                            Spacer()
                            Text("v\(item.revisionNumber)").font(.caption.monospaced())
                        }
                        Text(item.sourceCreatedAt, format: .dateTime.month(.abbreviated).day())
                            .font(.caption).foregroundStyle(GardenTheme.secondaryInk)
                        Text("“\(item.excerpt)”")
                            .font(.system(.body, design: .serif)).italic()
                        if item.isEarlierVersion {
                            Label("Earlier version", systemImage: "clock")
                                .font(.caption2.bold()).foregroundStyle(.orange)
                        }
                    }
                }
                .tint(GardenTheme.leaf)
                .padding(16)
                .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 3))
                .overlay(RoundedRectangle(cornerRadius: 3).stroke(GardenTheme.ink.opacity(0.08)))
                .accessibilityIdentifier("evidence-\(item.seedRevisionID.uuidString)")
            }
        }
    }

    private func meaning(_ bloom: BloomDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Connection · 3 sources", systemImage: "point.3.connected.trianglepath.dotted")
                .font(.subheadline.bold())
            Text(bloom.claim).font(.body)
            Divider()
            Label("Uncertainty", systemImage: "circle.dotted")
                .font(.subheadline.bold())
            Text(bloom.uncertainty).font(.body).foregroundStyle(GardenTheme.secondaryInk)
            Text("Local prototype bloom · no note content left this iPhone")
                .font(.caption2.weight(.medium)).foregroundStyle(GardenTheme.secondaryInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(GardenTheme.leaf.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder
    private func responseControls(_ bloom: BloomDetail) -> some View {
        VStack(spacing: 14) {
            ViewThatFits {
                HStack(spacing: 10) { responseButtons(bloom) }
                VStack(spacing: 10) { responseButtons(bloom) }
            }
            if let response = bloom.latestResponse {
                Text(receipt(for: response))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(GardenTheme.secondaryInk)
                    .accessibilityIdentifier("response-receipt")
            }
            Button {
                model.mode = .meadow
            } label: {
                Label("Return to meadow", systemImage: "arrow.left")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(GardenSecondaryButtonStyle())
            .accessibilityIdentifier("return-to-meadow-button")
        }
    }

    @ViewBuilder
    private func responseButtons(_ bloom: BloomDetail) -> some View {
        ResponseButton(title: "Keep", icon: "checkmark", selected: bloom.latestResponse == .kept) { model.respond(.kept) }
        ResponseButton(title: "Correct", icon: "pencil", selected: bloom.latestResponse == .corrected) { model.respond(.corrected) }
        ResponseButton(title: "Prune", icon: "xmark", selected: bloom.latestResponse == .pruned) { model.respond(.pruned) }
    }

    private func receipt(for response: BloomResponseKind) -> String {
        switch response {
        case .kept: "Kept in your garden"
        case .corrected: "Correction noted for the next tending"
        case .pruned: "Pruned without changing your source notes"
        }
    }
}

private struct ResponseButton: View {
    let title: String
    let icon: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon).frame(maxWidth: .infinity)
        }
        .font(.subheadline.weight(.semibold))
        .padding(.vertical, 12)
        .foregroundStyle(selected ? .white : GardenTheme.ink)
        .background(selected ? GardenTheme.leaf : .white.opacity(0.82), in: Capsule())
        .accessibilityIdentifier("response-\(title.lowercased())")
    }
}

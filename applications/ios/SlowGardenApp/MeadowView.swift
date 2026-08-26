import SwiftUI
import SlowGardenCore

struct MeadowView: View {
    @Bindable var model: GardenAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Image("MeadowBackground")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .accessibilityHidden(true)
                LinearGradient(
                    colors: [.white.opacity(0.12), .clear, GardenTheme.leaf.opacity(0.13)],
                    startPoint: .top,
                    endPoint: .bottom
                )

                if model.seeds.isEmpty {
                    emptyGarden
                        .position(x: geometry.size.width / 2, y: geometry.size.height * 0.40)
                } else {
                    ForEach(Array(model.seeds.enumerated()), id: \.element.id) { index, seed in
                        SeedFlower(seed: seed, index: index, reduceMotion: reduceMotion) {
                            model.presentEditSeed(seed)
                        }
                        .position(position(for: index, in: geometry.size))
                    }
                }

                VStack {
                    if let bloom = model.blooms.first {
                        BloomRevealCard(bloom: bloom) { model.openBloom(bloom.id) }
                            .padding(.horizontal, 22)
                            .padding(.top, 20)
                            .transition(.scale(scale: 0.95).combined(with: .opacity))
                    }
                    Spacer()
                    bottomControls
                        .padding(.horizontal, 20)
                        .padding(.bottom, 18)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Garden meadow")
    }

    private var emptyGarden: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.macro")
                .font(.system(size: 42, weight: .light))
                .foregroundStyle(GardenTheme.leaf)
            Text("A quiet place for unfinished thoughts")
                .font(.system(.title3, design: .serif, weight: .semibold))
                .multilineTextAlignment(.center)
            Text("Plant a fragment. Nothing will answer or rearrange it.")
                .font(.subheadline)
                .foregroundStyle(GardenTheme.secondaryInk)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: 310)
        .background(.ultraThinMaterial.opacity(0.82), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var bottomControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    model.presentNewSeed()
                } label: {
                    Label("Plant a seed", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(GardenPrimaryButtonStyle())
                .disabled(model.isSelectedGardenArchived)
                .accessibilityIdentifier("plant-seed-button")

                Button {
                    model.requestTending()
                } label: {
                    Label("Let this grow", systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(GardenSecondaryButtonStyle())
                .disabled(!model.canRequestTending)
                .accessibilityIdentifier("request-tending-button")
            }
            HStack {
                Image(systemName: model.isSelectedGardenArchived ? "archivebox" : "iphone")
                Text(model.isSelectedGardenArchived ? "Archived · read only" : "Saved on this iPhone")
                Spacer()
                Text("\(model.pendingOutboxCount) local changes")
            }
            .font(.caption2.weight(.medium))
            .foregroundStyle(GardenTheme.secondaryInk)
            .padding(.horizontal, 4)
        }
        .padding(12)
        .background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func position(for index: Int, in size: CGSize) -> CGPoint {
        let positions: [(CGFloat, CGFloat)] = [
            (0.23, 0.34), (0.69, 0.40), (0.43, 0.58), (0.79, 0.65),
            (0.17, 0.69), (0.55, 0.76), (0.33, 0.82), (0.84, 0.28),
        ]
        let value = positions[index % positions.count]
        return CGPoint(x: size.width * value.0, y: size.height * value.1)
    }
}

private struct SeedFlower: View {
    let seed: SeedSnapshot
    let index: Int
    let reduceMotion: Bool
    let action: () -> Void
    @State private var drifting = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                ZStack {
                    ForEach(0..<6, id: \.self) { petal in
                        Capsule()
                            .fill(petalColor.opacity(0.92))
                            .frame(width: 18, height: 34)
                            .offset(y: -15)
                            .rotationEffect(.degrees(Double(petal) * 60))
                    }
                    Circle().fill(.yellow.opacity(0.88)).frame(width: 17, height: 17)
                }
                Rectangle().fill(GardenTheme.leaf.opacity(0.78)).frame(width: 2, height: 34)
                Text(seed.text)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(GardenTheme.ink)
                    .lineLimit(2)
                    .frame(width: 104)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 5)
                    .background(GardenTheme.paper.opacity(0.82), in: RoundedRectangle(cornerRadius: 10))
            }
            .rotationEffect(reduceMotion ? .zero : .degrees(drifting ? 1.5 : -1.5), anchor: .bottom)
            .animation(reduceMotion ? nil : .easeInOut(duration: 3.2 + Double(index % 3)).repeatForever(autoreverses: true), value: drifting)
        }
        .buttonStyle(.plain)
        .onAppear { drifting = true }
        .accessibilityLabel("Seed, revision \(seed.revisionNumber): \(seed.text)")
        .accessibilityHint("Opens this seed for editing")
        .accessibilityIdentifier("seed-\(seed.id.uuidString)")
    }

    private var petalColor: Color {
        [Color.white, GardenTheme.blush, Color(red: 0.80, green: 0.74, blue: 0.91)][index % 3]
    }
}

private struct BloomRevealCard: View {
    let bloom: BloomSummary
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("A bloom is ready", systemImage: "sparkles")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(GardenTheme.leaf)
            Text(bloom.title)
                .font(.system(.title3, design: .serif, weight: .semibold))
                .foregroundStyle(GardenTheme.ink)
            Button(action: action) {
                Label("Review clipping", systemImage: "camera.macro")
                    .font(.subheadline.weight(.semibold))
            }
            .accessibilityIdentifier("review-bloom-button")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(GardenTheme.paper.opacity(0.94), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: GardenTheme.ink.opacity(0.12), radius: 16, y: 8)
    }
}

struct GardenPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.vertical, 13)
            .foregroundStyle(.white)
            .background(GardenTheme.leaf.opacity(configuration.isPressed ? 0.78 : 1), in: Capsule())
    }
}

struct GardenSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.vertical, 13)
            .foregroundStyle(isEnabled ? GardenTheme.ink : GardenTheme.secondaryInk.opacity(0.5))
            .background(.white.opacity(isEnabled ? 0.86 : 0.45), in: Capsule())
            .overlay(Capsule().stroke(GardenTheme.leaf.opacity(isEnabled ? 0.25 : 0.08)))
    }
}

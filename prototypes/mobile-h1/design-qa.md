# Slow Garden mobile prototype design QA

Date: 2026-08-25

## Comparison target

- Source visual truth paths:
  - `../../documents/design/references/mobile-meadow.png`
  - `../../documents/design/references/mobile-cabinet.png`
- Browser-rendered implementation screenshot paths:
  - `qa-meadow.png`
  - `qa-cabinet.png`
- Full-view comparison evidence:
  - `qa-comparison-meadow.png`
  - `qa-comparison-cabinet.png`
- Local implementation URL: `http://127.0.0.1:4173/`
- States: default Meadow; default Cabinet with the same selected bloom and three source revisions.

## Normalization

- Source pixels: 852 x 1842 for each generated mobile target.
- Implementation pixels: 393 x 852 for each browser-rendered app viewport capture.
- CSS viewport: 393 x 852 at device scale factor 1.
- Runtime measurement: `[data-phone-screen]` measured exactly 393 x 852 CSS pixels before capture.
- Density normalization: each source was downsampled to 393 x 852 with Lanczos filtering; source and implementation were then joined at equal pixel dimensions into a 786 x 852 comparison board.
- The implementation includes the protected live iOS status bar and home indicator supplied by the mobile prototype runtime. The source target intentionally contains app content only; this chrome difference is excluded from app-fidelity findings.

## Findings

No actionable P0, P1, or P2 differences remain.

- [P3] The implementation uses Georgia/system fallbacks rather than the source target's exact editorial display face. Its hierarchy, wrapping, weight contrast, and reflective character remain close at the test size.
- [P3] The Meadow bloom card is slightly larger and the source slips are more restrained than in the target. This improves first-prototype legibility without changing the open-field hierarchy.
- [P3] Cabinet uses adjacency and source-card identity rather than the target's fine drawn provenance connectors. The same bloom, source count, exact excerpts, revisions, and response controls remain visually explicit; connector treatment should be revisited with a real asset or native drawing layer.

## Required fidelity surfaces

- Fonts and typography: serif/sans hierarchy, weights, line heights, labels, wrapping, and action text are coherent and legible. Exact display-font selection remains P3 polish.
- Spacing and layout rhythm: both views fit the 393 x 852 screen; primary controls clear the home indicator; Meadow remains spacious; Cabinet shows specimen, all three evidence cards, uncertainty, and review actions without scrolling.
- Colors and visual tokens: pale cyan, field green, warm ivory, botanical green, evidence blue, and restrained prune coral match the source system with adequate foreground contrast.
- Image quality and asset fidelity: generated meadow and pressed-cosmos assets match subject, crop, palette, and density. No visible custom imagery was replaced by emoji, placeholder art, inline SVG, or CSS drawing.
- Copy and content: titles, dates, source types, excerpts, source count, uncertainty, Keep/Correct/Prune, Return to meadow, and Plant a seed match the selected target and product contract.

## Focused region comparison

A separate crop was not needed after the final 1:1 capture. The native-size 786 x 852 comparison boards keep the wordmark, segmented control, bloom title, specimen, evidence excerpts, uncertainty, and all primary controls readable together; those were inspected directly in the combined inputs.

## Comparison history

### Iteration 1

- Earlier P2 finding: the Meadow Plant a seed control and two source slips fell below the first viewport, changing the target's one-screen composition.
- Fix: reduced bloom-card density, moved source slips into the visible neighborhood, shortened the stage, and raised the thumb action above the safe area.
- Post-fix evidence: `qa-comparison-meadow.png` shows all three source markers and the complete Plant a seed control in the same 393 x 852 state as the source.

### Iteration 2

- Earlier P2 finding: Cabinet showed the specimen first but pushed evidence and response controls below the first viewport, weakening the evidence-first character selected by Kyle.
- Fix: adopted the target's paired specimen-and-clippings scrapbook layout at standard text size, compacted metadata, and retained a stacked-layout requirement for Dynamic Type or narrower widths.
- Post-fix evidence: `qa-comparison-cabinet.png` shows the specimen, all three exact source cards, connection, uncertainty, and Keep/Correct/Prune in one 393 x 852 state.

## Interaction and runtime verification

- Meadow/Cabinet segmented navigation works.
- Review clipping opens Cabinet for the same bloom.
- Plant a seed opens the phone-scoped sheet, accepts keyboard-aware text, closes, and shows a planted-source receipt.
- Keep, Correct, and Prune produce distinct response states; Keep receipt verified.
- Return to meadow works.
- Browser console errors checked after the final implementation: none.
- `npm run check:runtime`: passed.
- `npm run build`: passed.
- `npm run test:sites`: 4 passed, 0 failed.

## Follow-up polish

- Select and bundle the production editorial serif during native token work.
- Test the paired Cabinet layout with Dynamic Type and switch to the documented stacked form when readability falls below the accessibility threshold.
- Add provenance connectors through a real native/web drawing asset only if comprehension testing shows adjacency and exact source cards are insufficient.

final result: passed

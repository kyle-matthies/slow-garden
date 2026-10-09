# Garden asset manifest

Each image shipped under `applications/web/public/garden/` must have a row here before
it merges. Record provenance and usage rights, not prompts alone. Assets that were
generated must record the generator and the date. Licensed assets must link their
licence. Personal or private imagery never belongs in this library.

| Path | Subject | Source | Generator or licence | Date | Dimensions | Notes |
|---|---|---|---|---|---|---|
| `applications/web/public/meadow-background.png` | Meadow field, portrait | Generated reference set for the H1 prototype (`prototypes/mobile-h1`, bf3bfda) | Owner-run image generation (Codex), owner-held rights | 2026-08-25 | 853 × 1844 | Landing and login only; too narrow for desktop scene layers |
| `prototypes/mobile-h1/public/assets/slow-garden/pressed-cosmos.png` | Pressed white cosmos on paper with tape | Generated reference set for the H1 prototype | Owner-run image generation (Codex), owner-held rights | 2026-08-25 | 971 × 1619, RGB | Source for `public/garden/specimens/cosmos-*.webp`; paper background, use with multiply blend |

## Library requirements (from the scrapbook roadmap, gate 2)

- Pressed specimens: transparent or paper-neutral background; widths 320, 640 and
  1280 px; WebP (AVIF optional); one stable file per species in
  `src/lib/garden/species.ts`.
- Environment layers: far, mid and near per palette (dawn, morning, golden hour, dusk,
  night). Desktop at 2560 px wide and phone at 1290 px wide. Seamless horizontally,
  so a layer can wrap around the ring.
- Paper, tape and paperclip textures: small and tileable, and kept to at most 40 KB each.
- Until a photograph exists, the procedural pressed rendering in
  `src/app/garden/scene/plant/` stands in, so the scene never shows a broken image.

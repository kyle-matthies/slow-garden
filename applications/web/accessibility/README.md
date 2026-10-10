# web-accessibility

Self-contained axe / responsive / contrast check harness for the web app.
It never touches Supabase — the dev server runs without Supabase env vars and all
garden states render synthetic fixture data via `/dev/axe-fixtures`
(`GARDEN_AXE_FIXTURES=1`, a route that 404s in normal builds).

## Run

```sh
cd applications/web/accessibility
npm ci
npx playwright install chromium
npm run axe
```

Checks, per page state (landing, login, error, loading, garden
overview/topic/thought/archive):

- axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`) in light and dark
  `prefers-color-scheme`, at 390x844 (mobile, dsf 2) and 1280x800.
- No horizontal overflow at 390px.
- 200% zoom proxy (640x400 CSS px) for landing, login, garden-thought: no
  overflow, h1 and primary action visible.
- WCAG contrast ratios for key text selectors, written to
  `documents/initiatives/receipts/08/contrast.json`.

Exits non-zero on any serious/critical violation, overflow, or AA contrast
failure. Screenshots land in `documents/initiatives/receipts/08/`.

`AXE_CHROMIUM` points at a preinstalled Chromium when Playwright's own is absent, and
`AXE_RECEIPTS` writes the receipt set elsewhere (the living garden's receipts live in
`documents/initiatives/receipts/living-garden/`).

## Performance

```sh
cd applications/web && npm run build
cd accessibility && npm run perf
```

`perf-check.mjs` serves the production build with fixtures enabled and drags a
synthetic tended garden (100 and 1,000 thoughts) round for 10 s at 1280 and at 390
with 4× CPU throttling and touch input. It traces main-thread frame cost (with 2D
canvas rasterisation reported separately), rAF intervals, image weight, and idle
busy time with and without reduced motion, against the ADR-007 budgets. Results go
to `documents/initiatives/receipts/living-garden/performance.json`
(`PERF_RECEIPTS` overrides the folder); exits non-zero when a budget is missed.

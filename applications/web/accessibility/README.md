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

Checks, per page state (landing, login, error, loading, first run, first run with a
seed pack opened, import; the
Meadow at garden, topic and focus level; Pages at garden, topic and thought
level; the thought page over the Meadow; Returns with blooms, empty, and with the
full record open; the morning reveal over the Meadow and in Pages; archive, the
ring of all gardens, the More menu (a sheet above the phone tab bar), the writing
page with the caret in it, the delete dialog open for an entry and for the
account, settings and topic settings):

- axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`) in light and dark
  `prefers-color-scheme`, at 360x740, 390x844 and 844x390 landscape (all touch,
  dsf 2) and 1280x800.
- No horizontal overflow on the three touch viewports.
- Every visible control on the touch viewports is at least 44x44 CSS px. Not
  counted: links inside a sentence, a checkbox or radio inside its label, Meadow
  plants (their target is a centred 44px pseudo-element), and controls on ring
  cards that are not the selected one (3D-scaled copies; see the comment on
  `TARGET_EXCEPTION`). `AXE_TARGET_MIN=60` shows the check failing on purpose.
- 200% zoom proxy (640x400 CSS px) for landing, login, the thought page, Returns
  and the morning reveal: no overflow, h1 and primary action visible.
- WCAG contrast ratios for key text selectors, written to
  `documents/initiatives/receipts/08/contrast.json`.

Exits non-zero on any serious/critical violation, overflow, small target, or AA
contrast failure. The fixture page switches the deletion controls on
(`?deletion=off` hides them); production reads `GARDEN_DELETION_ENABLED`. Screenshots land in `documents/initiatives/receipts/08/`.

Entrance animations are allowed to finish before colours are measured, and each
contrast state runs in a fresh browser profile so first-view receipts from one
state cannot hide the morning reveal in another.

`AXE_BASE=http://localhost:3147` checks a fixture server that is already running
(`GARDEN_AXE_FIXTURES=1`) instead of booting one on :3211, and
`AXE_STATES=garden-ring,morning-reveal` reruns only the named states and
`AXE_VIEWPORTS=360,844x390` only the named viewports (a partial run does not
rewrite `contrast.json`).
Against a production build (`next start` with `GARDEN_AXE_FIXTURES=1`, named with
`AXE_BASE`) the development-only `cabinet` state (`/garden/returns-preview`) is not
served; the run says `SKIP cabinet`, checks every other state, and leaves
`contrast.json` as it was.
`AXE_CHROMIUM` points at a preinstalled Chromium when Playwright's own is absent, and
`AXE_RECEIPTS` writes the receipt set elsewhere (the living garden's receipts live in
`documents/initiatives/receipts/living-garden/`).

## Synthetic growth journeys

```sh
cd applications/web && npm run build
cd accessibility && npm ci && npm run growth
```

The production-build journey check covers keyboard entry navigation from Continue
writing, tending history, import preview without a server write, failed-import
retry, onboarding recovery, a seed pack opened and closed in first run, the More
sheet on touch screens, the delete dialogs opened and cancelled, and the morning
reveal (shown once over the Meadow and in Pages, at most three blooms, and still
dismissed after a reload). It uses fictional fixtures at 360x740, 390x844 and
844x390 (touch) and 1280x844 in light and dark mode. Hosted credentials are removed from the server environment.
Screenshots and `journeys.json` go to `/tmp/slow-garden-growth-20261104` by default;
set `GROWTH_RECEIPTS` to choose a different directory. `AXE_CHROMIUM` also applies.
`GROWTH_BASE=http://localhost:3147` runs the same journeys against a fixture
server that is already up instead of starting the production build.

## Performance

```sh
cd applications/web && npm run build
cd accessibility && npm run perf
```

`perf-check.mjs` serves the production build with fixtures enabled and drags a
synthetic tended garden (100 and 1,000 thoughts) round for 10 s at 1280 and at 390
with 4× CPU throttling and touch input. It traces main-thread frame cost (with 2D
canvas rasterisation reported separately), rAF intervals, image weight, and idle
busy time with and without reduced motion, against the ADR-007 budgets. Each run
writes its own `documents/initiatives/receipts/living-garden/performance-<run>.json`
(name it with `PERF_RUN`; `PERF_RECEIPTS` overrides the folder) recording the commit,
Node and Chromium versions and harness settings, and exits non-zero when a budget is
missed. A 24-garden ring is measured alongside the meadow.

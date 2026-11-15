# Slow Garden market readiness delivery, wave 1 — November 15, 2026

Owner: Kyle. Execution: Claude with parallel specialist agents, on branch
`claude/charming-mccarthy-1irh6k` (draft PR #31). Base: `df3782e`.
Plan: [market readiness plan](../product/MARKET_READINESS_PLAN.md). Decision: D-023.

No migration, hosted change, new dependency, vendor choice or model activation was
made. `GARDEN_AI_ENABLED` stays false. All screens were checked against synthetic
fixtures on a local dev server; nothing here was exercised against Supabase or
production.

## Delivered

| Workstream | Outcome | State |
|---|---|---|
| A. Scene art | Sky with sun or moon, layered hills, calmer grass; each topic is a stone-bordered bed in its own hue; garden level shows neighbouring beds and topic level fills the view; plants at human scale; plants with blooms carry gold light and tags (growth untouched, D-022); specimen plate in the focus panel; repainted all-gardens ring. | Done |
| B. Wayfinding | Depth trail replaces sidebar and breadcrumb; four distinct Pages treatments (garden banner and bed cards, soil-edged topic, specimen-sheet thought, ruled dated entries); Meadow / Pages toggle; one three-value tending control; Returns in the top bar with an unseen marker; one More menu. | Done |
| C. Return ritual | Returns as dated mornings; "The garden noticed" in gold beside "Your words" clippings; quiet states for waiting, failed, withdrawn and nothing-to-offer; morning reveal card for unseen blooms. | Done |
| D. First impression | Landing leads with the method and a made-up day, night, morning example; truthful preview line while tending is off; restyled login, loading, error; one-screen first run using the existing actions. | Done |
| E. Go-to-market | [Draft](../product/GO_TO_MARKET.md): positioning, audience, competitive map, pricing hypothesis, gated launch sequence. Hypotheses, not decisions. | Draft for owner |
| F. Integration and QA | Reveal mounted and sharing one seen-state; vocabulary sweep; minimal first-run chrome; accessibility scripts updated to the new markup. | Done |

## Verification

- `eslint` 0 problems, `tsc --noEmit` 0 errors, `vitest` 116 of 116 (26 files),
  `npm run test:node` 75 of 75, at commit `9b482ed`.
- `next build` passed in an isolated copy of the tree.
- Axe run across the fixture states and viewports: contrast passes; two serious
  failures remained, both in the all-gardens ring (new-garden card contrast and a
  pointer-blocked button). See the follow-up note at the end of this file.
- An intermittent unit failure (import form, asserted before its transition
  settled) was found, root-caused and fixed.
- Visual review at 1440×900, 820×1180 and 390×844.

## Not verified

- `scripts/test-web-journeys.mjs` and `scripts/test-local-http.mjs` were updated for
  the new UI but not run: they need the local Supabase stack, which was not available
  in this environment.
- `accessibility/perf-check.mjs` (ADR-007 budgets) was not run against a production
  build. A dev-server comparison showed drag-rotation p95 at 16.7 ms on desktop and
  33 ms on a 4× throttled phone profile (67 ms before), which is indicative only.
- Revision-history styling: the history route returns 401 without a backend.
- `/Users/kylematthies/Code/bin/workspace-guard` does not exist in the cloud
  environment and was not run. The tree was clean at start.
- No real-user comprehension test. The five-second level test in the plan's exit
  criteria is a reviewer judgment so far.

## Owner decisions raised

1. Accept or amend D-023 (level system, Meadow / Pages, gold reserved for returns).
2. "Wake to a bloom" reads as a nightly guarantee, while a sparse night correctly
   returns nothing. The November 4 wave had moved the landing away from seed and bloom
   language; this wave brings "bloom" back with a concrete example. Keep or soften.
3. The landing states that in-app deletion is not built and is required before wider
   release. Accurate to the repository; confirm it should be public.
4. First run now defaults the topic to "Notes" and drops the starter-topic choices.
5. Activation go/no-go and pinned model remain the gate for everything after wave 1.

## Known gaps carried forward

- Two-topic gardens show one bed at a time in the meadow, with no neighbour visible.
- Entries have no step of their own in the depth trail.
- At garden level the Returns view scopes to the first topic with tending on.
- On phones, Returns source links stack one per line, and the reveal card sits close
  under the scene title.
- `PROJECT_BRIEF.md` still says iOS first while ADR-006 authorises web first.

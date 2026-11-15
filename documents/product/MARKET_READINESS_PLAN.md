# Market readiness plan

- Status: Active. Wave 1 in execution on `claude/charming-mccarthy-1irh6k`.
- Date: 2026-11-15
- Owner: Kyle (direction), product review by Claude acting as CPO
- Scope: web client `applications/web`. No hosted schema, vendor, or activation gate is changed by this plan.

## One-line promise

**Write by day. Wake to a bloom.** The thinking is yours; overnight, the garden is tended and returns at most three source-linked connections.

## Review: what is wrong today

Reviewed by running the app locally against synthetic fixtures at 1440×900 and 390×844.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | **Levels are indistinguishable.** Garden → Topic → Thought → Entry all render as the same cream page with the same serif title and the same card grid. In the meadow, a garden and a topic are the same field; only a small signpost changes. | "Garden overview" and a topic page differ only in the eyebrow text. | Blocker |
| 2 | **The product's point is invisible.** The overnight return lives at the bottom of the list page, below the fold, and is absent from navigation. A fully tended fixture garden looks identical to an untended one. | `GardenReturns` is mounted at line ~1054 of `workspace.tsx`; the "tended" preview shows no bloom. | Blocker |
| 3 | **The meadow reads as programmer art.** Flat gradient sky, a noisy uniform grass texture, plants 20–60px tall lost in a 900px field, no focal point, no light. | Fixture garden with two thoughts shows an empty field. | Blocker |
| 4 | **"Garden" means three things**: the top-level container, the scene view toggle ("Garden / List"), and the product. Topic AI state has three unrelated labels ("AI off", "AI permission on", "Cross-pollination on"). | Top bar and sidebar. | High |
| 5 | **Landing page hides the method.** It sells a private notes app; overnight tending is not mentioned above the fold. | `/` hero. | High |
| 6 | **First run is a form, not a moment.** Four steps of naming containers before the first word is written. | `first-run.tsx`. | Medium |
| 7 | Navigation is split across a top bar, a "More" menu, a sidebar, a floating topic bar, turn arrows and a "Continue writing" disclosure. | Workspace chrome. | Medium |

What is already strong and must be kept: the data model and provenance, revision history, export/import, RLS and security work, the tending tiers contract (ADR-008), accessibility discipline, and the test base (99 unit + 75 node tests green at baseline).

## Design direction: the field journal

One visual idea across every surface: a naturalist's field journal. Paper, ink, pressed specimens, and one living landscape. The meadow is the place; paper is where words live; **gold is reserved for what the garden returned** so AI-derived material is always recognisable and never confused with the person's writing.

### The level system (resolves finding 1)

Each level gets its own name, glyph, shape and scale. A persistent **depth trail** shows all levels with the current one marked, in both views.

| Level | Name in UI | Scene treatment | Pages treatment | Glyph |
|---|---|---|---|---|
| 0 | All gardens | Ring of framed vistas (exists) | — | horizon |
| 1 | Garden | Wide landscape; every topic is a visibly separate planted **bed** with its own dominant colour and sign | Landscape banner + beds as wide cards showing their plants | hill |
| 2 | Topic | Camera settles on one bed; it is lit, others fall back in haze; plants are large and labelled | Soil-edged bed header + thoughts as specimen cards | bed |
| 3 | Thought | One plant becomes a specimen beside its entries | Specimen sheet: plant left, dated pages right | plant |
| 4 | Entry | — | A dated paper page with visible revision trail | page |

Rules: no two levels share a header layout; level name is always the eyebrow; the depth trail is the only breadcrumb.

### Vocabulary (resolves finding 4)

- View toggle becomes **Meadow / Pages**. "Garden" only ever means the level-1 container.
- Topic AI state is one control with three values: **Tending off · Tending on · Tending on, may connect across topics**.
- AI output is always called a **bloom** (reveal) or a **mark** (catalogue). The surface is **Returns**.

## Workstreams

| Team | Owns | Outcome |
|---|---|---|
| A. Scene art | `src/app/garden/scene/**`, `src/lib/garden/scene/**` | A meadow worth a screenshot: light, depth, readable beds, plants at human scale, visible blooms. Within ADR-007 budgets. |
| B. Wayfinding | `workspace.tsx`, `globals.css`, chronology, recent-writing, tools menu, new-area | Level system, depth trail, vocabulary, one navigation model, Returns promoted to top-level. |
| C. Return ritual | `returns*.tsx`, `returns.css`, `cabinet-board.css`, new `morning-return.tsx` | The morning reveal: ≤3 blooms, evidence beside interpretation, keep / correct / prune / continue. Honest empty state. |
| D. First impression | `page.tsx`, `landing/**`, `login/**`, `first-run.*`, `layout.tsx`, `loading.tsx`, `error.tsx` | Landing that explains the method in one screen; first run that reaches the first written word fast. |
| E. Go-to-market | `documents/product/GO_TO_MARKET.md` | Positioning, audience, pricing hypothesis, launch sequence, gate map. |
| F. Integration & QA | cross-cutting, after A–D | Mount C into B, visual QA at three viewports, axe, perf, lint, tests, build. |

## Gates that stay closed

This plan does not activate a model, apply a migration, create cloud resources, or choose a vendor. Overnight tending remains off in production until the [AI activation runbook](../operations/AI_ACTIVATION_RUNBOOK.md) passes. Where the UI describes tending, it must be truthful about whether tending is active for the account; demonstrations use labelled synthetic examples.

## Path to market

1. **Wave 1 (this branch):** workstreams A–F. Exit: a new visitor can say what the product does after the landing page, can tell which level they are on at a glance, and a tended garden looks tended.
2. **Wave 2 — activation:** complete evaluation corpus v3 receipts, pin a model, run supervised tending on the owner's garden for two weeks. Owner decision required (ADR-004, activation runbook).
3. **Wave 3 — private pilot:** 10–20 invited writers for four weeks against the success definition in `PROJECT_BRIEF.md`. External-pilot gate.
4. **Wave 4 — paid beta:** pricing test, waitlist conversion, support and deletion flows exercised.
5. **Wave 5 — public launch.**

## Exit criteria for wave 1

- Five-second test: a screenshot of any level is identifiable without reading body text.
- A tended fixture garden shows its blooms without scrolling, on phone and desktop.
- Landing hero states the overnight method; no claim outruns the activation state.
- Lint, unit, node tests and production build green; axe fixtures clean; scene within ADR-007 budget.

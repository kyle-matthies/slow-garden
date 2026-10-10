# ADR-007: Living garden scene on the web

- Status: Accepted for implementation by Kyle on 2026-10-09
- Date: 2026-10-09
- Owner: Kyle
- Roadmap phase: 1.2 (visual, motion, and content design), delivered on web per ADR-006

## Context

The web writing garden shipped in the September wave as clear, functional
navigation: cards, a list of recent entries, and a two-shape decorative SVG plant.
D-020 deferred the realistic botanical aesthetic, motion, and spatial garden
navigation until writing was dependable. That condition is met.

The owner wants the garden itself to be the primary surface. It should feel like a
real garden that you move through. Plants should grow as the person tends a thought,
thoughts should float forward when focused, and returns should press into the
clipping view from the Meadow and Cabinet references. The aim is an elegant,
highly animated scene that stays readable and calm with twenty or more gardens.
Writing must stay quiet.

## Options considered

| Option | User impact | Engineering impact | Privacy/security | Cost | Reversibility |
|---|---|---|---|---|---|
| Layered 2.5D scene: DOM/SVG plants and paper, one canvas atmosphere layer, `motion` for springs, gestures and shared-element transitions | Deep, animated, readable; text stays real and selectable | One small dependency; bespoke canvas loop; works with the current CSP | No new origins; all assets same-origin | Low | High: the list view remains and the scene is an additive lens |
| Full WebGL 3D (three.js / react-three-fiber) | Most immersive | Heavy bundle, separate accessible DOM for every text, phone risk | Same | Medium | Medium |
| Prototype both, pick later | Delays real use | Throwaway work | Same | Medium | High |

## Decision

Build the living garden as a **layered 2.5D scene** inside `applications/web`, as
the default garden view. Today's card and list workspace remains as `view=list`, the
structured and accessible view, one tap away. A 3D variant may be explored later
only as a separate prototype.

- **Rendering layers:**
  - CSS sky gradient per palette.
  - SVG far hills and treeline.
  - Optional painted mid-meadow image.
  - A canvas atmosphere layer for grass, wind, pollen, and light, with no library.
  - DOM/SVG procedural plants.
  - Near-grass canvas.
  - Paper UI.
- **Motion:** add `motion` (`motion/react`, pinned in the lockfile) for springs,
  drag-to-rotate, and `layoutId` shared-element transitions. Use `LazyMotion` with
  `m` components to bound bundle size. Plant sway uses compositor-only CSS keyframes.
- **Identity:** a plant's species, hue, and form are a pure function of the thought
  ID through a species library (`src/lib/garden/species.ts`,
  `src/lib/garden/genome.ts`). The same identity drives the living plant and the
  pressed specimen.
- **Layout:** stable. A plant's slot is hashed from its ID, and collisions resolve
  by deterministic probing in creation order. Existing plants never move when
  another is planted. Stored `seeds.position_x/position_y` win when present.
- **Growth:** a pure function of the person's own history: entries, revisions, and
  distinct days written. It is monotonic and never wilts, and a well-tended thought
  flowers. AI returns never add growth; they arrive as vellum tending material. See
  [LIVING_GARDEN.md](../design/LIVING_GARDEN.md).
- **Assets:** hybrid. Living plants are procedural. Pressed specimens are
  photographic when a licensed or generated asset exists, otherwise a procedural
  pressed rendering. Environment layers are painted. Every asset is recorded in
  `documents/design/assets/ASSET_MANIFEST.md` with source, licence or generator,
  prompt, date, and dimensions. Files live under
  `applications/web/public/garden/`.

## Evidence and rationale

- `documents/design/references/mobile-meadow.png` and `mobile-cabinet.png` are the
  accepted visual target (D-015). The prototype and iOS slice reached only part of
  them (static photo, no motion, no press transition).
- The current CSP (`applications/web/next.config.ts`) allows same-origin images,
  `blob:` workers, and inline styles. The 2.5D stack needs no policy change.
  WebGL would also fit but buys immersion at the cost of accessibility and phone
  performance.
- `motion@14` declares React 18/19 peer support; the app runs React 19.2.

## Consequences

- **Easier:** the garden becomes legible at a glance, growth is visible, and the
  Meadow/Cabinet references become reachable.
- **Harder:** frame-time and image-weight budgets must be measured on every scene
  change. The axe contrast harness must learn the new paper surfaces.
- **Newly required:**
  - JS-driven motion must honour `prefers-reduced-motion` itself, because the global
    CSS kill switch does not reach `requestAnimationFrame`.
  - The scene pauses when hidden, offscreen, or while the person writes.
- **Unchanged:**
  - Data model, IDs, permissions, writing editor, durable drafts, and export.
  - No chat, autocomplete, live critique, or automatic rearrangement.

## Budgets

- p95 frame time ≤ 20 ms during a 10 s rotation at 1280 px, and ≤ 33 ms at 390 px with
  4× CPU throttle.
  - Measured by `applications/web/accessibility/perf-check.mjs` as main-thread frame
    cost from a trace. In a container without a GPU, Chromium rasterises 2D canvas on
    the main thread; that share is reported separately and excluded from the budget,
    because a GPU does it off the main thread on real devices.
  - Real-device frame pacing on a mid-range phone remains an owner check before the
    phone budget is called met. See
    `documents/initiatives/receipts/living-garden/PERFORMANCE.md`.
- Garden route images ≤ 350 KB on phone before interaction. Off-arc beds load lazily.
- At most about 24 interactive plants rendered per bed. Older resting thoughts become
  background meadow density but remain reachable from the list view and search.

## Accessibility contract

- **Plants are buttons.** Each has an accessible name such as "Thought: title, 4
  entries, last written Sep 3". Beds are labelled groups.
- **Keyboard:**
  - ←/→ rotate.
  - Tab moves through plants.
  - Enter focuses or opens.
  - Escape steps back one depth level.
  - Focus returns to the originating plant.
- **Reduced motion:**
  - Camera travel becomes a crossfade.
  - The canvas draws one static frame.
  - No sway or drift.
  - The flower-to-specimen press becomes a crossfade with the same silhouette.
- **Text:** all text sits on opaque paper surfaces. Colours are tokens with light
  and dark values in `globals.css`.

## Verification and rollback

- **Acceptance:**
  - `npm run lint`, `npm test`, `npm run test:node`, and `npm run build` pass.
  - The extended axe harness passes in light and dark at 390 px and 1280 px.
  - Frame-time and image-weight receipts meet the budgets.
  - The owner reviews screenshots and recordings of rotate, focus, write-freeze, and
    press.
- **Rollback:** the scene is a view over unchanged data. Removing the default
  `view` mapping returns `/garden` to the list workspace without migration.

# Mobile-first audit and remediation

- Date: 2026-11-16
- Direction: D-024 ("the product must be mobile-first"). Scope: the web client
  `applications/web`. No framework, service worker, migration, vendor or hosted
  change is made by this work; the native/App Store approach still needs its own
  architecture decision record.
- Method: every screen was rendered from synthetic fixtures (`/dev/axe-fixtures`,
  no Supabase, no private writing) in Chromium with `isMobile` and `hasTouch`, at
  360×740, 390×844 and 430×932 portrait, 844×390 landscape and 820×1180 tablet, in
  light and dark. Each capture was also measured by script: horizontal overflow,
  interactive targets under 44×44 CSS px, inputs under 16px, text under 12px, and
  overlap between the fixed pieces (trail, tab bar, scene title, turn arrows, dock,
  reveal card, save bar). Desktop was compared at 1440×900 before and after by pixel
  difference.
- Not verified here: a physical iPhone or Android phone. Everything that depends on
  real browser chrome, a real notch or a real keyboard is marked **device check**.

## Verdict before this pass

The app was desktop-first and shrunk. On a phone the primary navigation was a
104px-tall double header at the top of the screen, out of thumb reach; writing was
two to three taps away and sat below a 330px plate; the save button scrolled away
behind the keyboard; `viewport-fit`, safe-area insets and dynamic viewport units
were absent; plants in the Meadow were targets as small as 19×13px; and every
stylesheet was written desktop-down with `max-width` overrides.

## Navigation decision

**Phone: a bottom tab bar, Meadow · Pages · Write · Returns · More, with the depth
trail as one compact bar pinned to the top.** Wide screens keep the top bar.

- The same `<header class="garden-top">` and the same handlers render both; only
  CSS differs. No route, data or state changed.
- **Write** is the one raised control, in the person's ink green (gold stays
  reserved for what the garden returned). One tap from anywhere opens the writing
  page of the thought already open, else the thought most recently written in the
  current topic, else in the garden, and puts the caret on the page. With no
  thought yet it opens Pages where "New thought" is.
- **Returns** carries the gold dot for unseen blooms and lights gold when current.
- **More** opens upward as a sheet: All gardens, Settings & export, Import notes,
  Archive, Sign out. All gardens is also the first glyph of the trail.
- Held sideways (short landscape) the bar becomes a rail on the left edge so the
  Meadow keeps the whole height.
- While the writing page holds the caret the bar steps aside; it returns on blur.
- First run has nowhere to go yet, so it keeps a slim top row (wordmark, More).

Rejected: a hamburger (hides the product's point, Returns), a floating action
button over the Meadow (collides with the dock and plants), and keeping a shrunken
top bar (out of reach on a 6.7-inch phone).

## Findings

Severity: **B** blocker for calling the product mobile-first, **H** high, **M**
medium, **L** low. Status: **Fixed** (verified in the captures), **Partly**,
**Open**, **Request** (needs a file outside this workstream).

| # | Screen | Problem | Sev | Fix | Status |
|---|---|---|---|---|---|
| 1 | All garden screens | Primary navigation at the top: wordmark row (52px) plus trail (52px); Meadow/Pages/Returns/More need a stretch on any phone over 6 inches | B | Bottom tab bar, trail alone at the top (`globals.css`, `level-nav.tsx`) | Fixed |
| 2 | All garden screens | Writing is 2–3 taps away (topic, thought, scroll) | B | Write tab: one tap from Meadow, Pages, Returns, ring, timeline; caret placed on the page | Fixed |
| 3 | Editor | Save button scrolls out of view; on a phone it ends up under the keyboard | B | Save bar is `position: sticky` above the tab bar, or above the keyboard while writing. Chromium: `interactive-widget=resizes-content`. Safari: `--keyboard-inset` from `visualViewport` (22 lines, no dependency) | Fixed in emulation; **device check** on iOS Safari |
| 4 | Thought page | A 330px plate (plant, facts, archive, delete) sits above the blank page; the writing area starts below the fold | B | On a phone the plate dissolves: a 64px caption (plant, title) above the page; facts, archive and delete move below the entries. The page is edge to edge and at least `100dvh − 400px` tall | Fixed |
| 5 | Editor | Type 18.4px; resize grip on an auto-growing textarea; full-box focus ring; shortcut hint and "Quiet page" competing with Save | H | 20.8px/1.7 type; grip removed; the page's top rule thickens on focus; shortcut hint only with a fine pointer; Quiet page hidden on phone (the page already is) | Fixed |
| 6 | Editor | No native writing attributes | M | `autocapitalize="sentences"`, `spellcheck`, `autocorrect="on"`, `autocomplete="off"`, `enterkeyhint="enter"`. No suggestion, completion or critique of any kind is added (product invariant) | Fixed |
| 7 | Whole app | No `viewport-fit=cover`; no `env(safe-area-inset-*)` anywhere; content would sit under a notch or the home indicator once installed | B | Viewport meta set; trail pads top/left/right, tab bar pads bottom/left/right, rail pads left; landing, sign-in, import and level pages pad their gutters; scene title, arrows and dock respect side insets | Fixed in CSS; **device check** |
| 8 | Whole app | `100vh` shells: browser chrome hides the bottom of the page | H | Shell, landing and auth use `100dvh` (with `100vh` fallback); the Meadow keeps `100svh` so the canvas does not resize as chrome collapses; More sheet is capped in `dvh` | Fixed |
| 9 | Meadow | Plants are targets down to 19×13px (far beds), 12–16 per screen under 44px | B | Under a coarse pointer every plant button has a centred 44px pseudo-element target; drawing and layout untouched | Fixed |
| 10 | Meadow | Turn arrows 42px; "+N more in Pages" slips 32px; dock chips 40px; tending tag actions 32px | H | 44px under a coarse pointer | Fixed |
| 11 | Meadow, landscape | Scene minimum height 480px on a 390px-high screen: dock and arrows below the fold; dock wraps to three rows and is clipped; reveal's actions scroll inside the card | H | Short-landscape rules: scene fits the screen, dock is one sideways-scrolling row, reveal is compact with its actions pinned | Fixed |
| 12 | Meadow | Could the dock, arrows, reveal and title overlap? | H | Measured at five viewports, garden, topic and reveal states: 0 overlaps after the landscape fix (before: arrows over dock by 10px in landscape) | Fixed |
| 13 | Meadow | Swiping the dock chips could turn the garden or pull the page | M | `overscroll-behavior-x: contain; touch-action: pan-x` on the chip row; `overscroll-behavior: contain` on the plant-focus sheet | Fixed |
| 14 | Plant focus | Sheet is 82% of the screen, the plate fills it, and "Write in this thought" is below the scroll | H | Smaller plate on phone; actions pinned to the foot of the sheet in one row | Fixed |
| 15 | Pages search | Input 13.6px: iOS zooms the page on focus; 19px-high "Include archived" target | H | 16px, 44px high; label is a 44px target | Fixed |
| 16 | Trail | Earlier-level glyph buttons shrink to 43px; level label 10.6px | M | Buttons no longer shrink; label 12px | Fixed |
| 17 | Trail "Continue writing" | 39×44 target | L | 44px minimum | Fixed |
| 18 | More menu | A 14rem dropdown hanging from the top-right corner | H | Bottom sheet above the bar, 48px rows, scrolls inside itself, Escape and outside tap close it and return focus | Fixed |
| 19 | All text controls | `.plain-button` and text links are bare text (21–23px high): "Back to garden" on import, "Back to this garden" on the ring, entry actions | H | 44px minimum under a coarse pointer, at every width (tablets too) | Fixed |
| 20 | Tablet (touch, top bar) | Meadow/Pages toggle 36px; topic-settings summary 22px; overnight-tending label 26px | M | 44px under a coarse pointer | Fixed |
| 21 | Small text | 10.6–11.8px kickers, eyebrows, counts (landing, trail, scene, Returns, beds) | M | 12px floor in the files of this workstream | Fixed; first-run and seed-pack labels are **Request** |
| 22 | Whole app | Double-tap-to-zoom delay on controls; iOS landscape text inflation | L | `touch-action: manipulation` on controls; `text-size-adjust: 100%`. Pinch zoom is never disabled | Fixed |
| 23 | Morning reveal | Thought chips 34px high between 561 and 900px wide | L | 44px under a coarse pointer | Fixed |
| 24 | Thought page | "Archive thought" and "Delete thought…" touch each other | M | Wrapping row with a 24px gap, below the entries on phone | Fixed |
| 25 | Hover | Any affordance that only appears on hover? | M | Reviewed every `:hover` rule: all are colour or lift on something already visible; the plant lift is inside `@media (hover: hover)`. None found | No change needed |
| 26 | Focus | Tab order with the bar at the bottom | M | DOM order is unchanged (skip link, navigation, trail, content), so keyboard and screen-reader order is the same as on desktop; the bar is only placed last visually | Accepted; note for a screen-reader pass |
| 27 | Plant focus | `role="dialog"` with `aria-modal="false"`: focus is not trapped, by design (the scene stays operable) | L | Unchanged. On a phone the sheet covers most of the scene, so a true modal may be right there | Open (design question) |
| 28 | Installability | No manifest, no touch icon, no standalone display | H | `public/manifest.webmanifest` (standalone, token colours), 192/512/maskable PNG and maskable SVG generated from `icon.svg`, `apple-touch-icon`, light and dark `theme-color` | Fixed. **No service worker: nothing is cached or works offline; that is a separate decision** |
| 29 | CSS structure | Desktop-first: base rules for desktop, `max-width` overrides for phone | H | Rewritten phone-first with `min-width`: garden shell and navigation, trail, Continue writing, editor, chronology, sign-in, Returns cabinet, cabinet board, and the live part of `globals.css`. Two dead desktop-first blocks for the retired landing page were removed | Partly: see "Remaining" |
| 30 | Ring | A far card's "New garden" button measures 25px wide | L | It is the 3D-scaled copy of a 44px button on a card that is not the selected one; the selected card and the dock are full size | Accepted |
| 31 | Entry cards | Empty band between the entry actions and "Delete entry…" on phone | L | Belongs to the deletion controls | Request |
| 32 | Android | Hiding the keyboard with the system back gesture does not blur the textarea, so the tab bar stays aside until the page is tapped | M | Not solvable without a device to observe; the trail (with back) stays visible throughout | Open, **device check** |

## Measurements

- Scripted audit at 390×844 light: before, 18 of 27 measured states had targets
  under 44px (up to 16 on one screen) and 6 had a sub-16px input; after, across 29
  states, 0 small targets other than item 30, 0 small inputs, 0 horizontal
  overflow, 0 overlaps.
- Full matrix after the fixes: 29 states × five touch viewports × light and dark
  = 290 captures. 0 with horizontal overflow, 0 inputs under 16px, 0 overlaps
  between fixed pieces, and no target under 44px except item 30. Four landscape
  captures (More menu and settings, both schemes) could not be taken because the
  Next.js development badge sits over the rail's last item in the dev server; the
  badge does not exist in a production build, and the same menu was exercised in
  portrait and by the growth journeys.
- Growth journeys (`GROWTH_BASE=http://localhost:3147`, 390 and 1280, light and
  dark): pass.
- Journey (390×844, touch): Write tapped from Meadow, Returns, All gardens and
  Timeline lands on a thought with the caret in the page in each case; the tab bar
  steps aside; tapping Save does not move the bar under the finger; More opens as a
  sheet and Escape returns focus to it.
- Desktop 1440×900: Returns is pixel-identical before and after. Other pages differ
  only by the 12px text floor in the trail, the 16px search input, the removed
  textarea grip and other workstreams' changes made during the same session.
- Meadow frame pacing, drag rotation, 390×844, touch, CPU 4×, 100 thoughts, dev
  server, three alternating runs each with and without the touch-target and tab-bar
  CSS: p50 16.7ms and p95 66.7ms in both; no measurable difference. Only CSS in
  `scene.css` changed; no scene script was edited. **The ADR-007 receipt
  (`npm run perf`, production build) was not rerun** because a build in the shared
  working tree would have disturbed the running fixture server; it should be rerun
  at integration.
- Accessibility script (`AXE_BASE=http://localhost:3147`, all states, light and
  dark, 390 and 1280, receipts written to a scratch folder so the committed
  receipts are untouched): 112 state runs with 0 violations of any impact, no
  overflow, 200% zoom proxy passes, 182 contrast rows all AA (lowest 4.9:1).
- Unit tests: 32 files, 178 tests pass (all workstreams), including five new ones for where Write
  goes. `tsc --noEmit` and ESLint clean for the touched files.

## Remaining

1. **Device checks** before the phone experience is called accepted: iOS Safari
   keyboard and the pinned save bar; safe areas on a notched phone, installed and in
   the browser; Android back-gesture keyboard dismissal (item 32); Meadow drag
   pacing on a mid-range phone (already an open ADR-007 owner check).
2. **CSS still written desktop-down** (phone behaviour is correct and verified;
   only the source order is not yet inverted): `level-pages.css`, `scene.css`,
   `morning-return.css`, `landing.css`. Inverting them mechanically needs each
   property's desktop value restated; that was done only where it could be checked
   against a desktop capture.
3. `globals.css` still carries the retired first landing page's rules (`.hero`,
   `.auth-shell`, `.garden-layout`, `.garden-preview` and friends). Nothing renders
   them; they should be deleted in a cleanup of their own.
4. Write is not in the desktop top bar, to leave desktop unchanged. It would be a
   reasonable addition there too (product decision).
5. Offline, background sync and push are out of scope and undecided. The manifest
   makes the site installable; it does not make it work without a connection.
6. The native route (D-024, App Store) needs its ADR. Everything here is plain CSS
   and one small hook, so it carries into a web view unchanged.

## Requests for files outside this workstream

- `chronology.tsx`: `enterKeyHint="search"` and `autoCapitalize="none"` on the
  search input.
- `new-area.tsx`: `enterKeyHint="done"` and `autoCapitalize="sentences"` on the
  name input.
- `first-run.css` / `seed-pack.css`: labels at 10.6–11.5px (`.first-run-optional`,
  `.seed-packet-count`, field labels) should meet the 12px floor.
- `delete-control.css`: remove the empty band above "Delete entry…" on phone and
  keep the control's row at 44px.
- `workspace.tsx`: the class `specimen-plate` is shared with the plant-focus plate
  in `scene.css`; renaming the Pages one (for example `thought-plate`) would end
  the collision. The phone rules are scoped to avoid it meanwhile.
- `accessibility/axe-check.mjs`: add a 360×740 and an 844×390 touch viewport, a
  "write" state (caret in the page), and the 44px target check used for this audit.

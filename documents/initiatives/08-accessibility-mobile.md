# Feature brief: Accessibility, reduced motion, dark mode, 390px hardening

- Horizon and phase: H1 web dogfood · September 2026 initiative wave, initiative 8 (P1)
- Status: Implemented; acceptance evidence recorded below, focus-order gap open
- Owner: Kyle (delivered by an initiative agent)

## User problem

People write in the garden on a phone at night, on a laptop in daylight, with
system dark mode, large text, or reduced motion turned on. Today the web app
ships one light palette with hard-coded colours, a translucent focus ring, a
parallax background attachment, and no automated accessibility check. Nobody
has verified the 390px layout since the first inspection, and dark-mode and
reduced-motion equivalents do not exist. Any of these can make the writing
surface unusable or noisy, which is a dogfood blocker.

## Why delay or accumulation matters

A contemplative environment must not draw attention to itself. The quiet
promise ("nothing interrupts") includes not flashing a white page at someone
in dark mode, not animating when they asked the OS not to, and not forcing a
horizontal scroll on a phone. These are prerequisites for a voluntary return,
not features.

## Proposed capability

- One tokenised palette in `globals.css` with `prefers-color-scheme: dark`
  values for every colour, `color-scheme: light dark` on `html`, and matching
  `themeColor` metadata.
- `prefers-reduced-motion: reduce` disables smooth scrolling, animations,
  transitions and the fixed-background parallax.
- A solid, visible focus indicator; skip links on landing and sign-in;
  `role="alert"` on the error page and `role="status"` on the loading page.
- An automated axe harness (`applications/web/accessibility/`) that boots the
  app without Supabase, renders synthetic garden fixtures through a gated
  route (`/dev/axe-fixtures`, `GARDEN_AXE_FIXTURES=1`, `notFound()`
  otherwise), and checks landing, login, error, loading and garden
  overview/topic/thought/archive states in light and dark at 390×844 and
  1280×800, plus horizontal overflow, a 200% zoom proxy, and WCAG contrast
  of key text.
- Same visual direction; no move toward the botanical scrapbook phase.

## Trust and agency

The harness reads only synthetic fixture data compiled into the route file. It
never connects to Supabase, never reads a real note, and the fixture route
returns 404 unless the environment variable is set at runtime. No AI is
involved; `GARDEN_AI_ENABLED` stays `false`.

## States and failure modes

- Light and dark: all tokens have both values; unknown system preference falls
  back to light.
- Reduced motion: honoured globally; static card rotations remain (not motion).
- Loading and error pages announce themselves to assistive technology.
- 390px: landing preview cards stack instead of overlapping; no state produces
  horizontal overflow.
- The fixture route in a production build without the flag renders the
  standard 404.

## Acceptance evidence

| Check | Result |
|---|---|
| axe (`wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`) on 8 states × 2 schemes × 2 viewports | 0 serious/critical, 0 moderate/minor in owned surfaces; one serious finding outside this initiative's files (below) |
| Horizontal overflow at 390px, all states/schemes | none |
| 200% zoom proxy (640×400 CSS px) landing/login/garden-thought | no overflow; h1 and primary action visible |
| Contrast, light | lowest 4.89:1 (`.rail-link small` on active rail) — all AA |
| Contrast, dark | lowest 6.10:1 (`.rail-link small`) — all AA |
| Screenshots | `receipts/08/{landing,login,error,garden-overview,garden-thought}-{light,dark}-{390,1280}.*`, `landing-zoom200.jpg`, `garden-thought-zoom200.png` |
| lint / tsc / build / worker tests | pass |

### Contrast values

| State | Scheme | Selector | Foreground | Background | Ratio |
|---|---|---|---|---|---|
| landing | light | `.eyebrow` | rgb(47,102,83) | rgb(251,248,239) | 6.29 |
| landing | light | `.hero h1` | rgb(23,60,50) | rgb(251,248,239) | 11.44 |
| landing | light | `.hero-lede` | rgb(73,102,93) | rgb(251,248,239) | 5.92 |
| landing | light | `.primary-button` | rgb(255,254,247) | rgb(34,77,64) | 9.43 |
| landing | light | `.text-link`, `.quiet-link` | rgb(34,77,64) | rgb(251,248,239) | 8.97 |
| landing | light | `.principles p` | rgb(73,102,93) | rgb(255,253,247) | 6.18 |
| landing | light | `.seed-card` | rgb(44,81,70) | rgb(255,253,244) | 8.66 |
| landing | light | `.bloom-card` | rgb(44,81,70) | rgb(224,239,230) | 7.46 |
| login | light | `.auth-copy p` | rgb(73,102,93) | rgb(251,248,239) | 5.92 |
| login | light | `.field label` | rgb(23,60,50) | rgb(255,252,245) | 11.87 |
| login | light | `.status-message`, `.form-note` | rgb(73,102,93) | rgb(255,252,245) | 6.14 |
| garden | light | `.rail-link` | rgb(36,72,59) | rgb(240,242,232) | 8.99 |
| garden | light | `.rail-link small` | rgb(82,103,82) | rgb(224,232,217) | 4.89 |
| garden | light | `.garden-breadcrumb button` | rgb(82,103,82) | rgb(250,249,241) | 5.81 |
| garden | light | `.journal-entry time` | rgb(82,103,82) | rgb(255,253,247) | 6.04 |
| garden | light | `.entry-body` | rgb(36,72,59) | rgb(255,253,247) | 10.0 |
| garden | light | `.writing-form textarea` | rgb(36,72,59) | rgb(250,249,241) | 9.63 |
| garden | light | `.garden-foot` | rgb(82,103,82) | rgb(247,247,238) | 5.70 |
| garden | light | `.plant-label` | rgb(36,72,59) | rgb(255,253,247) | 10.0 |
| garden | light | `.seed-plant small` | rgb(82,103,82) | rgb(255,253,247) | 6.04 |
| landing | dark | `.eyebrow` | rgb(127,191,159) | rgb(18,26,22) | 8.32 |
| landing | dark | `.hero h1` | rgb(230,239,230) | rgb(18,26,22) | 15.07 |
| landing | dark | `.hero-lede` | rgb(169,191,178) | rgb(18,26,22) | 9.10 |
| landing | dark | `.primary-button` | rgb(15,22,18) | rgb(159,212,184) | 11.0 |
| landing | dark | `.text-link`, `.quiet-link` | rgb(159,212,184) | rgb(18,26,22) | 10.62 |
| landing | dark | `.principles p` | rgb(169,191,178) | rgb(28,38,33) | 8.00 |
| landing | dark | `.seed-card` | rgb(223,233,226) | rgb(27,37,32) | 12.71 |
| landing | dark | `.bloom-card` | rgb(223,233,226) | rgb(37,52,40) | 10.59 |
| login | dark | `.auth-copy p` | rgb(169,191,178) | rgb(18,26,22) | 9.10 |
| login | dark | `.field label` | rgb(230,239,230) | rgb(27,37,32) | 13.43 |
| login | dark | `.status-message`, `.form-note` | rgb(169,191,178) | rgb(27,37,32) | 8.11 |
| garden | dark | `.rail-link` | rgb(223,233,226) | rgb(23,32,25) | 13.44 |
| garden | dark | `.rail-link small` | rgb(163,183,169) | rgb(38,53,41) | 6.10 |
| garden | dark | `.garden-breadcrumb button` | rgb(163,183,169) | rgb(20,28,23) | 8.20 |
| garden | dark | `.journal-entry time` | rgb(163,183,169) | rgb(28,38,33) | 7.34 |
| garden | dark | `.entry-body` | rgb(223,233,226) | rgb(28,38,33) | 12.53 |
| garden | dark | `.writing-form textarea` | rgb(223,233,226) | rgb(20,28,23) | 13.98 |
| garden | dark | `.garden-foot` | rgb(163,183,169) | rgb(18,26,22) | 8.36 |
| garden | dark | `.plant-label` | rgb(223,233,226) | rgb(28,38,33) | 12.53 |
| garden | dark | `.seed-plant small` | rgb(163,183,169) | rgb(28,38,33) | 7.34 |

Machine-readable source: `receipts/08/contrast.json`.

## Dependencies and non-goals

- Depends on ADR-006 (web-first) and the wave plan (D-021).
- Non-goals: the botanical scrapbook restyle, a manual theme toggle, changes
  to `workspace.tsx`, `returns.tsx`, `login-form.tsx`, `next.config.ts`, or
  any hosted configuration.

## Implementation receipt

Built:

- `applications/web/src/app/globals.css`: every hard-coded colour replaced by
  a custom property; light values in `:root`, dark values under
  `@media (prefers-color-scheme: dark)`; `color-scheme: light dark`;
  `:focus-visible` is now `3px solid var(--moss)`; reduced-motion block
  neutralises animations/transitions and the fixed background; `.garden-top`
  buttons get a 44px minimum height on mobile; `.plot-rail select` and
  `.search-field input` get `min-width: 0`; landing preview cards stack at
  ≤560px (they overlapped at 390px).
- `layout.tsx`: `viewport` export with `colorScheme` and light/dark
  `themeColor` (verified against the bundled Next 16 `generate-viewport`
  docs).
- `page.tsx`, `login/page.tsx`: skip link to `#main-content`.
- `error.tsx`: `role="alert"`. `loading.tsx`: `role="status" aria-live="polite"`.
- `src/app/dev/axe-fixtures/{page,error-fixture,fixture}.ts(x)`: gated
  synthetic fixture route (`force-dynamic`, `robots: noindex`).
- `applications/web/accessibility/`: self-contained package
  (`@playwright/test`, `@axe-core/playwright`) with `axe-check.mjs` and a
  README; kept separate from `applications/web/package.json` to avoid lockfile
  collisions with the test-foundation initiative.

Verified (local, Node 22):

- `npm --prefix applications/web ci`, `run lint`, `npx tsc --noEmit`,
  `run build` (fixture route builds as a dynamic route), and
  `node --test services/garden-worker/runtime.test.mjs` all pass.
- `npm run axe` in `applications/web/accessibility` exits 0 with the results
  in the table above. The run was repeated after fixing a harness defect that
  had left the "390" contexts at the default viewport; the recorded receipts
  come from the corrected run.

Not verified:

- Real browser zoom at 200% (a 640×400 CSS-px viewport is used as a proxy).
- Screen-reader behaviour with a real AT (NVDA/VoiceOver); only axe and
  semantic review.
- Focus order after in-garden navigation: `workspace.tsx` navigates with
  `router.push` from buttons that unmount, so focus falls back to `body`.
  Observed, not fixed (file not owned by this initiative).
- Windows High Contrast / `forced-colors` mode.
- The axe harness is not yet wired into CI (needs a Chromium install step in
  the `web` job; left for the CI owner to avoid colliding with the test
  foundation and security-hardening jobs).

## Follow-ups

- **workspace.tsx (initiative 2/7 owners):** `aria-prohibited-attr` (serious)
  on `<div class="plant-grid" aria-label="Thoughts">` in the archive view —
  change the `div` to a `ul`/`role="list"` with list items, or drop the
  `aria-label`. The harness currently allowlists exactly this finding and
  prints it as a warning; remove it from `KNOWN_ISSUES` once fixed.
- **workspace.tsx:** move focus to the `#garden-content` heading (or the
  breadcrumb) after `navigate()` so keyboard and screen-reader users land in
  the new view.
- **CI:** add `npx playwright install --with-deps chromium` and
  `npm --prefix applications/web/accessibility ci && npm run axe` to the web
  job once initiative 1 and 9 CI edits have merged.
- **Proposed decision:** whether a manual light/dark toggle is wanted in
  Settings, or whether following the system preference is the product
  stance. This initiative follows the system only.
- **Design:** the dark palette is a low-saturation derivation of the light
  tokens; the botanical scrapbook phase should revisit it with real artwork.
- No migrations or hosted changes proposed.

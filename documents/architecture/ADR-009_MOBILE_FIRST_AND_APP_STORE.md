# ADR-009: Mobile-first delivery and the path to the App Store

- Status: Proposed for owner decision
- Date: 2026-11-16
- Owners: Kyle (decision); drafted as an architecture review for D-024
- Roadmap phase: 1.2 / 2.1 (client platform), following ADR-006 and ADR-007

Evidence labels used below: **[repo]** read from this repository on 2026-11-16;
**[verified]** read from a primary source on 2026-11-16 (URL in "Sources");
**[secondary]** from search results or third-party pages on 2026-11-16, not confirmed
on the vendor's own page; **[assumption]** unverified judgement. Nothing was installed,
no hosted resource was touched, and no file other than this one was changed.

## Context

D-024 (2026-11-16) directs: the product must be mobile-first, with a fast track to the
App Store, even if that needs a refactor toward a codebase better aligned between phone
and desktop, and it should work in desktop browsers as far as possible. AGENTS.md
forbids installing a framework until this record is complete.

The decision needed: which client architecture gets Slow Garden onto iPhones through
the App Store soonest, without splitting a solo founder across two codebases, and
without weakening the privacy posture.

### Constraints that matter

**1. The web app is server-coupled, but only thinly. [repo]**

- Stack: Next 16.4.3 App Router, React 19.2.8, `motion` 14, `@supabase/ssr` 0.12.5,
  `@supabase/supabase-js` 2.113.0, plain CSS (`applications/web/package.json`).
- Session: cookie-based. `src/proxy.ts` and `src/lib/supabase/proxy.ts` refresh the
  session on every request; `src/lib/supabase/server.ts` reads it through `cookies()`.
- Server-only code paths, complete list:
  - Server actions: `src/app/garden/actions.ts` (346 lines, 12 functions: `createArea`,
    `saveEntry`, `setArchived`, `setPlotPermissions`, `signOut`, `inviteReflection`,
    `cancelReflection`, `respondToBloom`, `readReturns`, `respondToMark`,
    `setTendingPreferences`), `src/app/garden/import/actions.ts` (82 lines),
    `src/app/garden/returns-lookup.ts` (38 lines).
  - Server data loading: `src/lib/garden/data.ts` (`loadGarden`, 100 lines), called
    from `src/app/garden/page.tsx`.
  - Route handlers: `src/app/garden/export/route.ts`, `src/app/garden/history/route.ts`,
    `src/app/api/health/route.ts`.
  - Server-side auth redirects in `src/app/page.tsx`, `src/app/login/page.tsx`,
    `src/app/garden/page.tsx`, `src/app/garden/import/page.tsx`.
  - Response headers (CSP, HSTS, etc.) from `next.config.ts` `headers()`.
  - One server-only environment flag, `GARDEN_AI_ENABLED`, read in `actions.ts`,
    `data.ts` and `page.tsx`.
- That is roughly 800 lines of server-coupled code in a tree of about 25,000 non-test
  lines. Twenty-nine files are already `"use client"`, including the whole workspace,
  editor, scene and returns cabinet. Sign-in (`src/app/login/login-form.tsx`) already
  uses the browser Supabase client with an email one-time code.
- Crucially, **every server path uses the publishable key plus the person's own
  session; none uses the service-role key.** Authorization is already enforced by RLS
  and RPCs (`save_entry`, `export_garden_sources`), as the threat model requires (T-01,
  T-02). The server actions add input validation
  (`src/lib/garden/validation.ts`), idempotent replay checks, `revalidatePath`, and
  the `GARDEN_AI_ENABLED` gate. They are not the security boundary.
- There are no dynamic route segments. Selection is carried in search parameters, which
  suits a static build.

**2. The meadow and its budget. [repo]**

- ADR-007: layered 2.5D scene; DOM/SVG procedural plants, 2D canvas atmosphere, CSS
  keyframe sway, `motion` springs and `layoutId` transitions. About 4,250 lines of TSX
  in `src/app/garden/scene/`, 1,550 lines in `scene.css`, and about 1,600 lines of pure
  TypeScript in `src/lib/garden/scene/` (genome, species, layout, growth, camera,
  plant geometry, palette).
- Budget: p95 frame time ≤ 33 ms at 390 px with 4× CPU throttle. Measured only in
  headless Chromium without a GPU: 26–31 ms p95, and the receipt says the worst run
  "leaves little margin". **The real-device iPhone check has never been done**
  (`documents/initiatives/receipts/living-garden/PERFORMANCE.md`). Chromium numbers do
  not predict WebKit.

**3. Privacy posture. [repo]**

- Journal text is the highest-sensitivity data. No content in logs, analytics or
  notifications (T-03, T-17). Offline plaintext on a device needs protection and
  sign-out erasure (T-09). Tending sends selected writing to a third-party model
  provider (OpenAI Batch, ADR-008), off by default per topic.
- D-024 names privacy as the largest open concern and orders in-app deletion next.

**4. Capacity and sequence.**

- Solo founder with coding agents. Two UI codebases is the main thing to avoid.
- Model activation and external-pilot gates stay closed; this record opens neither.
- Android is wanted later, not now.
- The SwiftUI prototype (`applications/ios`, about 2,600 lines of Swift) is
  fixture-backed, on the v1 contract, with no auth, no network, no hosted schema, and
  none of the living meadow, returns cabinet, tending tiers, import or export.

**5. What Apple requires. [verified] unless marked**

- **4.2 Minimum Functionality:** "Your app should include features, content, and UI
  that elevate it beyond a repackaged website. If your app is not particularly useful,
  unique, or 'app-like,' it doesn't belong on the App Store."
- **5.1.1(v):** "If your app supports account creation, you must also offer account
  deletion within the app." Apple's support page adds: deactivation alone is
  insufficient; a web page is acceptable only as a direct link to finish deletion;
  email or support-flow deletion is not acceptable; a deletion that takes time is
  acceptable if the person is told how long and receives confirmation.
- **5.1.1(i):** privacy policy link in App Store Connect and inside the app.
- **5.1.2(i)** (changed 2025-11-13): "You must clearly disclose where personal data
  will be shared with third parties, including with third-party AI, and obtain explicit
  permission before doing so." The same paragraph forbids requiring push notifications
  to use the app.
- **4.8 Login Services:** a second login service (in practice Sign in with Apple) is
  required only if the app uses a third-party or social login. "Another login service
  is not required if: Your app exclusively uses your company's own account setup and
  sign-in systems." Email one-time code qualifies. Adding Google sign-in would trigger
  the requirement.
- **2.1(a):** "include demo account info (and turn on your back-end service!) if your
  app includes a login."
- **3.1.1:** unlocking features or subscriptions inside the app requires in-app
  purchase. **3.1.1(a):** entitlements "are not required for developers to include
  buttons, external links, or other calls to action in their United States storefront
  apps"; in other storefronts such links are prohibited without an entitlement.
  **3.1.3(b):** a multiplatform service may let people use a subscription bought on the
  web "provided those items are also available as in-app purchases within the app."
- **4.7** covers HTML5 mini apps "not embedded in the binary" hosted by an app. It is
  about apps that host other software and is not a licence for a remote-website shell.
- **Privacy nutrition label:** all data that leaves the device and is stored must be
  declared, including third-party partners' practices. Free-form text is "Other User
  Content". Data processed only on device is not "collected".
- **Review time:** Apple states it typically reviews "at least 50% of submissions in
  less than 24 hours and 90% in less than 48 hours", and that over 40% of unresolved
  issues are 2.1 App Completeness.
- **Fees:** Small Business Program commission is 15% for developers up to 1 million
  USD in proceeds. Developer Program membership is 99 USD per year **[secondary]**.
- **US link-out commission:** in litigation. The Ninth Circuit (December 2025) allowed
  Apple some commission on linked-out purchases; the rate had not been set as of the
  latest reports found **[secondary]**. Treat any figure as unsettled.
- **Age rating:** the questionnaire was revised in 2025 (adds 13+, 16+, 18+)
  **[secondary, citing Apple's news post]**.

**6. Framework facts. [verified] from the npm registry and shipped documentation**

- Capacitor: `@capacitor/core` 8.6.2 (published 2026-11-13). Capacitor 8 requires
  Xcode 26+ and iOS 15+ **[secondary]**. The configuration reference shipped inside
  `@capacitor/cli` 8.6.2 says of `server.url`: "Load an external URL in the Web View.
  This is intended for use with live-reload servers. **This is not intended for use in
  production.**" The same warning is on `server.allowNavigation`.
- Next 16 static export (`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`
  in this repo): unsupported features include Server Actions, Cookies, Proxy, Headers,
  Rewrites, and Route Handlers that rely on Request. Client components and
  `useSearchParams` work.
- Expo SDK 58.0.25 with React Native 0.88.1; `react-native-web` 0.21.4;
  `react-native-svg` 15.16.1; `expo-router` 58.0.31. Expo DOM components (`'use dom'`)
  render a web React component inside a web view on native. Expo's own guide says:
  "We recommend building truly native apps using universal primitives such as View,
  Image, and Text. DOM components only support standard JavaScript, which is slower to
  parse and start up than optimized Hermes bytecode"; props cross "an asynchronous
  bridge"; layout routes can never be DOM components.
- Tauri: `@tauri-apps/cli` 2.12.4. Mobile push relies on young community plugins
  **[secondary]**.
- iOS web apps: Web Push works only for sites added to the Home Screen, iOS 16.4+
  (Next's bundled PWA guide **[verified]**; WebKit's post **[secondary]**, webkit.org
  was unreachable). Safari's seven-day cap on script-writable storage applies to
  Safari; Home Screen web apps are reported exempt **[secondary]**.

## Options considered

Time ranges assume: one founder working with agents near full time; a Mac with current
Xcode; Apple Developer enrollment finished in the first week; no new product scope;
hosted migrations still pass their own gates. "TestFlight" means an internal build on
the owner's phone. "Approval" means first App Store approval, counted from the start,
including one rejection round. These are estimates **[assumption]**.

| Option | User impact | Engineering impact | Privacy/security | Cost | Reversibility |
|---|---|---|---|---|---|
| A1. Capacitor shell, remote URL to slowgarden.app | Same as mobile Safari without browser chrome; nothing offline | Days; no refactor | Unchanged cookie model; app content changes without review | Lowest | Total (config only) |
| A2. Capacitor shell, static bundle of the same React app | App opens offline, native push, one UI everywhere | 3–5 weeks of refactor to a client data layer | Tokens move from cookies to device storage; RLS unchanged; server validation must move to the database | Low | High (the refactor also serves web and PWA) |
| B. Expo / React Native | Most native feel if fully rebuilt | Rewrite of UI and scene; 3–5 months | Similar to A2 | High | Low once UI forks |
| C. Resume SwiftUI | Best platform quality in principle | Rebuild everything since September in Swift; two codebases | Strongest device controls | Highest | Low |
| D. PWA only | Installable from Safari; no store presence | 1–2 weeks | Unchanged | Lowest | Total |
| E1. Tauri mobile | Same as A2 | Same refactor plus Rust toolchain, thinner plugin base | Same as A2 | Low–medium | High |
| E2. Hand-written WKWebView shell in the existing Xcode project | Same as A1/A2 | Small Swift shell, own bridge for push | Same | Low | High; no Android |

### A. Capacitor shell around the existing web app

#### A1. Remote URL (`server.url` → the hosted Next app)

- **What gets built:** an Xcode project whose web view loads `https://slowgarden.app`.
- **Reused:** everything, unchanged. Server actions and cookie auth keep working,
  because the web view is a first-party browser for that origin and the Next server
  still runs on Vercel. Native plugins can still be called from the remote page.
- **What breaks or is weak:**
  - Capacitor documents `server.url` as not intended for production **[verified]**.
  - Nothing renders without a network; a cold start offline is an error page.
  - It is exactly what 4.2 describes as a "repackaged website". Community reports
    conflict on whether such apps pass **[secondary]**.
  - Every Vercel deploy changes the reviewed app.
  - External links, the marketing landing page and the sign-in screen all need
    app-specific handling anyway.
- **Time:** TestFlight 2–5 days. Approval 4–8 weeks and uncertain, because deletion,
  policy, demo account and AI consent are needed regardless, and a 4.2 rejection would
  force A2 anyway.
- **App Review risk:** high. **Meadow performance risk:** same as A2 plus network
  latency on every navigation. **Offline:** none. **Push:** APNs through the Capacitor
  push plugin works. **Payments:** as A2. **Maintenance:** lowest. **Reversibility:**
  total.
- **Verdict:** useful for one thing only: a private TestFlight build in the first days
  to measure the meadow in WKWebView on a real iPhone. Not a submission candidate.

#### A2. Static bundle (the React app compiled into the binary)

- **What gets built:** the same Next codebase gains a second build target
  (`output: 'export'`) whose `out/` directory is the Capacitor `webDir`. The app is
  served from the device at `capacitor://localhost` and talks to Supabase directly.
- **What breaks, precisely:** in a static export there is no Next server, so
  **[verified]** Server Actions, `cookies()`, `proxy.ts`, `headers()` and
  request-dependent route handlers do not exist. Concretely:
  - all 12 functions in `actions.ts`, `import/actions.ts` and `returns-lookup.ts` stop
    working;
  - `loadGarden` cannot run in `page.tsx`; the page cannot gate on a session;
  - `/garden/export` and `/garden/history` are gone;
  - `revalidatePath` and the eight `router.refresh()` call sites have nothing to
    refresh;
  - the cookie session set by `@supabase/ssr` is not readable by any server, and the
    CSP and security headers from `next.config.ts` are not sent;
  - `GARDEN_AI_ENABLED` cannot be read.
- **Refactor needed:** move these paths to a client data layer that calls Supabase with
  the person's token (details under "Decision"). This is feasible because none of them
  uses a privileged key. An alternative is to keep a server API (Next route handlers or
  Edge Functions with bearer tokens and CORS for the app origin); that keeps server
  validation but adds a second API surface to secure and version. Recommended only for
  the few privileged operations: account deletion, push-token registration, and later
  purchase validation.
- **Reused:** the whole UI. Scene (`src/app/garden/scene/*`, `scene.css`), workspace,
  editor, returns cabinet, first run, import form, all of `src/lib/garden/**` (the pure
  logic already takes a `db` argument in `tending-data.ts`, `tending-history.ts` and
  `import-core.ts`), durable drafts in IndexedDB (`drafts.ts`), tests, and the axe and
  performance harnesses. Estimated reuse above 90% of lines; about 800 server-coupled
  lines are rewritten as a client repository, plus an estimated 500–1,000 new lines for
  the native shell, auth storage, push and safe-area work **[assumption]**.
- **Time:** TestFlight 3–5 weeks. Approval 7–11 weeks.
- **App Review risk:** medium, reduced to low–medium by: bundled binary, offline
  launch and offline drafts, native push, no browser chrome, no marketing page inside
  the app, native share and haptics. Many approved apps are built this way
  **[assumption from general knowledge; no Apple statement guarantees it]**.
- **Meadow performance risk:** medium and unmeasured. WKWebView uses the same engine as
  Safari **[assumption]**; the risk is WebKit's cost for many animated SVG nodes and
  the canvas layer, not the shell. The same risk applies to the mobile web and to D.
- **Offline:** shell and drafts work offline at once. Reading the garden offline needs
  a local cache, and writes need an outbox; both are stage 3.
- **Push:** `@capacitor/push-notifications` (8.1.3) registers an APNs token; a new
  owner-scoped table stores it; the garden worker (or an Edge Function it calls) sends
  one content-free notification when a pass produces at least one bloom.
- **Payments:** StoreKit in-app purchase if anything is sold in the app (see
  "Payments").
- **Maintenance:** one UI codebase, two build targets, one small native project.
  Capacitor major upgrades roughly yearly. Android is the same bundle with a second
  native project.
- **Reversibility:** high. The client data layer is equally what a PWA, an Expo app or
  a Tauri shell would need. Removing Capacitor deletes one directory.

### B. Expo / React Native sharing domain logic

- **What gets built:** a new Expo app. Screens are rebuilt with React Native
  primitives, or wrapped as DOM components.
- **Reused if rebuilt natively:** pure TypeScript only: `src/lib/garden/**` (genome,
  species, layout, growth, camera, plant geometry, palette, search, validation,
  import and export formatting), `src/types/database.ts`, the Supabase queries. That is
  roughly 4,000–5,000 lines. Not reused: every `.tsx` component (DOM elements and
  class names), all CSS (about 8,000 lines), `motion/react` `layoutId` transitions, CSS
  keyframe sway, and the 830-line Canvas 2D atmosphere (`atmosphere.ts`), which would
  need a native canvas library.
- **How much of the SVG scene carries over:** path strings from `plant-geometry.ts`
  carry to `react-native-svg` directly. The plant components (`living-plant.tsx`,
  `scene-bed.tsx`, `garden-scene.tsx`, `garden-ring.tsx`, about 2,900 lines) would be
  rewritten, and every motion and style rule re-authored. Desktop web would then run
  through `react-native-web`, which is a second rewrite risk for the surface that
  already works.
- **With DOM components instead:** the scene and editor could run as-is inside a web
  view. But then the meadow is a web view anyway, with an asynchronous prop bridge and
  Expo's own recommendation against using this as the destination **[verified]**. That
  is Option A2 with more machinery.
- **Time:** TestFlight 8–14 weeks; approval 12–20 weeks.
- **App Review risk:** low. **Meadow risk:** high during the rewrite (new renderer,
  new motion system, budgets re-earned). **Offline:** good options, all new work.
  **Push:** well supported. **Payments:** as A2. **Maintenance:** one codebase only if
  the web is also migrated; otherwise two. **Reversibility:** low after the UI forks.
- **Verdict:** the right choice only if a web view cannot hold the meadow's frame
  budget on real iPhones. Not the fast track.

### C. Resume the SwiftUI native app

- **What gets built:** auth, the hosted v2 contract, sync and conflict handling, the
  living meadow, returns cabinet, tending settings, first run, search, import, export
  and deletion, in Swift. The prototype has a static photographic meadow and a local
  SwiftData store only.
- **Reused:** the domain shapes and outbox ideas in `SlowGardenCore`, design
  references, database, RLS and worker. No UI.
- **Time:** TestFlight 12–20 weeks; approval 16–26 weeks.
- **App Review risk:** lowest. **Meadow risk:** medium (a new renderer, but native).
  **Offline:** best (SwiftData, Data Protection, already designed in ADR-001).
  **Push:** native. **Maintenance:** two UI codebases permanently; every product
  change since ADR-006 is built twice. **Android:** nothing. **Reversibility:** low.
- **Verdict:** contradicts D-024's request for an aligned codebase and is the slowest
  route. Keep the prototype preserved, as ADR-006 says. Native Swift remains the place
  for small extensions later (widget, share extension), which can live beside a
  Capacitor app.

### D. PWA only (baseline)

- **What gets built:** web manifest, icons, a service worker for the shell, optional
  Web Push.
- **Reused:** everything. **Time:** 1–2 weeks. No review.
- **Limits:** no App Store presence, which D-024 asks for. Push only after the person
  adds the site to the Home Screen through Safari's share menu, iOS 16.4+
  **[verified via Next's guide]**. Install is manual and undiscoverable.
- **Verdict:** not sufficient alone, but its work (manifest, mobile-first layout) is a
  subset of A2 and keeps desktop and Android browsers served. It is the fallback if
  Apple refuses the app.

### E. Other credible options

- **E1. Tauri 2 mobile:** same static-bundle approach and the same refactor as A2.
  Adds a Rust toolchain; push depends on young community plugins **[secondary]**. No
  advantage over Capacitor for this product.
- **E2. Hand-written WKWebView shell** in the existing Xcode project: a few hundred
  lines of Swift, no framework. Credible for iOS alone, but push, deep links, the
  local scheme handler and Android would all be hand-built. Capacitor is this, already
  maintained.
- **E3. Replace Next with a Vite single-page app:** removes the two-build-target
  arrangement, but discards server rendering for the public landing page and is churn
  with no user benefit now. Revisit only if the dual build proves fragile.

## Decision

**Recommended: Option A2.** Refactor the web app to a client-side data layer, make it
mobile-first, and ship the same React codebase inside a Capacitor 8 iOS shell as a
bundled static build. Keep the hosted Next app for desktop and mobile browsers, with a
PWA manifest. Use A1 only as a private measuring build in the first days. Keep the
SwiftUI prototype preserved and unshipped.

Boundary of the decision:

- Authorizes, on acceptance: adding Capacitor (core, iOS, and the push, preferences or
  secure-storage, app, keyboard, haptics, share and filesystem plugins as each is
  needed) pinned in the lockfile; a new native project directory
  `applications/mobile/`; a static export build target in `applications/web`.
- Does not authorize: any hosted migration, Edge Function deployment, APNs or billing
  vendor choice, live-update service, analytics SDK, model activation, or external
  pilot. Each keeps its own gate.
- Supersedes for delivery sequencing: ADR-001's SwiftUI-primary client and the
  baseline's "do not share UI code" rule. Data, provenance, RLS and worker decisions
  are unchanged.

### Required refactors in `applications/web`

1. **One Supabase client factory.** `src/lib/supabase/client.ts` returns:
   - in a browser: the existing `@supabase/ssr` browser client (session in cookies, so
     the server can still redirect signed-in visitors from `/` and `/login`);
   - in the app: a `supabase-js` client with `persistSession`, token auto-refresh
     tied to app foreground state, and a storage adapter backed by the iOS Keychain or
     app-private preferences. Community reports of sessions lost on app restart exist
     **[secondary]**; this is a week-one spike with an explicit pass test.
   `src/lib/supabase/server.ts` and `proxy.ts` remain for the hosted web only.
2. **A client data layer**, for example `src/lib/garden/repository/`, taking a
   Supabase client argument, used by both builds:
   - reads: `loadGarden` and `allRows` from `data.ts`; `loadTending`,
     `loadTendingHistory` (already client-agnostic); `readReturns`; `locateRevisions`;
     entry history (replaces `/garden/history`);
   - mutations: the eleven data functions from `actions.ts`, unchanged in logic, with
     the tenant ID taken from the session;
   - import: `runImport` from `import-core.ts` with the same adapter;
   - export: build the document in the client from `lib/garden/export.ts` (already
     pure); save through a download on web and the share sheet in the app.
3. **Client state instead of `revalidatePath` / `router.refresh()`.** `GardenWorkspace`
   stops receiving `data` as a server prop and reads it from a `useGarden()` hook with
   an explicit `reload()`. No new state library is required for this.
4. **Auth guard in the client** for `/garden` and `/garden/import`; the app build
   starts at `/garden` or `/login` and contains no marketing page.
5. **Validation moves down.** `lib/garden/validation.ts` stays as the client check.
   Before submission, each rule the server actions enforced (name and body limits,
   bloom-response shape, time zone) needs an equivalent database constraint or RPC
   check, verified by pgTAP. This is a migration and follows the migration rule.
6. **AI availability flag.** `GARDEN_AI_ENABLED` becomes a server-controlled value the
   client can read (for example a one-row status relation or RPC). The database gate
   that already rejects passes (error `55000`) stays the authority; confirm it does
   not depend on the server action's environment check.
7. **Build target.** `next.config.ts` gains a conditional `output: 'export'`. The app
   build omits `headers()`, the dev and preview routes, and the route handlers; its CSP
   is delivered as a `<meta>` tag with the same directives and the Supabase origin in
   `connect-src`.
8. **Mobile-first pass.** `viewport-fit=cover` and safe-area insets in `layout.tsx`,
   `globals.css`, `scene.css` and `level-pages.css`; keyboard avoidance in
   `entry-editor.tsx`; touch targets; the 390 px scene treated as the primary layout
   and 1280 px as the enhancement.
9. **Account deletion** (already directed by D-024): an in-app flow under account
   settings; a privileged Edge Function that revokes sessions and starts the deletion
   workflow in the threat model; a stated completion time and a confirmation.

### Staged plan

**By week 2**

- Owner enrolls in the Apple Developer Program and reserves the bundle ID.
- Real-device meadow measurement: first in Safari on the owner's iPhone (no install
  needed), then in a private A1 TestFlight build. Record a receipt beside the existing
  performance receipt.
- Client data layer for reads and mutations landed on the hosted web behind the same
  UI, with tests; server actions deleted only after parity.
- Auth storage spike in the shell: sign in, kill the app, reopen, still signed in;
  sign out erases tokens and drafts.
- In-app deletion designed against the threat model's deletion graph.
- **Decision point 1:** if the meadow misses 33 ms p95 on the owner's iPhone in
  WKWebView and two weeks of scene optimisation would not fix it, stop and choose
  between a simplified phone scene and Option B.

**By week 6**

- Static export target building; Capacitor project in `applications/mobile/`;
  internal TestFlight on the bundled build.
- Mobile-first layout pass complete; axe and performance harnesses run at 390 px
  against the export.
- Push end to end on a synthetic account: token table (migration, gated), one
  content-free "Your garden returned" notification sent only when a pass yields at
  least one bloom, permission asked in context and never at first launch.
- Account deletion working on synthetic canaries. Privacy policy and support pages
  live. AI consent screen in place.
- PWA manifest and icons on the hosted web.
- **Decision point 2:** is the build honestly more than a website (offline launch,
  drafts, push, native share)? If not, do not submit yet.

**By month 3**

- External TestFlight (this triggers Beta App Review), then App Store submission
  around weeks 7–9, with time for one rejection round.
- Offline read cache and write outbox with the existing `expectedRevisionId` conflict
  semantics; local data protected and erased on sign-out (T-09).
- Pricing decision made before any paid tier appears in the app; StoreKit integration
  only if that decision requires it.
- **Decision point 3:** after approval, decide Android (same bundle, second native
  project) and whether any native Swift extension (widget, share extension) is worth
  adding.

### What must exist before submission

- **Account deletion in the app** (5.1.1(v)), easy to find, deleting the whole
  account, with the time to completion stated.
- **Privacy policy URL** in App Store Connect and inside the app; **support URL** with
  working contact details.
- **Third-party AI disclosure and explicit permission** (5.1.2(i)): before tending is
  first switched on, a screen naming the provider, what is sent (selected writing from
  topics with tending on), why, retention, and how to withdraw. The existing
  off-by-default per-topic control is the right base; a line in the policy is not
  enough **[secondary guidance]**. If tending is unavailable in the reviewed build,
  say so in review notes and do not advertise it in screenshots.
- **Privacy nutrition label:** Email Address, User ID and Other User Content, each
  linked to the person, purpose App Functionality; no tracking; no third-party
  analytics. Declare the model provider as a recipient where the form asks.
- **Demo account for review** (2.1): reviewers cannot read an email inbox, so a
  dedicated review account needs a sign-in that does not depend on a live email code
  (for example a password credential for that account only). Fill it with synthetic
  writing and at least one returned bloom so the delayed feature is visible without
  waiting overnight. Review notes explain the overnight model and that zero blooms is
  a valid result.
- **Age rating questionnaire**, category, screenshots at required sizes, app icon.
- **Sign-in:** email one-time code only, so Sign in with Apple is not required (4.8).
  Adding any social login later makes it required, along with token revocation on
  deletion.
- **Payments:** version 1.0 ships free with no paid features and no purchase links.
  If a subscription is later sold on the web, 3.1.3(b) requires it to be available as
  an in-app purchase too; US-storefront links to web purchase are permitted by
  3.1.1(a) but the commission on them is unsettled. Enroll in the Small Business
  Program before the first sale.
- **Export compliance** answer (standard HTTPS encryption) and **push entitlement**
  set to production.

## Evidence and rationale

- The fastest honest route is the one that reuses the UI that already works. Over 90%
  of the web code is client-side React and pure TypeScript **[repo]**.
- The refactor A2 needs is small and well bounded because the server layer never held
  a privileged key **[repo]**. It also improves the web app: one data path, and the
  same layer is the base for offline reading.
- A1 is quicker to TestFlight but is what Capacitor and guideline 4.2 both warn
  against **[verified]**.
- B and C buy platform quality at the price of a second implementation of the meadow,
  the product's most expensive surface, before there is evidence that a web view
  cannot carry it.
- The largest unknown, real-iPhone frame pacing, is the same for A, D and the mobile
  web, and can be answered this week without installing anything.

Unverified items to confirm before relying on them: Capacitor's website guidance
(capacitorjs.com was unreachable; the shipped type documentation was used instead);
WebKit storage and push behaviour (webkit.org unreachable); Tauri and Supabase
documentation (unreachable); persistence and protection class of IndexedDB and local
storage inside WKWebView; current US link-out commission; Developer Program price;
whether Apple currently accepts a password-only review account alongside one-time-code
sign-in.

## Consequences

- **Easier:** one UI for phone, desktop and later Android; offline launch; native push;
  store presence; a single client data layer.
- **Harder:** two build targets to keep green; App Store release cadence (each binary
  reviewed) beside instant web deploys; native signing and certificates.
- **Newly required:**
  - Database-level validation that server actions used to provide.
  - Token and draft storage rules for the device (T-09), and content-free
    notifications (T-17).
  - A CSP delivered in the bundle.
  - A version-compatibility rule: an installed app may be older than the schema, so
    migrations stay additive (already the rule in ADR-006) and the client must tolerate
    absent tables, as the export route already does.
  - Apple account upkeep, privacy label, and review notes per release.
- **Unchanged:** data model, RLS, provenance, worker, tending tiers, the three-bloom
  cap, no chat or autocomplete in capture, activation and pilot gates, the preserved
  SwiftUI prototype.

### Risks and what would change the recommendation

| Risk | Signal | Response |
|---|---|---|
| Meadow misses the frame budget in WKWebView on real iPhones | Decision point 1 receipt | Optimise or simplify the phone scene; if still failing, Option B with the scene rebuilt natively |
| App Review rejects under 4.2 | Rejection notice | Add the missing app-like capability (offline reading, share extension), reply with specifics, resubmit; PWA remains live meanwhile |
| Session loss or token exposure in the shell | Week-one spike fails | Keychain-backed secure storage plugin; if unreliable, a small native auth bridge |
| Moving validation out of server actions weakens integrity | pgTAP gaps | Do not delete server actions until constraints exist; or keep a thin bearer-token API for writes |
| Reviewers cannot see the AI feature | Review questions | Seeded demo account and a short video in review notes |
| Paid tier arrives before the payments decision | Pricing work starts | Stop and decide IAP against web-only purchase before any price appears in the app |
| Local plaintext cache conflicts with the privacy direction in D-024 | Privacy research concludes | Keep the app online-read-only with local drafts only, as today |
| Solo capacity: native build chain consumes the weeks | Week-6 milestone missed | Fall back to D (PWA) publicly and continue the shell privately |

The recommendation changes to **B** if the frame budget cannot be met in a web view;
to **C** only if the product direction becomes iPhone-only with deep system
integration; to **D** alone if Apple's terms or review outcome make store distribution
not worth its cost.

## What the owner needs to provide

- Apple Developer Program membership (individual or organization; an organization
  needs a D-U-N-S number and shows the company name as seller).
- Bundle identifier (for example `app.slowgarden.ios`), app name and subtitle.
- A Mac with current Xcode, and a physical iPhone for measurement; ideally one older
  model.
- An APNs authentication key, created in the developer account, stored only as a
  function secret.
- Privacy policy and support page content, and a monitored support email address.
- The model provider's current data-use and retention terms, for the AI consent text.
- Decisions: seller identity; whether version 1.0 is free; category and age rating
  answers; whether tending is enabled in the reviewed build.
- A dedicated synthetic review account, never containing real writing.
- Acceptance or rejection of this record, and of the two decision points that can
  stop the plan.

## Verification and rollback

- **Acceptance tests:**
  - Hosted web: `npm run lint`, `npm test`, `npm run test:node`, `npm run build` pass
    with the client data layer and no server actions on garden paths.
  - Export build: the same suites pass; axe and performance harnesses pass at 390 px.
  - Device: real-iPhone p95 frame time within the ADR-007 phone budget, recorded as a
    receipt; session survives app restart; sign-out erases tokens and drafts.
  - Two-user negative RLS tests still pass for every relation the client now calls
    directly; validation constraints covered by pgTAP.
  - Push: a notification snapshot contains no private content.
  - Deletion: synthetic canaries absent after the workflow.
- **Monitoring signal:** App Review outcome; content-free crash and hang reports from
  App Store Connect only.
- **Rollback:** the hosted web app keeps working throughout, because the client data
  layer lands there first. Removing the app means deleting `applications/mobile/` and
  the export target; no data migration is involved. Server actions can be restored
  from history if direct client access proves unsound. The SwiftUI prototype is
  untouched.

## Sources

All accessed 2026-11-16.

- App Review Guidelines (4.2, 4.7, 4.8, 5.1.1, 5.1.2, 3.1.1, 3.1.3, 2.1):
  https://developer.apple.com/app-store/review/guidelines/
- Guideline changes of 2025-11-13 (5.1.2(i) third-party AI):
  https://developer.apple.com/news/?id=ey6d8onl
- Offering account deletion in your app:
  https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App privacy details:
  https://developer.apple.com/app-store/app-privacy-details/
- App Review timing and common issues:
  https://developer.apple.com/distribute/app-review/
- Small Business Program:
  https://developer.apple.com/app-store/small-business-program/
- Updated age ratings (found by search, not opened):
  https://developer.apple.com/news/?id=ks775ehf
- Package versions: npm registry (`npm view`) for `@capacitor/core`, `expo`,
  `react-native`, `react-native-web`, `react-native-svg`, `expo-router`,
  `@tauri-apps/cli`, `@capacitor/push-notifications`.
- Capacitor configuration reference: `dist/declarations.d.ts` inside the
  `@capacitor/cli` 8.6.2 package.
- Capacitor 8 requirements (secondary): https://ionic.io/blog/announcing-capacitor-8 ,
  https://capgo.app/docs/upgrade/from-v7-to-v8/
- Next static export and PWA guides: `node_modules/next/dist/docs/01-app/02-guides/`
  in this repository (Next 16.4.3).
- Expo DOM components guide (source file):
  https://raw.githubusercontent.com/expo/expo/main/docs/pages/guides/dom-components.mdx
- Expo SDK 58 changelog (secondary, by search): https://expo.dev/changelog/sdk-58.md
- Web Push for web apps on iOS (secondary, by search):
  https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Storage cap and Home Screen apps (secondary, by search):
  https://webkit.org/blog/11338/cname-cloaking-and-web-privacy/
- Epic v. Apple link-out commission status (secondary):
  https://www.macrumors.com/2025/12/11/apple-app-store-fees-external-payment-links/ ,
  https://www.macrumors.com/2026/04/29/epic-games-wins-reversal-app-store-fee-battle/
- Remote-URL shells and review (secondary):
  https://capawesome.io/blog/the-right-way-to-update-your-capacitor-app-remotely/
- Tauri mobile push plugins (secondary):
  https://github.com/yanqianglu/tauri-plugin-mobile-push

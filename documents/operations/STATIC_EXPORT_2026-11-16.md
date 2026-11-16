# Static export build target (ADR-009 stage 3)

- Date: 2026-11-16
- Scope: `applications/web`, two scripts under `scripts/`, and this record. No
  dependency, no Capacitor, no migration, nothing under `supabase/`, nothing hosted.
- Follows [CLIENT_DATA_LAYER_STAGE2_2026-11-16.md](CLIENT_DATA_LAYER_STAGE2_2026-11-16.md)
  ("What still blocks `output: 'export'`") and D-027.
- The hosted build is unchanged in behaviour: with the switch unset, `next.config.ts`
  produces the same four settings and the same nine response headers as before
  (pinned in `static-readiness.test.ts`), and Next does not see the new route files.

## Result

`GARDEN_STATIC_EXPORT=1 npx next build` now writes a working static export to `out/`.
It was built in an isolated copy of the tree, served by `python3 -m http.server`, and
driven in Chromium at 390 and 1440 wide: signed out with no backend contacted, and
signed in against a scratch local Supabase stack with real emailed codes. All checks
passed (below). There is no native shell; nothing here was run in WebKit or on a phone.

## What the switch does

One build-time variable, read only by `next.config.ts`:

| `GARDEN_STATIC_EXPORT` | Build |
|---|---|
| unset, empty, `0` | The hosted app, as before. |
| `1` | Static export to `out/`. |
| anything else | The build fails ("must be \"1\" or unset"), so a typo cannot produce the other build. |

With `1`, the configuration is:

- `output: "export"`, `trailingSlash: true` (`/garden` is written as
  `garden/index.html`, which a plain file server can serve without rewrite rules).
- `pageExtensions: ["static.tsx"]`. Only files named `*.static.tsx` are routes. The
  server pages, both route handlers, `/api/health`, the dev and preview pages and
  `src/proxy.ts` are therefore not in this build at all. In the hosted build the
  default extensions apply and `page.static.tsx` is not a route name, so the hosted
  build never sees the static files. The two sets cannot leak into each other.
- No `headers()`. Three public constants are inlined instead:
  `NEXT_PUBLIC_GARDEN_STORE=browser`, `NEXT_PUBLIC_GARDEN_TARGET=static`, and
  `NEXT_PUBLIC_GARDEN_CSP` (the header's policy for a `<meta>` tag).
- The build fails if `NEXT_PUBLIC_GARDEN_STORE` is set to anything but `browser`, or
  if either Supabase value is missing (a bundle cannot be configured after it is built).

Static route files (all new, each a few lines):

| File | Route | What it renders |
|---|---|---|
| `app/layout.static.tsx` | root | The hosted layout plus `<meta http-equiv="Content-Security-Policy">` and `<meta name="referrer" content="no-referrer">` |
| `app/page.static.tsx` | `/` | The landing page (now `landing/landing-page.tsx`, shared with the hosted page) and `SignedInRedirect` |
| `app/login/page.static.tsx` | `/login/` | `BrowserStoreProvider` + `LoginScreen` |
| `app/garden/page.static.tsx` | `/garden/` | `BrowserStoreProvider` + `BrowserGarden` |
| `app/garden/import/page.static.tsx` | `/garden/import/` | `BrowserStoreProvider` + `BrowserImport` |
| `app/account/deleted/page.static.tsx` | `/account/deleted/` | The hosted page, re-exported |
| `app/loading.static.tsx`, `app/error.static.tsx` | boundaries | The hosted ones, re-exported |

Other source changes:

- `next.config.ts`: the switch. The hosted branch returns what the file returned before.
- `lib/supabase/client.ts`: in the static target the browser client is a `supabase-js`
  client (`persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`), one per
  page, with the session in `localStorage`. Otherwise it is the same `@supabase/ssr`
  cookie client as before, called with the same arguments.
- `app/page.tsx`: the markup moved to `landing/landing-page.tsx` with two props; the
  page still reads the session and the two flags per request. Same output.
- `landing/signed-in-redirect.tsx` (static only): asks the store once and sends a
  signed-in visitor to `/garden`.
- `scripts/test-web-journeys.mjs`: new optional `GARDEN_TEST_SESSION=storage` (default
  `cookies`, unchanged), so the journeys can read the session from where a static
  export keeps it. `scripts/check-static-export.mjs`: new, the signed-out shell check.

## Each blocker and its outcome

"Removed" means absent from the static build and replaced there by a client-side
equivalent. The server-path files themselves stay, because the hosted app still runs
on them; deleting them is step 13 of the stage 1 record and is not part of this work.

| Blocker (stage 2 list) | Outcome in the static build | Client-side equivalent |
|---|---|---|
| Route handlers `garden/export`, `garden/history` (read the Request) | **Removed.** Not routes in this build; `/garden/export` and `/garden/history` answer 404 from the file server | `store.exportGarden` (file built in the browser, saved through a `Blob`), `store.loadEntryHistory`. Both exercised signed in |
| `api/health` | **Removed**, with no equivalent. A file server has nothing to report; monitor the host instead | none |
| `src/proxy.ts` (session refresh, `no-store`) | **Removed.** No proxy is compiled (the hosted build still lists "Proxy (Middleware)") | The browser client refreshes its own session. The exported files hold no private data, so there is nothing for `no-store` to protect |
| Server actions (`actions.ts`, `import/actions.ts`, `returns-lookup.ts`, `server-loader.ts`) | **Removed.** The build's server-reference manifest is empty and no action id is in the bundle | The browser store, all 22 operations |
| Server pages: `force-dynamic`, cookie session, server `searchParams`, `redirect()` | **Removed.** Every exported route is prerendered static (`○`) | Static page files above. The garden is read from `useSearchParams()` in the browser; a signed-out visit shows sign-in in place; `/login` and `/` send a signed-in visitor on from the browser |
| `cookies()` / `headers()` (`lib/supabase/server.ts`, the only caller) | **Removed.** Not reachable from any static route | Session in browser storage |
| Cookie-based session | **Removed** for this target. The bundle contains no `document.cookie` use; the cookie client was dropped by the bundler | `localStorage` key `sb-<ref>-auth-token` |
| `headers()` in `next.config.ts` | **Partly removed.** The content policy and referrer policy are in the document. The policy was shown to be enforced (a request outside `connect-src` was blocked) | See "Remaining" for the headers a document cannot carry |
| Landing page reads the session and `GARDEN_AI_ENABLED` on the server | **Removed.** | The two switches are read once at build time; the signed-in check runs in the browser |
| Deployment flags read by `StoreBoundary` | **Removed.** The static pages pass none | The database decides alone through `garden_capabilities()` (D-026) |
| `select.ts` names the server wiring | **Not in the graph.** No static route imports `select.ts`, `provider.tsx` or `store-boundary.tsx` | `BrowserStoreProvider` |
| Dynamic route segments | None existed; still none | |
| Dev and preview pages (`/dev/axe-fixtures`, `/garden/meadow-preview`, `/garden/returns-preview`) | **Not exported**, by design | See "Remaining" 5 |

### Remaining, with reasons and what each needs

1. **The server path still exists.** The actions, handlers, proxy and server pages are
   excluded from the static build, not deleted. Reason: the hosted app is still on the
   server store (D-027). Needs: the hosted app moved to the browser store, then stage 1
   step 13.
2. **Headers a document cannot carry.** `frame-ancestors` / `X-Frame-Options`, HSTS,
   `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
   `Cross-Origin-Resource-Policy`, `X-DNS-Prefetch-Control`. Browsers ignore
   `frame-ancestors` in a `<meta>` policy, so it is left out of the tag. Needs: the
   static host's own header configuration if the export is ever served on the web. In
   a native shell the page is not served over HTTP to other origins, so framing and
   HSTS do not arise there; that is an assumption to confirm in the shell.
3. **The policy tag is not first in `<head>`.** React places it after the stylesheet
   and script tags of the page's own chunks. Those are same-origin files the policy
   allows; everything loaded later (requests, further chunks, inline script) is under
   it. `script-src` still allows `'unsafe-inline'`, as on the hosted app. A static
   export has no per-request nonce; tightening it means hashing the inline scripts at
   build time, which was not attempted.
4. **D-029 does not apply here.** No server confirms the session, so after "Sign out
   on all devices" a copied access token is honoured by the data API until it expires
   (observed again: read and write accepted, 3600 s token). D-029 named this stage as
   the moment to revisit. Needs: a session check in the database policies or a shorter
   token lifetime; both are hosted changes.
5. **The accessibility and performance harnesses cannot run against the export.** They
   use `/dev/axe-fixtures`, which is forced dynamic and reads a server search
   parameter. Needs: a static fixture page that reads the state from
   `useSearchParams()`, behind its own build flag. ADR-009 asks for both harnesses at
   390 px against the export before TestFlight; not done.
6. **Addresses without the trailing slash.** The app's own code still writes
   `/garden?…` (`router.push`, one `history.replaceState`, and
   `window.location.assign("/account/deleted")`). Next's router adds the slash for its
   own navigations. A full load of `/garden?view=list` depends on the server
   redirecting a directory to `/garden/` and keeping the query; Python's server does
   (observed). Whether a shell's local server does is unverified.
7. **Export links keep `href="/garden/export…"`.** A click is answered by the store.
   Opening the link in a new tab would reach a path that does not exist in the export.
   The `Blob` download itself worked in Chromium; it is not expected to work in
   WKWebView, where the share sheet replaces it (ADR-009).
8. **The landing page is in the export**, with its tending and deletion wording fixed
   at build time. ADR-009 says the app build has no marketing page. It is kept so the
   export is also a complete static site; the shell should start at `/garden/`, which
   shows sign-in when there is no session. Removing it is deleting `page.static.tsx`.
   Cost today: `/` loads the Supabase client only to check for a session (sizes below).
9. **No auth-change subscription** (sign-out in another tab is noticed at the next
   store call). Unchanged from stage 2.
10. **Hosted project.** The export needs the pending 20261116 migrations applied
    (`garden_capabilities()`, the browser-path rules) before it is pointed at it.

## Auth in the static bundle, and what a native shell changes

Today, in the export: `store.requestEmailCode` / `verifyEmailCode` through the browser
client; the session (access token, refresh token, expiry) is one `localStorage` item
on the page's origin; the client refreshes it; sign-out removes it. No cookie is set
and no session is read from the address. Exposure to script is the same as the hosted
app's script-readable cookies (D-027): script on the origin can read the refresh token.

Later, in a shell (not built; listed so the work is known):

- **Storage.** Replace `localStorage` with a Keychain-backed or app-private adapter,
  passed as `auth.storage` in the one place that creates the client
  (`lib/supabase/client.ts`). `localStorage` inside WKWebView is app-private but is
  not the Keychain, and its persistence under storage pressure is unverified. ADR-009's
  kill-and-reopen test and sign-out erasure of tokens and drafts (T-09) apply.
- **Refresh.** Start and stop `autoRefreshToken` with the app's foreground state.
- **Deep links.** Sign-in needs none: it is a typed code and `detectSessionInUrl` is
  off. The sign-in email must keep showing the code; a link in it would open the
  hosted site in Safari, not the app. For returning to a place, map a universal link
  or custom scheme onto the existing addresses (`/garden/?garden=…&topic=…`); there
  are no dynamic segments. The shell's start address should be `/garden/`.
- **Origin.** The policy's `'self'` becomes the shell's local origin, and the Supabase
  origin is already in `connect-src`. Whether the hosted auth and data APIs accept that
  origin without extra configuration is unverified.
- **Export and account deletion** need the share sheet and a navigation that does not
  rely on a directory redirect (items 6 and 7).

## How to build and serve

```
cd applications/web
GARDEN_STATIC_EXPORT=1 \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
npx next build                                   # writes out/
python3 -m http.server 3171 --bind 127.0.0.1 -d out

# signed out, no backend contacted
STATIC_BASE=http://127.0.0.1:3171 node ../../scripts/check-static-export.mjs
# signed in, against a dedicated local stack (see the script header)
GARDEN_TEST_BASE=http://127.0.0.1:3171 GARDEN_TEST_STORE=browser GARDEN_TEST_SESSION=storage \
  node ../../scripts/test-web-journeys.mjs
```

A static build also writes `.next/`, replacing a hosted build's output in the same
directory. Build it in a separate copy, or rebuild the hosted app afterwards. Optional
at build time: `GARDEN_AI_ENABLED`, `GARDEN_DELETION_ENABLED` (landing wording only).
Any file server that serves `index.html` for a directory works; nothing else is needed.

## Measured bundle

Export built against the scratch stack's URL, Next 16.4.3 (Turbopack). gzip is `-9`,
computed per file.

| | Files | Bytes | gzip |
|---|---|---|---|
| `out/` total | 84 | 4,069,330 | |
| JavaScript | 17 | 1,231,299 | 375,372 |
| CSS | 5 | 151,501 | 32,086 |
| HTML | 8 | 140,061 | 33,778 |
| Navigation payloads (`.txt`) | 24 | 183,138 | 56,014 |
| Fonts (`.woff2`) | 16 | 273,784 | |
| PNG (meadow background, icons) | 5 | 1,931,372 | |
| WebP, ICO, SVG, manifest | 9 | 158,175 | |

Script and style referenced by each page's HTML:

| Page | JS files | JS bytes | JS gzip | CSS bytes | CSS gzip |
|---|---|---|---|---|---|
| `/` | 10 | 850,526 | 251,385 | 45,811 | 11,179 |
| `/login/` | 10 | 847,644 | 250,557 | 31,669 | 8,190 |
| `/garden/`, `/garden/import/` | 11 | 1,197,268 | 361,657 | 137,023 | 28,864 |
| `/account/deleted/` | 9 | 578,311 | 178,575 | 32,005 | 8,423 |

Not measured: the hosted build's sizes for comparison, load time, or anything in WebKit.

## What was run

All on 2026-11-16, on this machine. Builds were made in a scratch copy of
`applications/web` (without `.env.local`, `.next` or `out`); the shared tree's `.next`
and the dev server on :3147 were not used (the dev server was asked for `/login` after
the `next.config.ts` edit, to see it had survived it: 200, policy header present).

- From `applications/web` in the shared tree: `npx tsc --noEmit` exit 0;
  `npx eslint .` exit 0; `npx vitest run` 53 files, 439 tests (51 files, 403
  tests before this work; none skipped or removed). **Not green on every run:** see
  "Intermittent test" below. New: `lib/supabase/client.test.ts`
  (3), `landing/signed-in-redirect.test.tsx` (4); `static-readiness.test.ts` went from
  13 to 42 tests. A mutation (forcing `garden/page.static.tsx` dynamic and importing
  the server loader) failed three of them and was reverted.
- **Static build** in the copy: exit 0, no warning; 7 routes, all static; no proxy.
- **Hosted build** in the same copy afterwards (`npx next build`, no variables): exit
  0; the same 13 routes and "Proxy (Middleware)"; no `out/`. Served with `next start`:
  the policy, frame, HSTS and `private` cache headers are sent, no policy `<meta>` is
  in the page, `/api/health` 200, `/page.static` and `/garden/page.static` 404. (With no Supabase
  values the two garden route handlers answer 500; they were not edited.) It was
  not compared file by file with a build of the tree before this change.
- **Signed out**, `scripts/check-static-export.mjs`, Chromium 153, 390x844 and
  1440x900, both PASS: landing, sign-in and the garden shell each load from their own
  file; landing → sign-in → landing → sign-in with 0 new documents; `/garden/`, a garden
  address with a query and `/garden/import/` show sign-in in place with the address
  kept; `/account/deleted/` and its way back; export, history, health, fixture and
  preview paths 404; 0 requests other than GET or HEAD, 0 missing files, 0 requests to
  another origin, 0 cookies, 0 console errors; a request outside `connect-src` blocked.
- **Signed in**, `scripts/test-web-journeys.mjs` with `store=browser session=storage
  deletion=on` against the same file server: desktop 1440x900 **15 passed, 0 failed, 2
  skipped**; phone (the script's iPhone 14 metrics, 390x664) **15 passed, 0 failed, 2
  skipped** (skips are the journeys for the other device and for deletion off). This
  covers sign-in by emailed code, a wrong code refused, `/` and `/login` sending a
  signed-in person to the garden, the session surviving a new browser context, first
  run, write and revise with history, archive and restore, timeline and search, import,
  export, returns and settings, gardens and topics, sign-out (no session left),
  sign-out everywhere, deletion including the ten-minute re-sign-in and account
  deletion, and two-account isolation. Console errors were the expected ones only (403
  for the wrong code; 400 and 403 in account deletion, as in stage 2).
- **The scratch stack**: a copy of `supabase/` with `project_id = "slow-garden-static"`
  and ports 5642x, started from stopped with
  `-x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta`,
  all migrations in the tree applied, and stopped with `--no-backup` afterwards (no
  container or volume of that name remains). Changed in the copy only: email rate limit
  2 → 2000 an hour, resend interval 60 s → 1 s, and the database's deletion switch
  turned on. The running `supabase_db_slow-garden` container was not touched.
  **Deviation:** the brief named `npx supabase@2.109.1`. That version needs two images
  that are not on this machine, and pulling them was refused by the network policy, so
  it could not start. The stack was started with CLI 3.1.0, whose images are already
  here and which VERIFICATION_2026-11-16 also used.

### Intermittent test (not caused by this work, not fixed)

`app/garden/journeys.test.tsx`, browser mode, fails now and then: 3 of 10 full-suite
runs here, each time one test ("keeps a bloom from the full record in Returns": after
"Open the full record" the respond group never appears, until the 8 s wait runs out).
Run alone it failed 2 of 25 times. In the scratch copy with `lib/supabase/client.ts`
put back to its original text (the only file this work changed in that test's import
graph) it failed 2 of 40 times, once on the same test and once on "archives an entry
out of the active view and restores it from Archive". The other 7 full runs were 439
of 439. The test, `returns.tsx`, `guard.ts` and `browser-entry.tsx` were not edited.
The cause was not found; one unchecked guess is the write guard being asked before the
gate's effect has told it what is on screen. It needs its own look, because if that is
the cause it is a narrow race in browser mode and not only a test problem.

## Not verified

- **Any native shell, WebKit, Safari or a real phone.** Chromium only. The export has
  never been loaded from a `capacitor://` origin.
- **The hosted project and Vercel.** Nothing was read or changed. The export was never
  pointed at the hosted database.
- **HTTPS.** Everything ran on `http://127.0.0.1`; `upgrade-insecure-requests` in the
  policy did not interfere there.
- **Session lifetime in storage:** a real one-hour expiry, storage eviction, and
  private browsing. Refresh was not forced in this run (stage 2 forced it with the
  cookie client).
- **Tending end to end** (request, cancel, respond): the scratch stack has the runtime
  off, as in stage 2.
- **Accessibility and frame budget of the export** (item 5 above).
- **`next dev` with the switch set**, and a static host other than Python's server.
- **Byte equivalence of the hosted build** before and after: asserted for the
  configuration and headers by test, observed for routes and responses, not diffed.
- `workspace-guard` does not exist on this machine and was not run. One read-only
  `git diff --stat` was run by mistake early on; no other git command was run.

## Before a Capacitor shell

Engineering, in order:

1. Storage adapter spike in the shell: sign in, kill, reopen, still signed in; sign-out
   erases tokens and drafts (ADR-009 item 1).
2. Confirm how the shell's local server answers `/garden/`, `/garden?…` and a cold
   start, then fix the three addresses in item 6 if needed.
3. Share sheet for export; foreground-tied token refresh.
4. A static fixture page, then the axe and performance harnesses against the export at
   390 px, and the real-device meadow measurement (ADR-009 decision point 1).
5. Decide the D-029 gap for this target (item 4) before any external account.
6. Apply the pending migrations to the hosted project, then build the export against it.
7. Decide whether the landing page stays in the app build (item 8).
8. Then: `applications/mobile/`, Capacitor pinned in the lockfile, `webDir` = `out`.

Owner inputs (none of this can be done by an agent):

- Apple Developer Program enrolment (individual or organisation).
- Bundle identifier, app name and subtitle.
- A Mac with current Xcode and a physical iPhone for the measurements.
- Acceptance of ADR-009 (still "Proposed for owner decision"), which is what
  authorises adding Capacitor.
- Later, per ADR-009: APNs key, privacy policy and support pages, review account.

## For the decision log

- The build switch is `GARDEN_STATIC_EXPORT=1`; static routes are `*.static.tsx`
  selected by `pageExtensions`; the export always uses the browser store and
  `trailingSlash`.
- The export keeps the session in browser storage, not cookies. The hosted app is
  unchanged.
- The export includes the landing page, with its switches read at build time
  (differs from ADR-009's "no marketing page"; reversible by deleting one file).
- The export's content policy is a `<meta>` tag without `frame-ancestors`; the other
  security headers have no owner in a static build.
- D-029's known limit now also describes the static target.

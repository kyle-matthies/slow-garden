# Client data layer, stage 2 (ADR-009): the workspace on the store

- Date: 2026-11-16
- Scope: `applications/web/src/**` and this record. No dependency, framework, migration,
  hosted call, Capacitor install or `next.config.ts` change. No git command was run.
  `workspace-guard` does not exist on this machine and was not run.
- Follows [CLIENT_DATA_LAYER_2026-11-16.md](CLIENT_DATA_LAYER_2026-11-16.md) (its
  next-stage checklist, steps 1 to 7, 9 and 10) and
  [BROWSER_PATH_RULES_2026-11-16.md](BROWSER_PATH_RULES_2026-11-16.md).
- `NEXT_PUBLIC_GARDEN_STORE` is still unset everywhere, so the app runs the `server`
  store. Nothing was switched over.

## Result in one paragraph

Every data call in the workspace and its children now goes through `useGardenStore()`.
With the default `server` store those calls reach the same server actions and route
handlers as before, and refresh is still `revalidatePath` plus `router.refresh()`.
With `NEXT_PUBLIC_GARDEN_STORE=browser` the same components run against Supabase from
the browser: the garden and import pages load through `store.loadGarden()`, a missing
session shows the sign-in screen in place, a change is followed by a re-read through
the store, and export is built in the browser. **Browser mode was run end to end in a
real browser against a real local Supabase stack, with a real emailed code**, for the
first time (transcript below). All 16 steps passed in both modes.

## What moved

| Component | Before | Now |
|---|---|---|
| `workspace.tsx` | imported `respondToMark`, `setArchived`, `setPlotPermissions`, `signOut`; `fetch("/garden/history")`; six `/garden/export` links | the same four through the store (`setTopicTending` is the store's name for `setPlotPermissions`); `store.loadEntryHistory`; `ExportLink` |
| `entry-editor.tsx` | `saveEntry` | `store.saveEntry` |
| `first-run.tsx` (seed packs save through it) | `createArea`, `saveEntry` | store |
| `new-area.tsx` | `createArea` | store |
| `returns.tsx` | `readReturns`, `inviteReflection`, `cancelReflection`, `respondToBloom`, `locateRevisions` | `loadReturns`, `requestPass`, `cancelPass`, `respondToBloom`, `locateRevisions` |
| `tending-settings.tsx` | `setTendingPreferences` | store |
| `delete-control.tsx` | `previewDeletion`, `deleteItem`, `deleteAccount`; two export links | store; `ExportLink` |
| `delete-reauth.tsx` | browser Supabase client (`signInWithOtp`, `verifyOtp`) | `store.requestEmailCode(email, { createAccount: false })`, `store.verifyEmailCode` |
| `import/import-form.tsx` | `importThought` | store |
| `login/login-form.tsx` | browser Supabase client | `store.requestEmailCode`, `store.verifyEmailCode` |
| sign-out, sign out everywhere | `signOut(scope)` action | `store.signOut(scope)` |

No data call existed in `chronology.tsx`, `recent-writing.tsx`, `returns-cabinet.tsx`,
`morning-return.tsx`, `tending-activity.tsx`, `seed-pack-shelf.tsx`, `delete-zone.tsx`
or `level-returns.tsx`; they take data and callbacks from the workspace and were not
edited. Each edited component changed by an import and a hook line (the call sites keep
their names, taken from the store by destructuring), so copy, markup and CSS are
untouched. `static-readiness.test.ts` fails if a client component under `app/` imports
a server action, `returns-lookup`, a Supabase client, or fetches a `/garden/` route.

New files:

| File | Purpose |
|---|---|
| `lib/garden/store/context.tsx` | The context and hooks (`useGardenStore`, `useGardenData`, `useGardenReload`), with no import of any store implementation |
| `lib/garden/store/browser-provider.tsx` | `BrowserStoreProvider`: the browser store only, no path to the server wiring |
| `lib/garden/store/provider.tsx` | Unchanged behaviour; now re-exports the hooks from `context.tsx` |
| `app/garden/store-boundary.tsx` | Server component used by the pages: picks the provider from `NEXT_PUBLIC_GARDEN_STORE` |
| `app/garden/browser-entry.tsx` | Browser-mode entry: `BrowserGarden`, `BrowserImport` (loading, signed out, error, ready) |
| `app/garden/export-link.tsx` | An export link; in browser mode it is answered by `store.exportGarden` and a download |
| `app/login/login-screen.tsx` | The sign-in screen, moved out of `login/page.tsx` so the garden can show it in place |
| `lib/garden/store/testing/render.tsx`, `import-graph.ts` | Test helpers (provider wrapper; import-graph walker shared with `boundaries.test.ts`) |
| `app/garden/journeys.test.tsx`, `app/login/login-form.test.tsx`, `lib/garden/store/static-readiness.test.ts` | Tests, below |

Pages: `garden/page.tsx`, `garden/import/page.tsx`, `login/page.tsx`, the axe fixture
page and the returns preview wrap their client tree in `StoreBoundary`. In server mode
`garden/page.tsx` and `import/page.tsx` do exactly what they did (cookie check, redirect,
`loadGarden`, server render). In browser mode they read no cookie and render the client
entry inside the browser provider.

## Server mode: what is the same, and the three things that are not byte-for-byte

Same, checked in a real browser against the local stack (server-mode transcript):

- one server action per write, followed by the same RSC refresh (for example "write a
  second entry": 1 action POST, 1 RSC GET; first run with a three-topic pack: 7 actions);
- revision history is `GET /garden/history?entry=`; export links are plain links to
  `GET /garden/export[?format=md][&garden=]`, followed by the browser, not by script;
- sign-in posts to the auth service from the browser, then `router.replace("/garden")`
  and `router.refresh()`; sign-out is the `signOut` action, then `/login`;
- messages and optimistic behaviour: the component tests that asserted the calls and
  messages before still assert them, on the same mocks, now reached through the provider.

Differences in server mode (none visible to the person):

1. **One extra script chunk, once.** The store is created lazily, so the first store
   call on a page loads the chunk that wires the server actions. It is a static asset,
   not a data request.
2. **`refresh()` is `router.refresh()` unless a reload function is in context.** In
   server mode none is, so it is always `router.refresh()`.
3. **Checklist step 7 was not done as written.** It proposed `useGardenData(initial)`
   with a `loadGardenForSession` reload in server mode too. That would have added a
   second server call after every change and changed the network behaviour, which this
   stage was told to keep identical. `useGardenData` is used by the browser entry only.

## Browser mode: behaviour differences from server mode

| Situation | Server mode | Browser mode |
|---|---|---|
| First paint of `/garden` | server-rendered garden | the "Gathering what you left here…" loading state, then the garden |
| `/garden` with no session | server redirect to `/login` | the sign-in screen is rendered at `/garden`; nothing is redirected |
| After signing in from there | lands on `/garden` (default location) | stays on the address that was asked for (topic, thought and view kept) |
| `/login` when already signed in | server redirect (still present on the hosted app) | also checked in the browser, then `router.replace("/garden")` |
| Switching garden, or the first garden created | previous view stays until the server answers | the loading state shows until the requested garden has loaded |
| Read failure | the route's `error.tsx` | the same component, "Try again" re-reads through the store |
| After a change | action revalidates, router refreshes | `reload()` through the store; a pass request also reloads the garden, as revalidation does |
| First run and "new garden" | one refresh | two garden reads (the address change and the explicit refresh); the older answer is discarded. Wasteful, not wrong |
| Export | the link is followed to the route handler | the same link is intercepted; the file is built by `store.exportGarden` and saved with a `Blob` and `<a download>`. A failure is said in the page's status line ("Export failed; no partial export was produced."), where the server path shows a plain-text error page |
| Export file contents | route handler | same shaping code (`shapeExport`): same bytes, name and media type. Two exports taken at two moments differ only in the database's `exported_at` |
| Tending and deletion switches | environment flags and the database | `StoreBoundary` passes the server's two flags down and the database must allow too (both must allow, as in server mode) |
| Session refresh | the proxy and server client refresh on each request | the browser Supabase client refreshes; on the hosted app the proxy still also runs |
| Private data in the HTML response | yes (`Cache-Control: private, no-store`) | none; the page shell is the same for everyone |

The fixture page (`/dev/axe-fixtures`) renders the workspace with injected data in both
modes; in browser mode it gets the browser store, and with no reload function in
context its refresh falls back to `router.refresh()`.

## Auth and tokens in browser mode

`lib/supabase/client.ts` is unchanged: `createBrowserClient` from `@supabase/ssr`. In
browser mode it is the only client that touches the session.

- **Where the tokens are.** In cookies on the app's own origin, written from script by
  the Supabase browser client: `sb-<project ref>-auth-token` (split into `.0`, `.1` when
  large), holding the access token, the refresh token and the expiry, plus short-lived
  `…-code-verifier` cookies. Attributes are the library's defaults: `Path=/`,
  `SameSite=Lax`, **not `HttpOnly`**, max age 400 days, and no `Secure` attribute
  (the library sets none; production is HTTPS with HSTS). Nothing is put in `localStorage`,
  `sessionStorage` or IndexedDB by auth (the only keys there are the draft store's own).
  Observed in the run: every auth cookie was readable by script in both modes.
- **This is the same storage server mode already uses.** Server mode's cookies are the
  same cookies, also not `HttpOnly`, because the browser client writes them at sign-in.
  Moving to browser mode therefore does not move the tokens. What changes is who uses
  them: in server mode the server reads the cookie on each request; in browser mode
  script reads it and sends the access token to Supabase as a bearer header.
- **Security consequence.** A script running on the app's origin (an XSS, a compromised
  dependency) can read the refresh token and act as the person from anywhere until the
  session is revoked ("sign out on all devices" does revoke it; verified below). That
  is already true in server mode. An `HttpOnly` cookie would not let script read the
  token but would still let injected script act as the person while the page is open,
  so the gain from `HttpOnly` is against token theft and reuse elsewhere, not against
  XSS itself. Getting `HttpOnly` tokens would need a server that holds the session and
  proxies every data call, which is the opposite of ADR-009's direction; a static or
  Capacitor build cannot have it at all. The mitigations that exist are the CSP
  (`script-src 'self' 'unsafe-inline'`: inline script is still allowed, see
  `SECURITY_REVIEW_2026-09.md`), `connect-src` limited to the app and the Supabase
  origin, refresh-token rotation with a 10 second reuse window, RLS on every table, and
  the ten-minute re-sign-in rule for account deletion. The CSP and headers were **not**
  changed here. A nonce-based `script-src` would matter more in browser mode than it
  does today, because the page now also holds the code that writes to the database.
- **In the app (later).** ADR-009 item 1 still applies: the Capacitor build needs
  Keychain-backed storage instead of cookies. Not built here.
- **Sign-in.** `store.requestEmailCode` / `verifyEmailCode`; the browser client stores
  the session. **Persistence**: a full reload of `/garden` shows the garden.
  **Refresh**: with the stored expiry set in the past, the next store call made the
  browser client call `POST /auth/v1/token?grant_type=refresh_token` (200), the refresh
  token rotated and the write succeeded. **Sign-out**: `auth.signOut({ scope })`, local
  or global; after "sign out on all devices" the account had 0 sessions and the cookie
  was gone. **Delete account**: with the session aged past ten minutes the first
  attempt was refused (`SGA01`, HTTP 400), the dialog asked for a new code, the code
  was verified in place, the second attempt erased the account, and the browser landed
  on `/account/deleted` with no auth cookie. The `403` on the final local sign-out is
  expected: the identity no longer exists (the store ignores it).
- **Server mode's cookie flow is untouched**: `proxy.ts`, `lib/supabase/server.ts` and
  the server pages' redirects are as they were.
- **Route protection** in browser mode is navigation only. `GardenGate` renders nothing
  private until `store.loadGarden()` has confirmed a session; RLS is the protection.
  Not handled: a sign-out in another tab is noticed at the next store call or reload,
  not at once (the store has no auth-change subscription).
- **A failed re-read after a successful change** keeps showing the previous data with
  no message (the change itself was saved and said so). The full-page error state is
  used only when there is nothing to show. Saying more would need new copy, which this
  stage was not to add.

## Export and history in browser mode

- `store.loadEntryHistory(entryId)` replaces `GET /garden/history`; `store.exportGarden`
  replaces `GET /garden/export`. Both existed in stage 1; this stage wires the UI to
  them. The route handlers stay for server mode.
- Formats are defined by `lib/garden/export.ts` and its tests, shared by both paths.
  `journeys.test.tsx` compares the downloaded bytes, file name and media type with the
  route handler's response for the same data (four links; the data includes non-ASCII
  text): equal. In the real run the Markdown files were byte-identical to the route
  handler's and the JSON files identical except `exported_at`.
- The download is a `Blob` URL clicked through a temporary `<a download>`. It worked in
  Chromium under the app's CSP. Safari, Firefox and iOS were not tried; in the Capacitor
  app this becomes the share sheet (ADR-009).

## Static-build readiness

`lib/garden/store/static-readiness.test.ts` (a check, not a build; `next.config.ts` is
unchanged and no export was built):

- Walks the import graph from the browser-mode entries (`browser-provider.tsx`,
  `browser-entry.tsx`, `login-screen.tsx`), counting type-only and dynamic imports as
  edges, and fails on `next/headers`, `next/cache`, `next/server`, `server-only`, the
  server Supabase client or any `"use server"` module. Result: none reachable. It also
  asserts the graph really contains the workspace, its children and the browser store,
  and contains none of `actions.ts`, `import/actions.ts`, `returns-lookup.ts`,
  `server-default.ts`, `server-loader.ts`, `select.ts`, `provider.tsx`, `data.ts`,
  `lib/supabase/server.ts`.
- So the browser entry does not depend on the bundler discarding the server branch in
  `select.ts` (stage 1 left that unverified): it never imports `select.ts`.
- Mutation check by hand, reverted: adding `import type … from "./actions"` to
  `new-area.tsx` failed three tests.

**What still blocks `output: 'export'`** (pinned in the same test, so this list fails
when the code changes):

1. **Route handlers that read the request**: `app/garden/export/route.ts`,
   `app/garden/history/route.ts`. Unused in browser mode. (`app/api/health/route.ts`
   reads nothing; it is for the hosted app.)
2. **The proxy**: `src/proxy.ts` (session refresh and `Cache-Control: private, no-store`).
3. **Server actions**: `app/garden/actions.ts`, `app/garden/import/actions.ts`,
   `app/garden/returns-lookup.ts`, `lib/garden/store/server-loader.ts`. Unreachable from
   the browser entry, but imported by the server pages' provider.
4. **Server pages**: `app/garden/page.tsx`, `app/garden/import/page.tsx`,
   `app/login/page.tsx`, `app/page.tsx` are `force-dynamic`, import the cookie-reading
   server client and call `redirect()`; the two garden pages also read `searchParams`
   on the server. `app/dev/axe-fixtures/page.tsx` is `force-dynamic` and reads
   `searchParams`. A static build needs its own page files that render
   `<BrowserStoreProvider><BrowserGarden /></BrowserStoreProvider>` (and the import and
   login equivalents) and nothing else; the client entry already reads the garden from
   `useSearchParams()` and is wrapped in `Suspense`.
5. **`headers()` in `next.config.ts`**: the CSP and security headers are not applied by
   a static host or the app shell; they move to a `<meta>` CSP (ADR-009 item 7).
6. **The landing page** (`app/page.tsx`) reads `GARDEN_AI_ENABLED` and the session on
   the server. ADR-009 leaves it out of the app build.
7. **Deployment flags**: `StoreBoundary` reads `GARDEN_AI_ENABLED` and
   `GARDEN_DELETION_ENABLED` on the server. A static build passes none and the database
   decides alone (`garden_capabilities()`), which the store already supports.
8. **Dynamic route segments: none.** Selection is in search parameters.
9. Not blockers but not exported: `/dev/axe-fixtures`, `/garden/meadow-preview`,
   `/garden/returns-preview`.

## Tests

From `applications/web`, 2026-11-16:

- `npx tsc --noEmit`: exit 0. `npx eslint` (whole project): exit 0.
- `npx vitest run`, three consecutive runs: 44 files, 335 tests, all passing each time
  (was 41 files, 293 tests before this stage; the count includes other teams' tests).
- `npm run test:node`: 88 passing (run once).
- Component tests (`new-area`, `first-run`, `tending-settings`, `import-form`,
  `delete-control`, `workspace`, `delete-workspace`) now supply a store through
  `GardenStoreProvider` (`renderWith(storeOf({...}))`). Their assertions are unchanged.
- `app/garden/journeys.test.tsx` (24 tests): the same steps and the same expectations,
  once in server mode (the server pages' render, the default provider, the real actions
  and route handlers over a mocked server client, refresh re-running the loader) and
  once in browser mode (`BrowserGarden` / `BrowserImport` over the real
  `createBrowserStore`), both over the in-memory fake: first run with a seed pack; write
  and revise an entry and read its history; archive and restore; keep a bloom; topic
  tending and the overnight preference; import; export (bytes compared with the route
  handler); delete an entry with the flag on, and no delete control with it off; sign
  out. Browser only: loading, signed out then signed in with a code, read failure and
  retry, first run for an empty account, sign out everywhere. **The fake checks nothing
  a database checks.**
- `app/login/login-form.test.tsx` (5), `static-readiness.test.ts` (13),
  `boundaries.test.ts` (now also covers `browser-provider.tsx`).
- Accessibility (`applications/web/accessibility`, `AXE_BASE`, receipts written to the
  scratch directory, not to `documents/`): server mode against the running fixture
  server on :3147, full run: `PASS: axe-check complete`, 192 touch-viewport state runs,
  0 serious or critical. Browser mode: see "Accessibility in browser mode" below.

## Real run against a local Supabase stack

Setup, all local and isolated:

- A copy of `supabase/` in the scratch directory with `project_id = "slow-garden-stage2"`
  and its ports moved to 5642x, started with `npx supabase start --workdir … -x
  studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta`.
  **The two stacks already running (`slow-garden`, `slow-garden-web-thinking`) were not
  touched, reset or connected to.** All committed and uncommitted migrations in the tree
  at that moment applied cleanly, through `20261116041903_browser_path_rules.sql`.
- Two changes in that copy only: `auth.rate_limit.email_sent` raised from 2 to 20 an
  hour so one run could send four codes, and
  `update private.deployment_switches set deletion_enabled = true`. During the run the
  script also aged its own session with one `update auth.sessions` to reach the
  ten-minute rule. None of this exists outside the scratch stack.
- Two copies of `applications/web` (source of this change, without `.env.local`) served
  by `next dev`, because Next 16 refuses a second dev server in one directory: server
  mode on :3151, `NEXT_PUBLIC_GARDEN_STORE=browser` on :3152, both with the local
  stack's URL and publishable key and `GARDEN_DELETION_ENABLED=true`. The running
  server on :3147 (which reads `.env.local`) was never signed in to.
- Chromium through Playwright, 1280x900, one synthetic account per run, deleted by the
  run itself. The code was read from the local inbox (Mailpit) by its six digits only.

Transcript, browser mode (statuses and request shapes only; identifiers and query values
removed; "garden read" stands for the eleven reads plus `rpc/garden_capabilities` that
`loadGarden` makes, all 200):

```
# browser mode, 2026-11-16T06:18Z, app :3152, isolated local Supabase
PASS visit /garden with no session: sign-in screen shown at /garden
     app GET /garden -> 200
PASS sign in with an emailed six-digit code: first-run page at /garden
     supabase POST /auth/v1/otp -> 200, POST /auth/v1/verify -> 200, GET /auth/v1/.well-known/jwks.json -> 200, garden read
     cookies: sb-…-auth-token and three …-code-verifier cookies, all script-readable; storage keys: draft store only
PASS first run with a seed pack: thought page shown; 1 garden, 4 topics, 1 thought, 1 revision
     supabase POST /rest/v1/gardens -> 201, 4x POST /rest/v1/plots -> 201, POST /rest/v1/seeds -> 201,
     POST /rest/v1/rpc/save_entry -> 200, 7 replay reads -> 200, 2 garden reads
PASS write a second entry: 2 saved              POST rpc/save_entry -> 200, garden read
PASS revise it and read its history: 2 revisions POST rpc/save_entry -> 200, GET /rest/v1/seed_revisions -> 200, garden read
PASS archive an entry, restore it from Archive   2x PATCH /rest/v1/entries -> 200, garden reads
PASS topic tending and overnight preference      PATCH /rest/v1/plots -> 200, PATCH /rest/v1/accounts -> 204, garden reads
PASS export, four links: Markdown byte-identical to the route handler; JSON identical except exported_at; names equal
     4x supabase POST /rest/v1/rpc/export_garden_sources -> 200 and the tending reads; no request to the app for the download
PASS import a Markdown file: 2 entries added, dated 2024-03-05 and 2024-03-06   POST rpc/import_thought -> 200
PASS reload: the session persists                app GET /garden -> 200, garden read
PASS token refresh from the browser              supabase POST /auth/v1/token?grant_type -> 200; token rotated; the write succeeded
PASS delete an entry permanently: entries 4 -> 3 POST rpc/deletion_preview -> 200, POST rpc/delete_entry -> 200
PASS sign out everywhere: at /login, 0 auth cookies, 0 sessions   supabase POST /auth/v1/logout?scope -> 204
PASS visit /garden signed out again: sign-in screen at /garden, no garden content
PASS sign in again: garden shown, requested location kept
PASS delete the account: refused first (rpc/delete_account -> 400), code sent and verified in the dialog,
     then rpc/delete_account -> 200; users 0, gardens 0, entries 0; /account/deleted; 0 auth cookies
     (final local sign-out -> 403, expected: the identity is gone)
console errors: the two expected ones above (400, 403); no CSP violation
```

Server mode, same script and stack, on :3151: all 16 steps passed; every write was a
`POST /garden… [server action] -> 200`, history was `GET /garden/history -> 200`, the
exports were `GET /garden/export… -> 200`, no request went from the page to
`/rest/v1`, and there were no console errors. Its token refresh happened on the server
(none from the browser), as today.

What this run shows that the fake could not: RLS, the triggers, `save_entry`,
`import_thought`, `garden_capabilities`, the deletion RPCs and the auth service accept
the browser path's requests with the person's own session and the publishable key, and
the app's CSP allows them.

### Accessibility in browser mode

The fixture page can be driven in browser mode: it renders the same workspace with the
browser store injected. What the run does not cover: the browser entry's
own loading, signed-out and error states are the existing `loading.tsx`, the sign-in
screen and `error.tsx`, which the script checks as the `loading`, `login` and `error`
states; they were not checked as rendered under `/garden` specifically.

Result, browser mode on :3152, full run, light and dark, four viewports: `PASS: axe-check
complete`, 192 touch-viewport state runs, 0 serious or critical violations, no overflow,
no small target, no contrast failure. Same result as server mode.

## Not verified

- **The hosted project and Vercel**: nothing was touched or read. The five pending
  20261116 migrations are still unapplied there, so browser mode must not be switched
  on for the hosted app yet (checklist step 8 of the stage 1 record still stands).
- **A static export build, and Capacitor**: not built. The readiness test is a source
  check. Tree-shaking of the server store out of a browser-mode *hosted* build is still
  unverified (the hosted pages import both providers).
- **Browsers**: Chromium only, desktop viewport, `next dev` (development build), HTTP on
  localhost. Not Safari, not iOS, not a production build, not HTTPS cookie behaviour.
- **Tending in browser mode end to end**: `requestPass`, `cancelPass`, `respondToBloom`
  and `respondToMark` ran only against the fake (the local stack has no tended pass and
  the runtime is off). Their database rules are covered by pgTAP, not by this run.
- **Two-user negative tests through the browser** (one account reading another's rows)
  were not run here; pgTAP and the PostgREST transcript in the rules record cover RLS.
- **Token refresh on a real one-hour expiry**, a revoked session while the page is
  open, sign-out in another tab, and offline behaviour.
- **Session cookies when the proxy and the browser client both refresh** on the hosted
  app in browser mode (rotation has a 10 second reuse window; no problem was seen in
  the local run, where both were active).
- Email delivery beyond the local inbox; the hosted rate limit of 2 emails an hour was
  raised locally for the run.
- Other teams' uncommitted changes in the tree were present during every check; the
  migration `20261116061751_tending_followups.sql` appeared after the local stack was
  built and is not in it.

## Needed in files this work did not own

- `documents/DECISION_LOG.md`: record (a) server mode keeps `revalidatePath` and
  `router.refresh()`; client-owned data is browser mode only (departure from checklist
  step 7), (b) browser mode keeps the session in the same script-readable cookies as
  server mode, with the trade-off above, (c) a signed-out visit in browser mode shows
  sign-in in place and returns to the requested location.
- `documents/operations/README.md`: link this record.
- `applications/web/accessibility/README.md`: note that `AXE_BASE` can point at a
  browser-mode fixture server.
- `next.config.ts` (later, not now): the conditional `output: 'export'` and a `<meta>`
  CSP, once the static page files exist; and a nonce-based `script-src`.
- `supabase/config.toml`: nothing needed. Hosted: apply the pending migrations before
  step 8.

## Next

1. Static page files for the app build (blocker 4) and the conditional export target;
   run the journeys against the exported bundle.
2. An auth-change subscription in the store (sign-out in another tab, expiry) and the
   Keychain storage adapter spike (ADR-009 item 1).
3. Apply the pending migrations to the hosted project, then turn browser mode on there
   for the owner behind the flag; rollback is unsetting the variable.
4. After that has run for the owner: delete the server actions, the two route handlers
   and the server store (stage 1 record, step 13).

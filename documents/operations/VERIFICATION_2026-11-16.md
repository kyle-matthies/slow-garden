# Verification run, 2026-11-16: production build, real local stack, real browser

- Date: 2026-11-16, 07:20 to 08:45 UTC.
- Purpose: run for real the checks listed under "Not verified" in
  [DELIVERY_2026-11-16.md](DELIVERY_2026-11-16.md) and
  [CLIENT_DATA_LAYER_STAGE2_2026-11-16.md](CLIENT_DATA_LAYER_STAGE2_2026-11-16.md),
  fix what was wrong in the scripts or the app, and record what happened.
- Nothing hosted was read or written. No git command was run by hand
  (`perf-check.mjs` itself calls `git rev-parse` and `git status`; it was run from a
  scratch copy that is not a repository, so both failed harmlessly and its receipts say
  `commit: unknown`). `workspace-guard` does not exist on this machine and was not run.
- Everything below is synthetic (`…@example.test` identities, invented text). The
  transcripts contain journey names, counts and statuses only.

## Result in one paragraph

Every check named in the task ran and, after the fixes listed under "Defects", passed:
the production build in both store modes; `test-local-http.mjs`; fourteen browser
journeys in four configurations (server store and browser store, each at 1440x900 and
at the iPhone 14 profile), including deleting an entry, a thought, a topic, a garden
and the account with the re-sign-in step; two-account isolation through the browser
and by direct API calls; `perf-check.mjs` inside every ADR-007 budget; `axe-check.mjs`
and `growth-check.mjs` against the production build. One real app defect was found and
fixed (a notice that vanished), five script faults were fixed, and three observations
are recorded for an owner's decision, the first of them a security trade-off.

## Environment

| Item | Value |
|---|---|
| Host | Linux 6.18.44 container, 4 vCPU, 15 GB, no GPU |
| Node | v22.23.4 |
| Next.js | 16.4.3 (Turbopack), `next build` then `next start` |
| `@supabase/supabase-js` / `@supabase/ssr` | 2.113.0 / 0.12.5 |
| Supabase CLI | 3.1.0 (`npx supabase`); CI pins 2.109.1 |
| Docker | 29.9.2 |
| Postgres image | `supabase/postgres:17.11.0.018` (PostgreSQL 17.11) |
| Auth / REST / gateway / inbox | `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v16.5`, `kong:2.8.1`, `axllent/mailpit:v1.31.3` |
| Browser | Chromium 153.0.8010.12 (Playwright's build 1243, preinstalled), headless |
| Playwright library | `@playwright/test` 1.62.1 from `applications/web/accessibility`, driving that Chromium through `AXE_CHROMIUM` (its own build 1234 is not installed and cannot be downloaded here) |

### The isolated stack

A reviewer was using the default `slow-garden` stack, so none of this touched it.

- `supabase/` was copied to a scratch directory; in the copy `project_id` became
  `slow-garden-qa` and every `5432x` port became `5662x` (API 56621, database 56622,
  inbox 56624). Started with
  `npx supabase start --workdir . -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta`.
  All thirteen migrations present at 07:22 UTC applied cleanly, through
  `20261116061751_tending_followups.sql`.
- Changes in the copy only: `auth.rate_limit` `email_sent` 2 → 2000,
  `sign_in_sign_ups` and `token_verifications` 30 → 2000, `token_refresh` 150 → 5000,
  `auth.email.max_frequency` 60s → 1s (one run sends about 25 codes, several to the same
  address), and `update private.deployment_switches set deletion_enabled = true`.
- During the journeys the script ran two kinds of statement in that database through
  `docker exec`: one `update auth.sessions set created_at = now() - interval '11 minutes'`
  per deletion journey (its own identity, to reach the ten-minute rule), and one
  transaction per two-account journey that inserts a finished pass, one bloom and one
  mark for account A with triggers skipped (`session_replication_role = replica`),
  because the tending runtime is off locally and neither API role may write those tables.
- The stack was stopped with `npx supabase stop --workdir . --no-backup` at the end; no
  `slow-garden-qa` container or volume remains. The `next dev` server on :3147 and the
  `slow-garden` database container were never signed in to, stopped or reset.
- **Not in the stack:** `20261116080454_tending_lock_and_cycle_fixes.sql` appeared in
  `supabase/migrations/` (another team's work) after the stack was built. Nothing here
  exercised it.

### The builds

`next dev` was running in `applications/web`, so the builds were made in two scratch
copies of `applications/web` (no `.env.local`, `node_modules` hard-linked). Next 16
keeps `next dev` output in `.next/dev`, so a build in place would also have been safe;
the copies were used because the store mode and the Supabase URL are compiled in.

    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56621 \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable key> \
    GARDEN_AI_ENABLED=false GARDEN_DELETION_ENABLED=true \
    npm run build                                   # server store, served on :3148
    NEXT_PUBLIC_GARDEN_STORE=browser npm run build  # browser store, served on :3162

Both were rebuilt once after the app fix below; every result in this record is from the
rebuilt output unless it says otherwise.

## 1. Production build

Both builds: exit 0, **no warnings**, "Compiled successfully" in 5.3 to 5.6 s, TypeScript
7.1 s, 10 static pages, about 14 s wall. Routes, identical in both modes:

    ƒ /   ○ /_not-found   ○ /account/deleted   ƒ /api/health   ƒ /dev/axe-fixtures
    ƒ /garden   ƒ /garden/export   ƒ /garden/history   ƒ /garden/import
    ○ /garden/meadow-preview   ○ /garden/returns-preview   ○ /icon.svg   ƒ /login
    ƒ Proxy (Middleware)

Next 16 with Turbopack no longer prints a size per route, so sizes were measured.
On disk (`.next/static`): server store 1,792,748 bytes in 55 files (JavaScript
1,342,635 in 28 files, CSS 149,980 in 9); browser store 1,748,414 bytes in 50 files
(JavaScript 1,298,301 in 23 files, CSS 149,980 in 9). `.next` is 86 MB and 82 MB.

Transferred on a cold load in Chromium at 1440x900 (compressed bytes; "unpacked" is the
decoded size). Fonts are 3 files, 88.9 KB, on every page.

| Build | Route | JavaScript | CSS | Document |
|---|---|---|---|---|
| server | `/` (landing, signed out) | 9 files, 140.9 KB (460.5 KB unpacked) | 11.9 KB | 8.7 KB |
| server | `/login` | 11 files, 215.9 KB (735.2 KB) | 8.6 KB | 5.3 KB |
| server | `/account/deleted` | 9 files, 138.8 KB (454.4 KB) | 9.2 KB | 3.8 KB |
| server | not found | 8 files, 135.3 KB (446.7 KB) | 8.6 KB | 3.6 KB |
| server | garden workspace (fixture page, Pages) | 14 files, 324.9 KB (1,069.7 KB) | 33.1 KB | 10.3 KB |
| server | garden workspace (fixture page, Meadow) | 14 files, 324.9 KB | 33.1 KB | 8.9 KB |
| server | import (fixture page) | 14 files, 324.9 KB | 33.1 KB | 5.2 KB |
| server | first run (fixture page) | 14 files, 324.9 KB | 33.1 KB | **28.4 KB (174.7 KB unpacked)** |
| browser | `/` | 8 files, 140.3 KB (460.3 KB) | 11.9 KB | 8.7 KB |
| browser | `/login` | 9 files, 214.0 KB (733.2 KB) | 8.6 KB | 5.3 KB |
| browser | `/garden` (signed out: sign-in screen in place) | 13 files, 325.9 KB (1,075.1 KB) | 33.1 KB | 4.6 KB |
| browser | `/garden/import` (signed out) | 13 files, 325.9 KB | 33.1 KB | 4.7 KB |
| browser | garden workspace (fixture page, Pages) | 13 files, 322.8 KB (1,066.1 KB) | 33.1 KB | 10.3 KB |

Notes. A signed-in `/garden` in server mode was not measured separately; the fixture
page renders the same workspace. In browser mode `/garden` ships the whole workspace
to a signed-out visitor (it has to: there is no server check), 110 KB more JavaScript
than `/login`. The browser-store build is 44 KB of JavaScript smaller on disk than the
server-store build, so the server wiring is at least partly left out of it; a
chunk-by-chunk check was not done. The first-run document is 175 KB of HTML unpacked.

## 2. `scripts/test-local-http.mjs`

    GARDEN_TEST_STATUS=<scratch>/status.json GARDEN_TEST_API_URL=http://127.0.0.1:56621 \
      node scripts/test-local-http.mjs                                   # server build, :3148
    GARDEN_TEST_BASE=http://localhost:3162 …same… node scripts/test-local-http.mjs   # browser build

Both, on the rebuilt output:

    PASS: expired access token refreshed and replacement cookies preserved through login redirect
    PASS: OTP single-use; private source exports/history; anonymous denial; local and global session scopes.

The first attempt failed at `value.revisions`: the script predated export document v2.
See "Script faults". Guard checked: with no environment the script refuses to run
(no `.local-runtime/status.json`), and naming the default stack on :54321 gives
`Only the dedicated local test stack is permitted.`

## 3. `scripts/test-web-journeys.mjs`

Rewritten (see "Script faults"). One command per configuration; `<store>` also selects
the server (`:3148` server build, `:3162` browser build):

    AXE_CHROMIUM=/opt/pw-browsers/chromium GARDEN_DELETION_ENABLED=true \
    GARDEN_TEST_STATUS=<scratch>/status.json GARDEN_TEST_API_URL=http://127.0.0.1:56621 \
    GARDEN_TEST_DB_CONTAINER=supabase_db_slow-garden-qa \
    GARDEN_TEST_BASE=http://localhost:<3148|3162> GARDEN_TEST_STORE=<server|browser> \
    GARDEN_TEST_DEVICE=<desktop|phone> node scripts/test-web-journeys.mjs

Sign-in everywhere is the real form with the six-digit code read from the local inbox
(Mailpit), never an admin-minted token. Fixture rows are written through the person's
own session. "Phone" is Playwright's `devices['iPhone 14']` metrics (390x664 viewport,
device scale factor 3, touch, mobile user agent) **in Chromium, not WebKit**.

| Journey | server · 1440x900 | server · iPhone 14 | browser · 1440x900 | browser · iPhone 14 |
|---|---|---|---|---|
| sign-in | pass | pass | pass | pass |
| first-run-own | pass | pass | pass | pass |
| first-run-pack | pass | pass | pass | pass |
| write-revise | pass | pass | pass | pass |
| archive-restore | pass | pass | pass | pass |
| timeline-search | pass | pass | pass | pass |
| import | pass | pass | pass | pass |
| export | pass | pass | pass | pass |
| returns-settings | pass | pass | pass | pass |
| gardens-topics | pass | pass | pass | pass |
| phone-tab-bar | not applicable | pass | not applicable | pass |
| keyboard | pass | not applicable | pass | not applicable |
| sign-out | pass | pass | pass | pass |
| deletion | pass | pass | pass | pass |
| two-accounts | pass | pass | pass | pass |
| Total | 14 pass, 0 fail | 14 pass, 0 fail | 14 pass, 0 fail | 14 pass, 0 fail |

`deletion-off` ran once, server store at 1440x900, against the same build started with
`GARDEN_DELETION_ENABLED=false` on :3163: pass (no delete control on an entry, a
thought, a topic or in settings). It was not run in browser mode or at phone size.

Transcript of one configuration (browser store, iPhone 14); the other three differ only
in the lines marked server store below:

    # web journeys · store=browser · device=phone (390x664) · deletion=on · http://localhost:3162
    # chromium 153.0.8010.12 · node v22.23.4
      ok   signed out, /garden shows only the sign-in screen
      ok   a wrong code is refused
      ok   the emailed six-digit code from the local inbox opens the garden
      ok   / and /login send a signed-in person to the garden
      ok   the session persists into a new browser context
    PASS sign-in
         console errors: 1 (403 from the auth service: the wrong code, expected)
      ok   a seed pack opens and closes without a write
      ok   plant your own: 1 garden, 1 topic, 1 thought, 1 entry saved
    PASS first-run-own
      ok   seed pack: 2 topics planted (2 kept from the pack, 1 left out), 1 thought, 1 entry
      ok   Pages shows every planted topic
    PASS first-run-pack
      ok   an entry is saved and dated
      ok   revising keeps both versions: 1 entry, 2 revisions, history lists both
      ok   a second entry is saved with Ctrl+Enter and listed newest first
      ok   an unsaved draft is recovered after leaving the page
      ok   Continue writing opens the most recent thought
    PASS write-revise
      ok   an entry is archived, found in Archive, and restored
      ok   a thought is archived and restored with its entries
      ok   a topic is archived (children held read-only) and restored
    PASS archive-restore
      ok   search finds entry text and thought titles, says when nothing matches, and opens the entry
      ok   the timeline lists saved entries by day and opens one
    PASS timeline-search
      ok   a Markdown file becomes 1 thought with 2 entries dated from its headings
      ok   the imported thought appears in its topic
    PASS import
      ok   four exports download: JSON v2 and Markdown, whole account (2 gardens) and this garden (1), source bytes exact, user and AI-derived sections separate
    PASS export          (server store adds: the export route answers 200 with no-store)
      ok   Returns: nothing fabricated, tending inactive, no way to start a pass
      ok   settings: overnight preference and time zone save and start no pass
      ok   topic settings: Tending on is saved for one topic and starts nothing
    PASS returns-settings
      ok   New garden opens with its name field focused; cancel creates nothing
      ok   a third garden is created and entered
      ok   a topic and a thought are created from Pages
      ok   the ring switches gardens
      ok   a stale location falls back to its nearest parent and says so
      ok   the remembered view (Pages, then Meadow) is the one a plain address opens
    PASS gardens-topics
      ok   tab bar at the bottom, 44px targets, Write lands with the caret on a page
      ok   More opens upward as a sheet and closes
      ok   no sideways scroll in Meadow, Returns, All gardens, Timeline or Archive
    PASS phone-tab-bar
    SKIP keyboard (not applicable to this configuration)
      ok   device sign-out: back at sign-in, no session cookie, no garden behind it
      ok   sign out on all devices: the copied refresh token and access token are refused by the auth service
      note copied cookies replayed after sign out everywhere: the garden was still shown (access token valid until it expires)
    PASS sign-out
    SKIP deletion-off (not applicable to this configuration)
      ok   entry: cancel keeps 3; confirm erases 1 entry and its version (3 -> 2)
      ok   thought: erased with its 2 entries; the page moves to its topic
      ok   topic: needs its exact name typed; erased with its thought (2 topics -> 1)
      ok   garden: export offered first, typed name, erased (2 gardens -> 1); the other garden opens
      ok   account: Escape cancels; nothing erased
      ok   account: an older sign-in is refused, nothing erased; the code sent inside the dialog signs in again
      ok   account: erased after re-sign-in; 0 gardens, no account row, no identity, no cookie
    PASS deletion
         console errors: 2 (400 from rpc/delete_account: the refused first attempt; 403: the final sign-out of an identity that no longer exists; both expected. Server store: 0)
      …two-accounts, below…
    PASS: 14 passed, 0 failed, 2 skipped · store=browser device=phone deletion=on

Counts in the transcript are read from the database with the service role after each
step, not from the page. No horizontal overflow was found at either size on first run,
Pages, a thought, the timeline, import preview, Returns, settings, the ring or the
Meadow.

## 4. Two-account isolation

The `two-accounts` journey, in all four configurations (the task asked for browser
mode; server mode ran the same steps with its own route checks). Account A's names and
writing carry a word that appears nowhere in B's; A also has a finished pass, a bloom
and a mark.

    ok   direct API as B: 19 reads return only B's rows; A's rows by id return nothing; B's export is B's only
    ok   direct API as B: 28 writes and deletions against A's ids refused or without effect; A's 11 rows unchanged; no-session reads return nothing
    ok   as B in the browser: 10 of A's addresses and a search for A's word show nothing of A
    ok   browser store as B: the export built in the page has none of A's words
    ok   from B's page (same origin, CSP allowed): A's ids answer 200 with 0 rows
    ok   no response received in B's session contained A's word
    ok   one tab, A then B: B sees none of A's gardens, thought, bloom or unsaved draft, also by A's addresses and by Back
    ok   back as A in the same tab: A's garden, none of B's; the draft A left was cleared at sign-out, as the confirmation says
    PASS two-accounts

Server store replaces lines four and five with
`server routes as B: export of A's garden 404, history of A's entry empty, B's export has none of A's words`.

What "19 reads" and "28 writes" were, with B's own session and the publishable key
against PostgREST:

- Reads: every row of `gardens`, `plots`, `seeds`, `entries`, `seed_revisions`,
  `current_entries`, `garden_passes`, `blooms`, `bloom_responses`, `tending_marks`,
  `tending_mark_responses` and `accounts` is B's; A's garden, topic, thought, entry,
  revision, pass, bloom and mark selected by id return zero rows; A's revisions by
  entry id return zero rows; `export_garden_sources()` holds only B's.
- Writes and deletions. Each had to come back as an error or as zero rows changed
  (the script accepts either and then compares A's rows); the answers that were
  printed in a debug run are given, the rest were not individually recorded:

  | Attempt against A's ids | Answer |
  |---|---|
  | insert a topic into A's garden (as B, and claiming A's tenant id); a thought into A's topic; a garden for A | error or no row (not individually recorded) |
  | rename A's garden, topic, thought; archive A's entry; delete A's garden row | error or 0 rows (not individually recorded) |
  | delete A's revision row | `42501` |
  | `save_entry` into A's thought; revising A's entry; revising A's entry through B's own thought | `42501` each |
  | `import_thought` into A's topic | `22023` |
  | request a pass on A's garden; the same claiming A's tenant id | `55000`; `42501` |
  | cancel A's pass | 0 rows |
  | respond to A's bloom; respond to A's mark | error or no row (not individually recorded) |
  | `deletion_preview` of A's entry, thought, topic, garden | answers, with zero counts |
  | `delete_entry`, `delete_seed`, `delete_plot`, `delete_garden` on A's ids (with A's exact names) | `{deleted:false}` |
  | `delete_account` typing A's email | `22023`; B's account intact |

  Afterwards all 11 of A's rows were compared with a snapshot taken before: identical.
- With no session at all, `gardens`, `seed_revisions` and `blooms` return nothing.
- In the browser as B: A's garden in Pages and Meadow, A's topic, A's thought (also
  under B's own garden id), A's timeline, Returns, Archive, ring and import page. Every
  JSON, text, HTML and RSC response in B's session was read and none contained A's word.
- One tab: A signs in, opens the thought, leaves an unsaved draft, opens Returns (the
  bloom is shown to A), signs out; B signs in in the same tab. B's pages, A's former
  addresses and eight presses of Back show nothing of A. A then signs back in and sees
  A's garden and none of B's.

**Result: no cross-account read or write was found, in either store mode.**

## 5. `accessibility/perf-check.mjs` against ADR-007

Run as documented (`npm run build`, then the script, which serves the production build
itself on :3212 with fixtures), from the scratch copies, on an otherwise idle machine:

    AXE_CHROMIUM=/opt/pw-browsers/chromium PERF_RECEIPTS=<scratch>/perf PERF_RUN=<name> node perf-check.mjs

Profiles are the script's: 1280x800 at 1x CPU with a mouse, and 390x844 at device scale
factor 2 with touch and 4x CPU throttle. Each cell is the p95 main-thread frame cost in
ms over a 10 s drag; three runs: server build before the app fix, server build after,
browser build after.

| Budget (ADR-007) | Fixture | server, run 1 | server, run 2 | browser | Verdict |
|---|---|---|---|---|---|
| p95 ≤ 20 ms at 1280 | 100 thoughts | 11.1 | 10.1 | 9.6 | met |
| p95 ≤ 20 ms at 1280 | 1,000 thoughts | 14.4 | 15.2 | 11.8 | met |
| p95 ≤ 20 ms at 1280 | ring of 24 gardens | 4.1 | 4.1 | 4.1 | met |
| p95 ≤ 33 ms at 390, 4x CPU | 100 thoughts | 26.2 | 27.7 | 28.8 | met |
| p95 ≤ 33 ms at 390, 4x CPU | 1,000 thoughts | 27.7 | 29.1 | **30.1** | met, 3 to 5 ms spare |
| p95 ≤ 33 ms at 390, 4x CPU | ring of 24 gardens | 17.1 | 16.0 | 15.5 | met |
| images ≤ 350 KB on phone before interaction | all three | 0 KB | 0 KB | 0 KB | met (no image file is requested; the scene is drawn) |
| about 24 interactive plants per bed, 14 at ≤ 480 px | 100 / 1,000 thoughts | 50 / 72 at 1280; 42 / 42 at 390 | same | same | consistent with three beds on screen (3x24, 3x14); not counted per bed by the script |

All three runs ended `PASS: perf-check complete`. Other numbers from the same runs, none
of them budgeted:

- Median frame cost: 6.0 to 8.3 ms at 1280; 14.1 to 15.0 ms at 390 (meadow), 8 to 9 ms (ring).
- Canvas rasterisation share: 0 % in every row, so nothing was excluded from the budget.
- Worst single frame at 390 under 4x: 62 to 92 ms (meadow), 64 to 83 ms (ring); 5 to 10
  long tasks per 10 s drag on the meadow at 390, none at 1280.
- `requestAnimationFrame` interval at 1280 on the meadow: median 33.3 ms, p95 33.5 to
  66.7 ms, that is about 30 frames a second in this GPU-less container even though the
  main thread is busy only 6 to 8 ms a frame. The ring holds 16.7 ms. This is the
  environment-bound figure ADR-007 warns about; it says nothing certain about a phone.
- **Main thread while the meadow sits still:** 14 to 18 % busy at 1280, and **85 to 96 %
  busy at 390 under 4x throttle** (0.1 to 0.2 % with reduced motion; the ring idles at
  0.1 to 0.3 %). The script records this "as a check that the atmosphere idles". It does
  not idle: at a quarter of this machine's speed the resting meadow uses nearly the whole
  main thread. See observation 2.
- Transfer for the fixture garden route: JavaScript 325 KB (server) / 323 KB (browser),
  CSS 33 KB, document 20 KB (100 thoughts), 98 KB (1,000 thoughts), 78 KB (24 gardens).

No budget failed, so nothing was changed in the scene.

## 6. `axe-check.mjs` and `growth-check.mjs` against the production build

axe, against `next start` with `GARDEN_AXE_FIXTURES=1` and no Supabase variables:

    AXE_BASE=http://localhost:<3171|3172> AXE_CHROMIUM=/opt/pw-browsers/chromium \
      AXE_RECEIPTS=<scratch>/axe-<mode> node axe-check.mjs

| Build | Result | Detail |
|---|---|---|
| server store | `PASS: axe-check complete` (8 min 6 s) | 248 state runs (31 states x light and dark x 360x740, 390x844, 844x390, 1280x800): 0 serious or critical, 0 moderate or minor. 186 touch-viewport runs with every control at least 44x44 and no overflow. 174 contrast rows, all AA. `SKIP cabinet`. |
| browser store | `PASS: axe-check complete` (8 min 8 s) | Same counts, with one run (`morning-reveal`, dark, 844x390) reporting two moderate findings (`landmark-one-main`, `page-has-heading-one`). That state and viewport were rerun three times: 0 findings each time. Treated as a page caught mid-load, not reproduced. |

The first run on the server build ended `FAIL (8)`; all eight were the development-only
`cabinet` state. See "Script faults".

growth, which serves the production build itself on :3214:

    GROWTH_RECEIPTS=<scratch>/growth-<mode> node growth-check.mjs                                  # server build
    NEXT_PUBLIC_GARDEN_STORE=browser GROWTH_RECEIPTS=… node growth-check.mjs                       # browser build

Both: `{"ok":true,"profiles":8}` (360x740, 390x844, 844x390 touch and 1280x844, light
and dark), 33 screenshots each. The browser build failed twice before the script was
corrected (it counted server actions, which that build does not send).

## 7. Also run

- `npm test` (Vitest) after the app fix: 45 files, 361 tests, pass. ESLint on the two
  changed app files and `tsc --noEmit`: clean.
- Database tests against the scratch stack, as CI does (`supabase test db --local
  supabase/tests`): 14 files, **865 tests, pass**, with the deletion switch put back to
  its default for that run. With the switch on, `browser_path_rules.sql` fails 16
  assertions that state the default ("deletion ships switched off"); that is the
  scratch setting, not a defect. The newer test files that arrived with
  `20261116080454` were not in the copy.

## Defects

### App defect, fixed: the "location is no longer available" notice vanished

- **Seen as:** `gardens-topics` failed intermittently in browser mode. Opening an address
  whose topic or thought no longer exists showed the parent garden and no explanation.
- **Cause:** `workspace.tsx`, the arrival effect that returns a person to Pages when
  that is their remembered view. For an address with no `view`, it rebuilt the address
  from the topic and thought that were *found*, which removed the ones that were not,
  and the notice is computed from the address. Measured before the fix, sampling every
  250 ms for 3 s: server store, the notice showed for 0.25 to 0.5 s and then went;
  browser store, it showed for at most one sample, usually never. Both store modes,
  only when Pages is the remembered view; with Meadow remembered the notice stayed.
  A deleted thought's old link or bookmark is the ordinary way to arrive there.
- **Fix:** `applications/web/src/app/garden/workspace.tsx`, that one effect: it now adds
  `view=list` (and the garden id when the address has none, as before) to the address
  it was given, instead of rebuilding it. Nothing else changes; a found location
  produces the same address as before.
- **Test:** `workspace.test.tsx`, "arriving with Pages remembered keeps a topic or
  thought that no longer exists in the address, so the notice stays".
- **Verified:** after the rebuild the notice is present in all twelve samples (server)
  and from the first rendered sample on (browser); the journey now waits 1.5 s and
  checks it is still there. Status: fixed, not committed (no git).

### Script faults, fixed

1. `test-local-http.mjs` read `value.revisions` and `value.gardens`; the export has been
   document v2 (`source.*`, `derived.*`) for some time. It now asserts the v2 schema
   and the user/AI split. Its stack and port were constants (:55321, :3148); they are
   now `GARDEN_TEST_STATUS`, `GARDEN_TEST_API_URL`, `GARDEN_TEST_BASE`, loopback only
   and never :54321.
2. `test-web-journeys.mjs` could not start: it loaded Playwright from
   `prototypes/mobile-h1/node_modules`, which does not exist. As written it also
   signed in with an admin-minted token, ran one account through one long sequence at
   one size, clicked a "Slow Garden" link the thought page no longer has, and covered
   neither a seed pack being planted, search, the timeline, import, export, settings,
   nor any deletion beyond one entry. It is now sixteen independent journeys, each with
   its own synthetic account, selectable with `GARDEN_TEST_ONLY`, parameterised by store
   and device, signing in by the emailed code, and checking the database after each step.
3. `axe-check.mjs`, against a production build, checked the not-found page under the
   name `cabinet` and failed eight contrast lookups: `/garden/returns-preview` is
   development-only by design. It now says `SKIP cabinet` when the route is not served
   and leaves `contrast.json` alone on such a run. `accessibility/README.md` says so.
4. `growth-check.mjs` asserted exactly one server action for a failed import; a
   browser-store build sends none. With `NEXT_PUBLIC_GARDEN_STORE=browser` in its
   environment it now expects no server action and at most one import RPC.
5. `README.md` says `test-local-http.mjs` runs "against … a web dev server on port
   3147"; the script has always used :3148. Not fixed here: the root README is outside
   this task's ownership.

### Observations for an owner, not changed

1. **"Sign out on all devices" does not end a session that has already been copied,
   for up to the access token's lifetime.** After it, the auth service refuses the old
   refresh token and the old access token (asserted). But the cookies saved beforehand,
   replayed in a fresh browser, still opened the garden in both store modes: the app
   server checks the token's signature and expiry (`getClaims`), and the data API does
   the same, so neither asks whether the session still exists. The window is the
   access-token lifetime (one hour by default). This is how signed tokens work rather
   than a bug in the code, but the settings text reads as immediate. Options are a
   shorter token lifetime, a session check (`auth.sessions`) in the policies or on the
   server for sensitive reads, or saying "within the hour". Account deletion is not
   affected the same way (the identity and rows are gone). Not small or safe to change
   in a QA pass; recorded here for a decision.
2. **The resting meadow does not idle on a slow phone profile** (section 5: 85 to 96 %
   main-thread busy at 390 under 4x, about 15 % at 1280, near zero with reduced motion).
   No ADR-007 budget covers it, so nothing failed, but it is battery and heat on a real
   phone. It needs a real-device reading before anyone acts.
3. **Returns can contradict itself.** With a finished pass on record and tending now
   inactive for the account, the page says "Last tended <date>" and, in the next line,
   "Tending is not active for this account yet, so no AI has read your writing." Seen
   only with the synthetic pass written into the database for the two-account journey;
   it would also be the state of an account after tending is switched off. Copy only.

Smaller notes: a wrong sign-in code shows the auth service's own sentence ("Token has
expired or is invalid"); during a server-store page load the loading screen and the
garden are briefly both `<main>` elements (streaming), which is the likely source of
the unreproduced axe finding in section 6.

## What could not be run, and why

- **Anything hosted:** the deployed database, RLS and RPCs as deployed, Vercel, real
  email delivery, the hosted rate limits (2 emails an hour, 60 s between codes; the
  journeys need them raised). Out of bounds for this run.
- **Safari, WebKit, a real iPhone, HTTPS.** Chromium only; the "phone" results are a
  Chromium viewport with iPhone 14 metrics. The iOS keyboard and save bar, notch insets,
  `Secure` cookie behaviour and real frame pacing remain unverified. WebKit is not
  installed and cannot be downloaded here.
- **Tending end to end** (requesting, cancelling and receiving a pass, responding to a
  bloom or mark through the page): the runtime is off and there is no provider. The
  journeys assert the inactive state and that nothing starts; B's attempts against A's
  pass, bloom and mark are in section 4.
- **`deletion-off` in browser mode and at phone size**, and a build where the
  environment flag is on but the database switch is off (or the reverse).
- **`scripts/test-upgrade.sh` and `test-upgrade-browser-path-rules.sh`:** they accept
  only the `.local-runtime` stack named `slow-garden-web-thinking`, which was not
  running and was not this task's to start; another session's logs in `.local-runtime`
  were being written during this run.
- **Migration `20261116080454_tending_lock_and_cycle_fixes.sql`** and its tests: added
  after the scratch stack was built.
- **A signed-in `/garden` size in server mode**, a per-chunk comparison of the two
  builds, a static export, and Capacitor.
- **Token refresh on a real one-hour expiry, a session revoked while a page is open,
  sign-out in another tab, offline.** `test-local-http.mjs` covers a forged-expiry
  refresh through the proxy only.
- **Committed receipts.** `perf-check.mjs`, `axe-check.mjs` and `growth-check.mjs` wrote
  to the scratch directory, not to `documents/initiatives/receipts/`, because the runs
  came from uncommitted work in copies outside the repository; the numbers above are
  the record. The scratch directory is not durable.
- Other teams' uncommitted changes were in the tree throughout. The app source in the
  builds was copied at 07:23 UTC and, for `workspace.tsx`, again at 07:45 UTC.

## Files changed by this run

- `scripts/test-web-journeys.mjs` (rewritten), `scripts/test-local-http.mjs`
- `applications/web/accessibility/axe-check.mjs`, `growth-check.mjs`, `README.md`
- `applications/web/src/app/garden/workspace.tsx` (one effect),
  `applications/web/src/app/garden/workspace.test.tsx` (one test)
- this record

`applications/web/tsconfig.tsbuildinfo` was rewritten by `tsc --noEmit`. Nothing under
`supabase/` was edited.

## Follow-ups fixed

Later the same day, a second pass took the three owner observations and the README
note above. Nothing here ran against a Supabase stack, a production build, a hosted
project or a real device; each item says what was and was not checked. Not committed
by this pass (no git).

### 1. Sign out on all devices (observation 1): fixed for this app's server, not for the data API

- **Cause confirmed.** Every server-side check was `auth.getClaims()`, which verifies
  the token's signature and expiry locally and never asks whether the session exists.
- **Change.** `applications/web/src/lib/supabase/session.ts` adds `confirmedSession()`,
  one `auth.getUser()` call. It replaces `getClaims()` in the garden page, the import
  page, `/` and `/login` (so a refused session is not bounced between pages), all
  server actions (`garden/actions.ts`, `import/actions.ts`, `returns-lookup.ts`,
  `store/server-loader.ts`) and the export and history routes. The proxy is unchanged:
  it still refreshes and verifies locally.
- **Why `getUser` is the right call, from source and from this record, not assumed.**
  The installed `@supabase/auth-js` 2.113.0 sends `GET /auth/v1/user` with the session's
  token and maps the server's `session_not_found` to `AuthSessionMissingError`
  (`lib/fetch.js`, `GoTrueClient._getUser`). Section 3's `auth` journey already asserted,
  against the real local auth service, that this endpoint answers 401 or 403 for the
  old access token after a global sign-out. The helper treats any error as signed out,
  so it does not depend on the exact code.
- **Cost.** One auth round trip per request to a garden page, action or route. A token
  refresh in the proxy (about once per token lifetime) is a second call on that request.
  A project that signs tokens with a shared secret (HS256) would also pay a call in the
  proxy, because `getClaims` falls back to `getUser` there; the local stack in this
  record verified locally, so it is asymmetric. If the auth server cannot be reached,
  the request is treated as signed out.
- **What still holds for up to the token lifetime (3600 s in `supabase/config.toml`;
  the hosted value was not read).** The data API accepts the signed token itself. So:
  a copied access token used directly against the data API still reads that account's
  rows under RLS until it expires, in both store modes; and in browser-store mode
  (`NEXT_PUBLIC_GARDEN_STORE=browser`) another browser keeps working until its token
  expires, because that mode never passes through this app's server and the client can
  only verify its own token. Neither can be closed in web code: it needs a session
  check in the database policies (a migration) or a shorter token lifetime (hosted
  configuration). Both were out of bounds here and are left for a decision.
- **Copy.** Settings now says, per store mode, what ends at once and what ends
  "within about an hour" (`workspace.tsx`).
- **Tests.** `src/lib/supabase/session.test.ts` (including the real auth client against
  a stubbed auth server: exactly one request, to `/auth/v1/user`; a 401 or 403 signs the
  request out), two new cases in `store/parity.test.ts` (the server store asks
  `getUser` before every read and write; a session the auth server no longer knows is
  signed out on the page loader and both routes), and a journey for the settings copy
  in both modes. The parity suite now treats the server's `getUser` and the browser's
  `getClaims` as the one deliberate difference between the two paths.
- **Not verified.** The replay itself: copied cookies against a running app and stack
  after a global sign-out. `scripts/test-web-journeys.mjs` still only records that
  replay as a note; in server mode it should now show the sign-in screen and could
  become an assertion. Not run, because no stack was this pass's to start.

### 2. The resting meadow (observation 2): the main thread now rests

- **Cause, measured.** Almost all of it was the atmosphere's `requestAnimationFrame`
  loop redrawing about 3,000 blades of grass and the pollen on two canvases every
  frame. With that loop stopped and everything else left running, the same page
  measured 3.3 % (390, 4x).
- **Change.** `scene/atmosphere.ts` no longer has a loop: it paints the grass once, in
  one fixed mid-gust pose, and requests a frame only while the camera turns or steps
  (one per display frame, however many camera changes arrive). At rest, motion is CSS
  transform and opacity only (`scene.css`): plants sway as before, the near-grass
  canvas leans with the same gust, clouds drift, and pollen or fireflies are small
  elements (`lib/garden/scene/motes.ts`) instead of canvas drawing. Plants and motes
  share a few phases (`GUST_STEPS` in `sway.ts`), because the main thread still wakes
  each time an animation turns over, and one phase per plant kept it awake on most
  frames (a trace showed main frames throughout, down to about a fifth after sharing). `use-scene-awake.ts` pauses every ambient animation while the tab is
  hidden or the scene is off screen; behind the writing page and under reduced motion
  nothing animates.
- **What changed to the eye.** The mid-distance grass no longer ripples; it holds its
  pose. Plants, near grass, clouds and pollen move. Pollen drifts back and forth
  instead of crossing the meadow. Compared by eye from screenshots and computed
  transforms sampled 1.2 s apart at 390x844 and 1440x900 on `?scene=tended` and
  `?scene=hundred`; not watched as video, and not judged by the owner.
- **Measured, dev server (`next dev` on :3147, fixtures), headless Chromium without a
  GPU.** `Performance.getMetrics` `TaskDuration` over a 10 s idle window after
  `Emulation.setCPUThrottlingRate`; 390x844 at scale 2 with touch and 4x throttle, and
  1440x900 unthrottled. These are development-build numbers on this container, not
  the production-build figures of section 5 and not a phone.

  | Scene | Profile | Before | After | Reduced motion (before / after) |
  |---|---|---|---|---|
  | tended | 390, 4x CPU | 82.9 % | 5.1 % | 0 % / 0 % |
  | hundred | 390, 4x CPU | 90.2 % | 5.8 % | 0 % / 0 % |
  | tended | 1440, 1x | 10.4 % | 1.1 % | 0 % / 0 % |
  | hundred | 1440, 1x | 9.9 % | 1.6 % | 0 % / 0 % |

  Script time at rest fell from 6 to 8 % to 0.1 % (390, 4x), and an instrumented
  `requestAnimationFrame` recorded no caller over 5 s at rest. What remains is style
  recalculation when an animation turns over.
- **Checked in a browser.** At rest the three canvases do not change; they redraw
  during a touch drag and settle; plant sway pauses while turning as before; hiding
  the tab pauses all 80 animations and showing it resumes them; no console errors.
- **Not verified.** `accessibility/perf-check.mjs` was not run: it serves a production
  build on :3212, which would have meant building over the tree the shared dev server
  was using. So the ADR-007 drag budgets (section 5) are **not re-measured** after this
  change; the per-frame drawing while dragging is the same code, now scheduled by the
  camera instead of a standing loop, which is a reason to expect no change and not a
  measurement. Also unverified: a real phone, Safari, a GPU, battery or heat, and the
  off-screen pause in a real layout (unit-tested only).

### 3. Returns no longer contradicts itself (observation 3)

- With a finished pass on record and tending inactive, the page now says "Last tended
  <date>" and "Tending is not active now. What was returned before stays here to read,
  and nothing new will arrive until tending is active." When no bloom is showing it
  adds "No bloom is showing. Earlier tending passes are in the full record below." and
  never "no AI has read your writing". The full record's note says the same thing in
  that state. An account that was never tended keeps its existing wording, which is
  true there and is what `test-web-journeys.mjs` asserts.
- Files: `garden/level-returns.tsx`, `garden/returns.tsx`, `garden/level-pages.css`.
  Tests: `garden/level-returns.test.tsx` (four states) and a journey in both store
  modes. Not looked at in a browser: the fixture pages only have the never-tended state.

### 4. README port (script fault 5)

- `README.md` now says `scripts/test-local-http.mjs` uses a web server on port 3148,
  and that `GARDEN_TEST_BASE` changes it, as the script does.

### Checks after these changes

From `applications/web`: `npx tsc --noEmit` clean, `npx eslint .` clean,
`npx vitest run` 50 files, 386 tests, pass. No test was skipped or removed.

### For the decision log (not written by this pass)

Two durable choices were made here and belong in `documents/DECISION_LOG.md`: the
server confirms the session with the auth server on every garden request; and the
resting scene is painted once and animated only by the compositor, which narrows
ADR-007's "canvas atmosphere layer for grass, wind, pollen" to grass and hills.

## Re-verification

- When: 2026-11-16, 09:33 to 10:28 UTC, after the "Follow-ups fixed" changes, D-029,
  D-030 and migration `20261116080454_tending_lock_and_cycle_fixes.sql`.
- Same rules and environment as the first run (Node v22.23.4, Next 16.4.3, Supabase CLI
  3.1.0, `supabase/postgres:17.11.0.018`, Chromium 153.0.8010.12 headless, 4 vCPU, no
  GPU). Nothing hosted, no git, the dev server on :3147 and the `slow-garden` database
  container untouched.
- Stack: `slow-garden-qa` rebuilt from scratch from the current `supabase/` (ports
  5662x, same five rate-limit changes and `deletion_enabled = true` as before). All
  **fourteen** migrations applied, the seven dated 20261116 among them. Stopped with
  `--no-backup` at the end; no container or volume of it remains.
- Builds: fresh copies of `applications/web`, built twice (server store on :3148,
  browser store on :3162), exit 0, no warnings; rebuilt once more after the app fix in
  item 4. Every result below is from the final builds unless it says otherwise.

| Item | Result |
|---|---|
| 1. Cookie replay after "Sign out on all devices", server store | **pass**: refused on page load, server action, export and history. The data API still honours the copied token (read and write) for the rest of its 3600 s |
| 2. `perf-check.mjs` | **fail at 1280**: the 1,000-thought drag missed 20 ms in 3 of 4 runs (19.5 to 21.4 ms); phone budgets met with wide margin; the resting meadow now idles |
| 3. Journeys, HTTP check, axe, growth | **pass** in every configuration |
| 4. Returns and stale-location copy | stale location **reads true**; Returns was **still wrong for a pass that returned nothing**, fixed here |
| 5. pgTAP and upgrade scripts | **pass**: 977 tests in 16 files; the three upgrade scripts pass, run against a renamed scratch stack (see the item) |

### 1. Copied cookies after "Sign out on all devices"

`scripts/test-web-journeys.mjs`, journey `sign-out`; the replay is now asserted instead
of noted. Server store, both sizes:

    ok   server store: a captured server action replays while signed in (200), then is undone
    ok   sign out on all devices: the copied refresh token and access token are refused by the auth service
    ok   copied cookies after sign out everywhere, server store: 3 garden pages show sign-in at /login; the replayed server action (200) changed nothing; export 401, export Markdown 401, history 401
    note data API with the copied access token after sign out everywhere: read answered 1 row(s); write accepted (undone); token lifetime 3600 s, 3597 s left at sign-out

- The cookie jar is copied while signed in, the account signs out on all devices in
  its own browser, and the copy is replayed in a fresh browser context.
- **Page load:** the garden in Pages, a thought page and the import page each land on
  `/login` with the sign-in form and none of the account's writing in the response.
- **Server action:** one real action (archive an entry) is captured from the page and
  replayed with the same headers and body. Replayed while still signed in it archives
  the entry (the control, then undone). Replayed with the copied cookies after the
  sign-out the HTTP answer is still 200, as server actions answer, and the entry is
  not archived (read back with the service role 1.5 s later).
- **Routes:** `/garden/export`, `/garden/export?format=md&garden=…` and
  `/garden/history?entry=…` answer 401.
- **What still works, and for how long.** The copied access token sent straight to the
  data API (PostgREST, publishable key) still read the account's revision and still
  renamed a topic (put back by the script). That holds until the token's `exp`: the
  local lifetime is 3600 s (`jwt_expiry`), and 3597 to 3599 s of it were left at the
  moment of sign-out because the token had just been issued, so the worst case is the
  whole hour. The refresh token is refused, so it cannot be extended. The hosted
  lifetime was not read.
- **Browser store:** unchanged and as D-029 says. The replayed cookies still opened
  the garden (`note browser store, copied cookies replayed … the garden was still shown`).
  The settings sentence for each store mode is asserted and matches what was observed.

### 2. Performance against ADR-007 after the meadow change

`perf-check.mjs` as before (production build served by the script, 1280x800 at 1x with a
mouse, 390x844 at 4x CPU throttle with touch, 10 s drag), alone on the machine. Four
runs: server build three times, browser build once. p95 main-thread frame cost in ms;
"before" is the range of the three runs in section 5.

| Budget | Fixture | Before | server 1 | server 2 | server 3 | browser | Verdict |
|---|---|---|---|---|---|---|---|
| ≤ 20 ms at 1280 | 100 thoughts | 9.6 to 11.1 | **20.1** | 18.3 | 18.9 | 18.0 | missed once, no margin |
| ≤ 20 ms at 1280 | 1,000 thoughts | 11.8 to 15.2 | **21.4** | **21.2** | 19.5 | **20.6** | **missed in 3 of 4** |
| ≤ 20 ms at 1280 | ring of 24 | 4.1 | 4.0 | 3.9 | 4.4 | 4.4 | met |
| ≤ 33 ms at 390, 4x | 100 thoughts | 26.2 to 28.8 | 11.7 | 10.5 | 11.2 | 10.3 | met |
| ≤ 33 ms at 390, 4x | 1,000 thoughts | 27.7 to 30.1 | 10.2 | 12.4 | 10.5 | 11.9 | met, 20 ms spare |
| ≤ 33 ms at 390, 4x | ring of 24 | 15.5 to 17.1 | 14.0 | 17.3 | 17.1 | 17.1 | met |
| images ≤ 350 KB on phone | all | 0 KB | 0 KB | 0 KB | 0 KB | 0 KB | met |

Script verdicts: `FAIL (2)`, `FAIL (1)`, `PASS`, `FAIL (1)`.

Main thread while the meadow sits still, production build (the script's 5 s window):

| Profile | Before | After (four runs) | Reduced motion |
|---|---|---|---|
| 1280, 1x, 100 / 1,000 thoughts | 14.3 to 18.1 % | 1.4 to 1.8 % | 0 % |
| 390, 4x, 100 / 1,000 thoughts | 85.2 to 95.9 % | 5.6 to 7.7 % | 0.1 to 0.2 % |
| ring of 24, either profile | 0.1 to 0.3 % | 0.1 to 0.4 % | 0 to 0.1 % |

So D-030 did what it set out to do: the resting meadow costs about a twelfth of what it
did on both profiles, the phone drag is less than half its former cost (median 5.9 to
7.3 ms, was 14 to 15), and long tasks on the phone meadow went from 5 to 10 per drag to
none. Worst single frame at 390: 19 to 36 ms (was 62 to 92).

**The 1280 drag got slower, and why.** Median frame cost is unchanged (7.2 to 10.5 ms,
was 6.0 to 8.3), but the p95 rose by 6 to 9 ms. `scene/atmosphere.ts` thins the grass
and lowers canvas resolution when drawing or frame pacing is slow (`adapt()`), one step
per 60 drawn frames. While the old loop drew every frame at rest, that had already
happened before anyone touched the meadow. Now nothing draws at rest, so the first drag
starts at full quality and steps down only while the camera moves. Checked with a
scratch copy of the script that drags for 12 s before it starts measuring (1280 only,
two runs each, same build):

| Fixture | no warm-up | after a 12 s warm-up drag |
|---|---|---|
| 100 thoughts | 17.2, 16.6 | 11.3, 11.6 |
| 1,000 thoughts | 18.3, 20.3 | 14.0, 11.7 |

With the warm-up the old numbers come back. So the cost is the first seconds of the
first drag on a machine that needs the lower quality; on this GPU-less container that
is every load. Not fixed here: the remedy is a choice about the scene (decide sooner
than 60 frames, time the one resting paint and start lower, or remember the quality
reached), each of which changes how the meadow looks on first touch, and none was
small and certain. As it stands the ADR-007 desktop budget is **not met** on this
harness, and D-030's "drag budgets not re-measured" is now measured. What a desktop
with a GPU does is still unknown.

### 3. Journeys, HTTP check, axe and growth

`test-web-journeys.mjs`, same four commands as section 3, final builds:

| Configuration | Result |
|---|---|
| server store · 1440x900 | 15 passed, 0 failed, 2 not applicable |
| server store · iPhone 14 metrics (390x664, Chromium) | 15 passed, 0 failed, 2 not applicable |
| browser store · 1440x900 | 15 passed, 0 failed, 2 not applicable |
| browser store · iPhone 14 metrics | 15 passed, 0 failed, 2 not applicable |

The fifteenth journey is the new `copy-states` (item 4). Two-account isolation: the same
lines as section 4 in all four (19 reads, 28 writes and deletions, 10 addresses, one
tab), still with no cross-account read or write. Deletion including the re-sign-in
step: pass in all four. `deletion-off` was not rerun.

- `test-local-http.mjs`: both `PASS` lines on the server build and on the browser build.
- `axe-check.mjs` against `next start` with fixtures: `PASS` on both builds, 248 state
  runs each with 0 findings of any severity, 186 touch-viewport runs, 174 contrast rows
  all AA, `SKIP cabinet` (7 min 44 s and 7 min 46 s). The moderate finding seen once in
  the first run did not recur.
- `growth-check.mjs`: `{"ok":true,"profiles":8}` on both builds.
- `npm test`: 50 files, 388 tests, pass. `eslint .` and `tsc --noEmit`: clean.

**The added auth round trip.** A signed-in request with the same cookies, sent in turn
to the first run's server build ("before", `getClaims`) and to this one ("after",
`getUser`), both against this stack, 60 timed requests each after 10 warm-ups, whole
response read:

| Request | Before, median (p95) | After, median (p95) | Difference |
|---|---|---|---|
| garden page, Pages (`/garden?garden=…&view=list`) | 27.1 ms (40.5) | 30.0 ms (45.8) | +2.9 ms |
| `/garden/history?entry=…` | 6.8 ms (10.2) | 9.4 ms (11.9) | +2.6 ms |
| `/garden/export` | 15.0 ms (18.7) | 17.8 ms (21.9) | +2.8 ms |
| `GET /auth/v1/user` on its own | | 2.8 ms (4.5) | |

The whole difference is the one call, about 3 ms here where the auth service is on the
same machine. On the hosted app it will be one network round trip from the server to
the auth service, which this cannot measure. No journey slowed visibly or timed out.

### 4. The two pieces of copy, in a real browser at 390 and 1440

Journey `copy-states`, both store modes and both sizes, with screenshots read by eye.

- **Stale location.** An address whose topic and thought do not exist shows the garden
  and "That location is no longer available. Showing its nearest available parent."
  once, on the first screen, and still there 1.5 s later; in Pages it sits above the
  garden banner, in the Meadow it is a card above the topic buttons, clear of the phone
  tab bar. It reads as one true thing. No overflow at either size.
- **Returns, tended before and inactive now. This was still wrong, and is fixed.** The
  state was made the way it really arises: a finished pass in the database that
  returned no bloom and no mark, the most ordinary outcome of "earn the reveal". The
  page still said "Nothing has been returned. Tending is not active for this account
  yet, so no AI has read your writing.", which is false: the writing had been read.
  The follow-up's new wording keys on `tending.lastTendedAt`, and the loader only ever
  dates that from blooms and marks, so a pass that said nothing left no trace; the
  unit test set the field by hand. The first run of this record did not catch it
  either, because its synthetic pass had a bloom row.
  - Fix, test first: `applications/web/src/app/garden/workspace.tsx` passes Returns
    the later of `lastTendedAt` and the newest finished pass in `tendingHistory`
    (which the page already loads). A new case in `workspace.test.tsx` failed before
    the change and passes after; a failed or unfinished pass does not count, and an
    account with no finished pass keeps the never-tended sentence.
  - After the rebuild, all four configurations show, in this order: "Last tended Nov
    16, 2026, 9:40 AM UTC", "Tending is not active now. What was returned before stays
    here to read, and nothing new will arrive until tending is active.", "No bloom is
    showing. Earlier tending passes are in the full record below.", and in the full
    record "Tending is not active now, so nothing new will arrive until it is. Your
    tending choices are saved, and past returns stay here to read." followed by the
    pass itself, "Nothing new to offer". Nowhere "no AI has read your writing", and no
    button to start a pass. It now reads as one true thing.
  - One soft spot left: "What was returned before stays here to read" is said even
    when nothing was ever returned. It is not false beside the next line, but a pass
    with a bloom reads better. With a bloom (the two-account journey's account A) the
    bloom is listed under the same sentence. Wording only; not changed.

### 5. Database tests and the upgrade scripts

- pgTAP, `supabase test db --local supabase/tests` on the rebuilt stack with all
  fourteen migrations: **16 files, 977 tests, pass** (43 s), run with the deletion
  switch at its shipped default and switched back on afterwards.
- `scripts/test-upgrade.sh`, `test-upgrade-browser-path-rules.sh` and
  `test-upgrade-tending-cycles.sh` accept only the shared `.local-runtime` stack named
  `slow-garden-web-thinking`, and each one resets it. Starting and resetting that
  shared stack was refused by this session's permission check, so the scripts were not
  run as committed. They were run from a scratch copy against a separate stack: the
  three files copied byte for byte except the project name (`slow-garden-qa-upgrade`,
  ports 5672x), with the current migrations. All three exit 0:

      Upgrade preserves all 30 source revisions, timestamps and IDs; latest entry and full export verified.
      Browser path rules apply over legacy rows: 0 existing rows changed or rejected; legacy rows still archive, restore, revise and export; new rows of the same kinds are refused.
      Nightly cycles upgrade in place: 2 legacy cycles kept their counts; the one with a pass kept its real start and its link; neither night could be reopened twelve hours later; the next night opened 2 new cycles.

  That stack was stopped with `--no-backup`. The scripts need a `supabase` command on
  the path; here it exists only through `npx`, so a one-line wrapper was used.

### Changed by this pass

- `scripts/test-web-journeys.mjs`: the cookie replay is asserted (server store) with a
  captured server action, the data-API note reports the token's remaining life, the
  settings sentence is checked per store, and the new `copy-states` journey.
- `applications/web/src/app/garden/workspace.tsx` and `workspace.test.tsx`: the
  Returns fix above.
- This section. Nothing under `supabase/` and nothing in the scene.

### Still not verified

- The 1280 drag on a machine with a GPU, and any real phone, Safari or WebKit.
- The upgrade scripts exactly as committed, on the stack they name.
- The hosted token lifetime, and the hosted cost of the auth round trip.
- `deletion-off`, the first run's build sizes, and tending end to end were not rerun.
- Receipts are again only in the scratch directory; the numbers above are the record.

## Drag budget after the meadow change: fixed

Later on 2026-11-16, for item 2 of the re-verification (the 1280 drag missing ADR-007's
20 ms). Production build of a scratch copy of `applications/web` (`npm run build`,
exit 0), `accessibility/perf-check.mjs` run unmodified from that copy as section 5
describes, alone on the machine, three cold runs before the fix and three after. The
script needs no Supabase stack and none was started. Same container: 4 vCPU, no GPU,
headless Chromium. No git.

**Cause, checked in a trace.** The re-verification's reading was right, with one
addition. A drag frame does no more script than the old loop did (animation-frame
script p95 1.5 to 3.2 ms; the far layer and its strips stay cached). The cost is in
Chromium's `Commit` step, 10 to 16 ms at p95 at full quality, where the canvases'
drawing is carried to the compositor, and it falls as the grass is thinned and the
canvas softened. `perf-check.mjs` means to exclude canvas rasterisation but the two
event names it looks for do not occur in this Chromium (it reports 0 % in every row,
in every run of this record), so the budget figure includes it. The old loop had
reached the lowest quality before anyone touched the meadow; after D-030 the first
drag started at full quality and needed about 12 s of dragging to get there.

**Fix.** `src/lib/garden/scene/quality.ts` (new) and `scene/atmosphere.ts`:

- A scene the person can turn settles its quality once, 300 ms after its first paint:
  a burst of real frames judged in windows of eight by the same two signals as before
  (drawing cost and frame interval). It only lowers quality, steps twice when far over
  (half the display rate or worse), and stops at the first window that is not slow or
  at the floor: nine frames on a device that keeps pace, at most 45 on one that
  does not (three windows to reach the floor on this container, by the unit test's
  arithmetic; not counted in the browser). The picture does not move during it. The backdrop behind
  the writing page never does this.
- Where it settles is remembered in `localStorage` (two numbers and the canvas area,
  key `slow-garden:meadow-quality:v1`), so a later visit on the same device and a
  similar screen starts there with no burst. Unreadable storage only means it settles
  again.
- While the camera moves it adapts as before, and now also steps twice when far over.
- Nothing runs at rest: after the burst no frame is requested until the camera moves.
- Tests: `quality.test.ts` (10) and five new cases in `atmosphere.test.ts`. The
  earlier test for repainting after a resolution change still passes unchanged.

**Measured.** p95 main-thread frame cost in ms, three cold runs each (a new browser
context per row, so nothing is remembered):

| Budget | Fixture | Before fix | After fix |
|---|---|---|---|
| ≤ 20 ms at 1280 | 100 thoughts | 17.1, 18.1, 17.8 | 10.4, 11.1, 9.3 |
| ≤ 20 ms at 1280 | 1,000 thoughts | 19.5, 19.0, 17.9 | 12.5, 12.3, 11.7 |
| ≤ 20 ms at 1280 | ring of 24 | 4.3, 3.7, 4.5 | 3.8, 3.9, 3.6 |
| ≤ 33 ms at 390, 4x | 100 thoughts | 10.1, 10.2, 12.0 | 8.8, 13.3, 9.1 |
| ≤ 33 ms at 390, 4x | 1,000 thoughts | 11.9, 10.0, 12.1 | 10.3, 10.9, 8.3 |
| ≤ 33 ms at 390, 4x | ring of 24 | 16.1, 13.4, 18.2 | 16.0, 16.1, 16.2 |

All six runs ended `PASS`; the "before" runs here passed with no margin where the
re-verification's failed, which is the same result within its spread. Main thread
while the meadow sits still (the script's 5 s window, which begins after the burst):
1280 at 1x, 1.3 to 1.8 % before and 1.2 to 1.7 % after; 390 at 4x, 5.9 to 6.7 % before
and 5.0 to 6.9 % after; reduced motion 0 to 0.2 %; ring 0.1 to 0.2 %.

**One thing that got worse on this harness, left as it is.** With 1,000 thoughts at
1280 the `requestAnimationFrame` interval is now a median 50 ms where the cold run
before the fix showed 33 ms (100 thoughts: 33 ms both ways). Forcing levels showed
why: half canvas resolution lowers main-thread cost (p95 14.1 against 16.4 ms at full
resolution, same thinned grass) but this software compositor then delivers frames
more slowly, presumably scaling the canvases up. The floor, half resolution included,
is where the old loop also ended on this machine by the same rule; the difference is
that it is now reached before the first drag. A GPU scales for free, so this says
nothing certain about real hardware, but the governor does not check that a
resolution step actually improved pacing, and it should if this harness is to be
believed. Not changed here.

**Not verified.** A machine with a GPU, a real phone, Safari. How the burst looks on a
fast device (expected: nothing visible; one window, no change) and on a slow one (the
grass thins once within the first second). The remembered level across real visits
(unit-tested only). Whether 300 ms is late enough to miss hydration on a slow phone:
at 4x throttle here it did not lower the phone numbers' margin, but a burst that
judges a busy page slow starts the meadow thinner than it need be until a later drag
restores it. Journeys, axe and growth were not rerun for this change.

Checks from `applications/web`: `tsc --noEmit` clean, `eslint .` clean, `vitest run`
51 files, 403 tests, pass.

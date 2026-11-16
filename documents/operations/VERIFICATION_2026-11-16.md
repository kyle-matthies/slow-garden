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

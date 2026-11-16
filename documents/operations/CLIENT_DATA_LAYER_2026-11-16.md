# Client data layer, stage 1 (ADR-009)

- Date: 2026-11-16
- Scope: `applications/web` only. No dependency, framework, migration, cloud call or
  Capacitor install. The app is **not** switched over: no component uses the new layer.
- Decision basis: D-025 ("Stage 1, a client-side data layer on the hosted web app,
  starts now"); ADR-009 "Required refactors" items 1 to 3 and 5 to 6.

## What exists

New directory `applications/web/src/lib/garden/store/`:

| File | Purpose |
|---|---|
| `types.ts` | `GardenStore` interface (22 operations), result types, `STORE_OPERATIONS` |
| `rules.ts` | Pure input rules, error mapping and row shaping shared by both paths |
| `queries.ts` | Reads that take a Supabase client: `allRows`, `loadGardenWith`, entry history, export snapshot and shaping |
| `auth.ts` | Email one-time-code request and verify (already browser-side on both paths) |
| `browser-store.ts` | `createBrowserStore`: Supabase from the browser, publishable key plus the person's session |
| `browser-default.ts` | Wires the browser store to `lib/supabase/client.ts` |
| `server-action-store.ts` | `createServerActionStore`: thin adapter over injected server functions and the two route handlers |
| `server-loader.ts` | `"use server"`: `readSession`, `loadGardenForSession` (what `garden/page.tsx` does, callable for a reload) |
| `server-default.ts` | Wires the server store to today's actions |
| `select.ts` | `NEXT_PUBLIC_GARDEN_STORE=server\|browser` (default and fallback `server`), lazy loading of the chosen implementation |
| `provider.tsx` | `GardenStoreProvider`, `useGardenStore`, `useGardenData` (client state with `reload()`) |
| `testing/fake-supabase.ts` | Recording in-memory stand-in for the Supabase client (tests only) |
| `*.test.ts(x)` | Rules, parity, boundaries, selection, browser defaults, provider |

Edits to existing files, all behaviour-preserving:

- `src/lib/garden/data.ts`: `allRows` and the body of `loadGarden` moved to
  `store/queries.ts`; `data.ts` re-exports `allRows` and calls `loadGardenWith` with
  the server client and the two environment flags.
- `src/app/garden/actions.ts`: the sign-out scope check, mark-response check,
  pass-refusal mapping, deletion target checks, `deletionCounts`, `deletionMissing`,
  `deletionFailure` and the account-deletion error mapping now come from
  `store/rules.ts`. Exported type names are unchanged. Database calls are untouched.
- `src/lib/supabase/client.ts`: adds `isSupabaseConfigured()` (public values only).
  `createClient()` is unchanged.
- `import/actions.ts`: not edited (its validation already lives in `import-core.ts`).

## Design

- **One interface, existing result shapes.** Each method returns what its server
  action returns today (`ActionResult`, `DeletionPreview`, and so on), so a component
  swaps an imported action for a store method and nothing else. Two operations that
  were HTTP routes return typed results instead of status codes (`loadEntryHistory`,
  `exportGarden`). `loadGarden` never redirects: it returns `{ signedIn: false }`.
- **Database remains the authority.** The browser store sends the same table writes
  and RPC calls the actions send, with the caller's own JWT. There is no service-role
  key, and none existed on the server path either. Client rules only refuse early.
- **Shared code where the brief allowed it, parity tests where it did not.** Reads
  (`loadGarden`, tending, history) and rules are single-sourced. Mutations are still
  written twice (actions and `browser-store.ts`) because `actions.ts` was to be edited
  minimally; the parity suite compares them call for call.
- **Deployment switches default to off in the browser.** `GARDEN_AI_ENABLED` and
  `GARDEN_DELETION_ENABLED` are server-only. The browser store takes them as
  `flags()` from whoever builds it; with none supplied, pass requests and all
  deletion refuse and `GardenData` reports both unavailable. On the hosted app the
  server page can pass its own values to `GardenStoreProvider`.
- **Lazy selection.** `createGardenStore()` loads the chosen implementation with a
  dynamic import in a branch on the build-time constant, so a static build with
  `NEXT_PUBLIC_GARDEN_STORE=browser` should be able to drop the server actions. That
  tree-shaking is **not verified** (no static build was made).
- Not added because the app does not do them today: **rename** of a garden, topic or
  thought (no action or UI exists). "Recent writing" is derived in the client from
  `GardenData` by `recentWriting()`; it is not a data operation.

## Action-to-method table

| Today | Store method | Browser path uses |
|---|---|---|
| `garden/page.tsx` + `login/page.tsx` session check (`getClaims`) | `getSession()` | `auth.getClaims` |
| `login-form.tsx`, `delete-reauth.tsx` `signInWithOtp` | `requestEmailCode(email, { createAccount })` | same call |
| `login-form.tsx`, `delete-reauth.tsx` `verifyOtp` | `verifyEmailCode(email, code)` | same call |
| `actions.signOut(scope)` | `signOut(scope)` | `auth.signOut` |
| `data.loadGarden` (via `garden/page.tsx`, `import/page.tsx`), incl. `loadTending`, `loadTendingHistory`, account preferences | `loadGarden(requestedGardenId)` | `gardens`, `plots`, `seeds`, `current_entries`, `tending_marks`, `tending_mark_responses`, `blooms`, `bloom_responses`, `garden_themes`, `seed_revisions`, `accounts`, `garden_passes` selects |
| `actions.readReturns(gardenId)` | `loadReturns(gardenId)` | `garden_passes`, `blooms`, `bloom_responses` selects |
| `returns-lookup.locateRevisions(ids)` | `locateRevisions(ids)` | `seed_revisions` select (ids and dates only) |
| `GET /garden/history?entry=` | `loadEntryHistory(entryId)` | `seed_revisions` select |
| `actions.createArea(kind, name, parentId, id)` (garden, topic, thought) | `createArea(...)` | select then insert on `gardens` / `plots` / `seeds` |
| `actions.saveEntry(input)` (save and revise) | `saveEntry(input)` | RPC `save_entry` |
| `actions.setArchived(kind, id, archived)` (archive and restore; garden, topic, thought, entry) | `setArchived(...)` | update on `gardens` / `plots` / `seeds` / `entries` |
| `actions.setPlotPermissions(id, ai, cross)` | `setTopicTending(topicId, ai, crossPollinate)` | update on `plots` |
| `actions.setTendingPreferences(overnight, timezone)` | `setTendingPreferences(...)` | update on `accounts` |
| `actions.inviteReflection(gardenId, plotIds, id)` | `requestPass(gardenId, topicIds, id)` | select then insert on `garden_passes` (trigger `prepare_pass`) |
| `actions.cancelReflection(id)` | `cancelPass(id)` | update `garden_passes.status` |
| `actions.respondToBloom(id, bloomId, response, correction)` | `respondToBloom(...)` | select then insert on `bloom_responses` |
| `actions.respondToMark(id, markId, response)` | `respondToMark(...)` | select then insert on `tending_mark_responses` |
| `import/actions.importThought(input)` | `importThought(input)` | `runImport` over `plots`, `seeds`, `seed_revisions`, RPC `save_entry`, update `entries.created_at` |
| `GET /garden/export[?format=md][&garden=]` | `exportGarden({ format, gardenId })` | RPC `export_garden_sources` plus `garden_passes`, `blooms`, `bloom_responses`, `tending_marks`, `tending_mark_responses` |
| `actions.previewDeletion(kind, id)` | `previewDeletion(kind, id)` | RPC `deletion_preview` |
| `actions.deleteItem(kind, id, confirmName)` | `deleteItem(...)` | RPC `delete_entry` / `delete_seed` / `delete_plot` / `delete_garden` |
| `actions.deleteAccount(confirm)` | `deleteAccount(confirm)` | RPC `delete_account`, then local sign-out |

22 operations. The browser store implements all 22. Four of them (`requestPass`,
`previewDeletion`, `deleteItem`, `deleteAccount`) refuse by default until deployment
flags are supplied (blockers 1 and 2).

Not data operations and not in the store: `GET /api/health`, `revalidatePath`
(replaced by `reload()`), server redirects and response headers (see the checklist).

## Cannot move safely yet

Read from the migrations in `supabase/migrations/` (through
`20261116010931_in_app_deletion.sql`); nothing was run against a database. Line
numbers are for the files as they stand after this change. Most serious first.

1. **AI availability switch is server-only.** `app/garden/actions.ts:168`
   (`GARDEN_AI_ENABLED` refuses a pass before any call) and `lib/garden/data.ts:14`
   (`aiAvailable`). A browser cannot read it. The database has its own gate
   (`private.ai_runtime.enabled` in `private.prepare_pass`, SQLSTATE 55000), which
   does not depend on the environment check, so the database is already the authority
   for whether a pass runs. But the two switches can disagree, and with the runtime
   enabled any signed-in account can insert a pass regardless of the web flag (the
   uncommitted `20261116023935_ai_tenant_allowlist.sql` in this tree addresses that;
   it is another team's and unapplied). *Handled now:* browser store refuses unless
   `flags().aiAvailable` is supplied. *Needed:* a read-only RPC, for example
   `public.garden_capabilities()` (security definer, returns booleans only), that
   answers "may this account request tending" from `private.ai_runtime` and the
   allowlist; then retire the environment flag as a gate.
2. **Deletion switch is server-only.** `app/garden/actions.ts:351-353`, used at 362,
   412 and 448, and `lib/garden/data.ts:15`. The database has no such switch: once the
   deletion migration is applied its RPCs are granted to `authenticated` whatever the
   flag says, so the flag is a ship-order and UI switch, not a boundary. *Handled now:*
   browser store refuses unless `flags().deletionAvailable` is supplied; an absent RPC
   (PGRST202) is also reported as unavailable. *Needed:* the same capabilities RPC, or
   a decision that "RPC present" means available.
3. **Bloom response shape is checked only by the server action.**
   `lib/garden/validation.ts:20` (a `correct` response needs text) and
   `actions.ts:238` (correction stored only with `correct`). The table checks only
   `response in (...)` and `char_length(correction) <= 2000`. Corrections flagged
   `correct` are copied into the next pass's model input by `prepare_pass`.
   *Needed:* a check constraint tying the two together, e.g.
   `(response = 'correct') = (correction is not null and correction ~ '\S')`.
4. **A new thought in an archived topic is refused only by the server.**
   `actions.ts:63` and `import/import-core.ts:66` read the topic first. `seeds` insert
   has only the composite foreign key; `save_entry` then refuses to write there.
   *Needed:* a `BEFORE INSERT` trigger on `public.seeds` (or a `create_thought` RPC)
   rejecting an archived topic or garden.
5. **Blank and untrimmed text.** Names: `validation.ts:5` rejects any
   whitespace-only name and `actions.ts:47,54,69` store `name.trim()`; the database
   checks `char_length(btrim(name))`, and `btrim` strips spaces only, so a tab-only or
   newline-only name passes and padding is stored. Bodies: `validation.ts:11` against
   `seed_revisions_body_length` (same `btrim`), so `"\n\n"` passes `save_entry`.
   Lengths are counted in UTF-16 units on the client and in characters in Postgres;
   the client is the stricter. *Needed:* constraints using `~ '\S'`, and a decision on
   whether the database trims names.
6. **Import size.** `import-core.ts:46` caps one call at 500 entries, and a server
   action request is capped at 1 MB by Next (default; `next.config.ts` sets no
   `bodySizeLimit`). Neither exists in the database, and there is no application rate
   limit on either path, so none is weakened; the browser path simply loses the
   request ceiling. *Needed, if wanted:* an `import_thought` RPC that takes the batch,
   enforces the cap, and makes the import one transaction (it is not atomic today).
7. **`entries.created_at` is writable by its owner** (`import/actions.ts:65-70`;
   `grant update on public.entries`, all columns). Pre-existing and tenant-scoped; it
   exists for import dates. *Needed, if wanted:* a column-level grant plus the import
   RPC above.
8. **Not data, and not movable by a store:** session refresh and
   `Cache-Control: private, no-store` on every response (`lib/supabase/proxy.ts:36-38`,
   `src/proxy.ts`), the CSP and security headers (`next.config.ts:51-67`), and server
   redirects (`garden/page.tsx:16-19`, `garden/import/page.tsx:16-19`,
   `login/page.tsx:14-18`, `app/page.tsx:11-12`). No database change; see the
   checklist.

Already enforced by the database, so safe on the browser path as read: tenant
ownership on every table (RLS), time zone names (`private.check_account_timezone`),
mark responses (check constraint), pass creation, scope, budget and cancellation
(`prepare_pass`, `guard_pass_update`, column grants), entry conflicts and replay
(`save_entry`), deletion ownership, typed names and the ten-minute sign-in rule
(`delete_*`). The idempotent "read, then insert" replay checks are the same two
calls on both paths.

## Tests

Run from `applications/web` on 2026-11-16:

- `npx tsc --noEmit`: exit 0.
- `npx eslint` (whole project): exit 0.
- `npx vitest run`, three consecutive runs: 39 files, 260 tests, all passing each
  time. The store adds 6 files and 82 tests.
- `npm run test:node`: 75 passing (run once; not required by the brief).
- Dev server on :3147 still served `/dev/axe-fixtures` and `/login` (HTTP 200).

What the store tests cover:

- `parity.test.ts` (36 tests): each scenario runs against the server store (the real
  actions, loader and both route handlers, with the server client mocked) and the
  browser store, each over its own copy of the same fake database. It requires
  identical results, identical ordered database and auth calls, and identical final
  tables, then asserts the expected values. Covers all 22 operations, signed out and
  signed in, flags on and off, invalid input, replays and database refusals.
- `boundaries.test.ts`: walks the import graph from every `store/browser*` module and
  fails on `next/headers`, `next/cache`, `next/server`, `server-only`, the server
  Supabase client, or any `"use server"` module; also fails if any store file names a
  service-role key or reads a non-`NEXT_PUBLIC_` environment variable.
- `rules.test.ts`, `browser-store.test.ts`, `select.test.ts`, `provider.test.tsx`.
- Mutation check (done by hand, then reverted): storing a correction on `keep`,
  changing one query limit, importing `next/headers`, importing a server action, and
  skipping the AI gate each failed the suite.

### Not verified

- **Nothing here ran against a real Supabase**, local or hosted. The fake client
  applies no RLS, constraint, trigger or RPC logic. Parity proves the two paths ask
  for the same things; it does not prove the database allows or refuses them.
- No browser run: the app does not use the store, so no page exercised it.
- Browser `auth.getClaims()` behaviour with this project's signing keys, token
  refresh, and cookie storage under the browser store.
- A static export build, and that it drops the server implementation.
- The two new server functions in `server-loader.ts` were exercised only through the
  mocked server client.
- `workspace-guard` (`/Users/kylematthies/Code/bin/`) does not exist on this machine
  and was not run. No git command was run.

## Next-stage checklist (in order)

Keep `NEXT_PUBLIC_GARDEN_STORE` unset (server) until step 8.

1. **Mount the provider, change nothing else.** In `garden/page.tsx` and
   `garden/import/page.tsx`, wrap the client tree in
   `<GardenStoreProvider aiAvailable={data.aiAvailable} deletionAvailable={!!data.deletionAvailable}>`.
   Also wrap the dev fixture and preview pages, passing a fixture `store`.
2. **Leaf components first** (each is one import swap, no data-flow change):
   `tending-settings.tsx` (`setTendingPreferences`), `new-area.tsx` and `first-run.tsx`
   (`createArea`, `saveEntry`), `entry-editor.tsx` (`saveEntry`), `delete-control.tsx`
   (`previewDeletion`, `deleteItem`, `deleteAccount`), `delete-reauth.tsx` and
   `login-form.tsx` (`requestEmailCode`, `verifyEmailCode`). Update the tests that
   `vi.mock("./actions")` to supply a store through the provider.
3. **Returns:** `returns.tsx` (`loadReturns`, `locateRevisions`, `requestPass`,
   `cancelPass`, `respondToBloom`).
4. **Import:** `import-form.tsx` (`importThought`).
5. **Workspace mutations:** `workspace.tsx` (`setArchived`, `setTopicTending`,
   `respondToMark`, `signOut`), then entry history: replace
   `fetch("/garden/history?entry=...")` (line 97) with `store.loadEntryHistory`.
6. **Export:** replace the six `/garden/export` links (`workspace.tsx:731-747`,
   `delete-control.tsx:249-259`) with buttons that call `store.exportGarden` and save
   the result: on the web a `Blob` with the returned `mimeType` and an
   `<a download={filename}>`; in the app the share sheet (stage 2). Keep the export
   message "no partial export" on failure. Then the two route handlers are unused.
7. **Client state instead of `router.refresh()`.** `GardenWorkspace` takes
   `initialData`, reads `useGardenData(requestedGarden, initialData)` and calls
   `reload()` where it calls `router.refresh()` (`workspace.tsx:382`, `:459` and the
   other call sites). With the server store, `reload()` uses `loadGardenForSession`,
   so the server actions' `revalidatePath` calls become unnecessary but harmless.
   The hosted app still server-renders the first paint.
8. **Turn on the browser store on the hosted app, behind the flag, for the owner.**
   Before this: apply and pgTAP-test database changes for blockers 3 to 5 (ADR-009
   item 5), run the two-user negative RLS tests for every relation in the table
   above, and exercise every operation against a local Supabase with
   `NEXT_PUBLIC_GARDEN_STORE=browser`. Rollback is unsetting the variable.
9. **Auth and session in a static build** (differences to design for):
   - *Hosted web today:* `@supabase/ssr` keeps the session in cookies readable by
     script (not `HttpOnly`); `proxy.ts` refreshes it on every request and the server
     redirects by reading it. The browser store on the hosted app keeps using this
     client, so server redirects keep working.
   - *Static build:* no server reads the cookie and nothing refreshes it on
     navigation. `lib/supabase/client.ts` must return, in the app, a `supabase-js`
     client with `persistSession`, `autoRefreshToken` started and stopped with app
     foreground state, `detectSessionInUrl: false`, and a storage adapter on the iOS
     Keychain or app-private preferences (ADR-009 item 1; week-one spike with a
     kill-and-reopen test). Sign-out must erase tokens and drafts (T-09).
   - `delete_account` requires a session created in the last ten minutes; refresh
     does not renew that, so the re-authentication step stays.
10. **Route protection without `proxy.ts`.** A client guard component for `/garden`
    and `/garden/import`: `store.getSession()` on mount plus the client's
    `onAuthStateChange`; signed out goes to `/login`, signed in on `/login` goes to
    `/garden`. Until it resolves, render the existing loading state, never garden
    data. This is navigation only: RLS is the protection. `useGardenData` already
    reports `signed-out`. The static pages hold no private data, so the proxy's
    `no-store` header has nothing to protect there; the CSP moves to a `<meta>` tag
    with the Supabase origin in `connect-src` (ADR-009 item 7).
11. **Capabilities.** Add the `garden_capabilities()` RPC (blockers 1 and 2), read
    it in the browser store's `loadGarden`, and stop passing flags as props.
12. **Deep links.** Selection is already in search parameters (`?garden=`, entry
    anchors); keep it that way and avoid dynamic segments. In the app, map a custom
    scheme or universal link to the same paths; a sign-in link is not needed because
    sign-in is a typed code. After sign-in, return to the originally requested path.
13. **Keeping the hosted app working throughout.** Each step above ships on the
    server store first. Delete `actions.ts`, `import/actions.ts`, `returns-lookup.ts`,
    `server-loader.ts`, the server store and both route handlers only after the
    browser store has run for the owner on the hosted app and the database changes
    are in; at that point move the mutation bodies' only copy to `browser-store.ts`
    and drop the parity suite's server half. `GET /api/health`, the landing page and
    the server redirects stay on the hosted app.

## Changes needed in files this work did not own

- `documents/DECISION_LOG.md`: record that deployment flags default to off on the
  browser path and that the store keeps the actions' granularity (no rename).
- `supabase/**`: the database changes in blockers 1 to 7, as migrations with pgTAP.
- `workspace.tsx`, the garden pages and their tests: checklist steps 1 to 7.

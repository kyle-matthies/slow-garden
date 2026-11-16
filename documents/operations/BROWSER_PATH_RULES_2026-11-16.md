# Database rules for the browser data path

- Date: 2026-11-16 (revised the same day after an independent review; see "Review findings")
- Scope: one migration, `supabase/migrations/20261116041903_browser_path_rules.sql`, its
  tests, the store's use of it, and this record.
- Requirements: the eight "cannot move safely yet" blockers in
  [CLIENT_DATA_LAYER_2026-11-16.md](CLIENT_DATA_LAYER_2026-11-16.md).
- **Nothing hosted was touched.** No Supabase or Vercel connector or cloud call was made.
  The migration is not applied to the hosted project; it joins the four 20261116
  migrations already pending there and must be applied after them.
- No git command was run. `workspace-guard` does not exist on this machine and was not run.

## What changed

| File | Change |
|---|---|
| `supabase/migrations/20261116041903_browser_path_rules.sql` | New. Created with `supabase migration new browser_path_rules`; edited in place after review (never applied anywhere but the local stack). |
| `supabase/tests/browser_path_rules.sql` | New. 277 tests. |
| `supabase/tests/browser_path_rules_concurrency.sql` | New. 26 tests, two real sessions over dblink. |
| `scripts/test-upgrade-browser-path-rules.sh` | New. Applies the migration over rows the older constraints accepted and the new rules refuse. |
| `supabase/tests/deletion.sql`, `deletion_concurrency.sql` | One line each to switch deletion on (and off again in cleanup), because deletion ships switched off. |
| `applications/web/src/types/database.ts` | Two functions added (`garden_capabilities`, `import_thought`). See "Types". |
| `store/rules.ts` | Blank-character list, limits, capability parsing, the combination rule, import limits and messages, archived-place messages, SQLSTATE names. |
| `store/queries.ts` | `readCapabilities`; `loadGardenWith` combines supplied flags with the database's answer. |
| `store/import-rpc.ts` | New. `planImport`, `importThoughtWith`: the shared import call and its guarded fallback. |
| `store/browser-store.ts`, `store/provider.tsx` | Use the above; flags are optional. |
| `store/*.test.ts` | Parity, rules and browser-store tests (290 web tests, up from 263). |
| `app/garden/import/actions.ts` | Outside the originally owned files. The server import calls the shared `importThoughtWith`. |
| `app/garden/actions.ts` | Asked for by the review (finding 8). Two lines: failures are phrased by `rules.saveFailureMessage`, and an archived topic found by the pre-read raises the same coded error the database raises. |

`data.ts`, `import-core.ts`, `validation.ts`, `workspace.tsx` and CSS were not edited.

## Design

**The database is the authority; the web only refuses early.** Every rule below holds for
any caller with the person's own session, whichever path sent the request.

**Existing rows are never rewritten, rejected or stranded.** Older constraints accepted
text these rules refuse (a tab-only name, a newline-only body, a body over 20,000 UTF-16
units). Revisions are immutable and the text is the person's own, so there is no
acceptable repair. Therefore:

- Rules on text that can still be edited (names, titles, time zone) are **triggers that
  fire only when that column is written**. No CHECK constraint is added to those tables:
  a CHECK, even `NOT VALID`, is re-evaluated on every update of a row and would stop a
  legacy garden from being archived or restored.
- Rules on append-only text (revision bodies, bloom corrections) are CHECK constraints
  left **`NOT VALID` permanently**: Postgres enforces them for every new row and never
  looks at old ones. They must not be validated.
- The migration cannot fail on existing data. It raises a NOTICE with counts only; the
  Supabase CLI does not print notices, so use the query under "Hosted report" for the
  numbers.

**Blank means what `String.prototype.trim()` empties.** `btrim` strips spaces only, and
`[[:space:]]` / `\s` do not match JavaScript (measured here: `\s` matches U+0085 and U+001C,
which `trim()` keeps, and misses U+FEFF, which it removes). `private.trim_text` uses an
explicit list of the 25 characters: U+0009 to 000D, 0020, 00A0, 1680, 2000 to 200A, 2028,
2029, 202F, 205F, 3000, FEFF. Zero-width space (U+200B), the joiners, U+2060, U+180E and
U+0085 are **not** blank on the server path, so they are not blank in the database.
`rules.ts` carries the list as `BLANK_CHARACTERS`; `rules.test.ts` checks it against
`trim()` for every Unicode code point and against the literal in the migration.

**Lengths are UTF-16 code units,** as `String.length` counts them (`private.utf16_length`).

**Names are trimmed by the database.** The trigger refuses a blank or over-long name
measured before trimming, as the web does, then stores it trimmed. Bodies and corrections
are never trimmed.

**Deployment switches: both must allow.**

- `private.deployment_switches` is one row, `deletion_enabled` default false. Only the
  operator and the service role can change it; no API role can read it; a missing row
  reads as off. All six deletion RPCs refuse with SQLSTATE `SGA03` while it is off.
- `public.garden_capabilities()` returns `{"tending": bool, "deletion": bool}` for the
  caller. `tending` is true only when the runtime is enabled and the caller is
  allowlisted, so an account that is not learns nothing about the runtime or anyone else.
- A feature is available when the environment flag **and** the database allow it
  (`rules.availability`). With no flags supplied (a static build has no server), the
  database decides alone. Against a database that predates the RPC, only explicitly
  supplied flags count (today's behaviour); with none, nothing is available.
- **To turn deletion on the owner now needs both**
  `update private.deployment_switches set deletion_enabled=true;` and
  `GARDEN_DELETION_ENABLED=true`.

**Archived places take no new writing.** One SQLSTATE, `SGA02`, with a message naming
what is archived (`this garden|topic|thought|entry is archived; restore it to write
here`). Covered: a new thought, a thought moved to another topic, a new entry or revision
(through `save_entry`, import, or a direct insert). Writing in an archived *garden* was
allowed on the server path until now and is refused after this migration. A thought that
is missing or another account's gets the same answer whatever its state (23503 from the
foreign key on a direct insert, 42501 "seed unavailable" from `save_entry`).

**Writing and archiving serialise.** Every archive check takes `FOR SHARE` on the row it
reads; an archive needs that row's lock. Lock order everywhere: `accounts` (pass
preparation, deletion, import), then garden, topic, thought, entry. `save_entry` used to
lock the thought first; it now takes the garden and topic share locks before it. Writers
only ever take share locks on gardens and topics, so they do not block each other. One
known exception: an owner update that *moves* a thought holds the thought's row lock
before the trigger takes the share locks; it can only deadlock against a concurrent
garden deletion, Postgres resolves that by aborting one of them (40P01, already phrased
by the web), and the app has no move action.

**Dates and revision numbers belong to the database.** The owner's session can no
longer set or move `created_at` on gardens, topics, thoughts, entries or revisions, nor
`updated_at`, nor a topic's `permission_version`: column grants name exactly what the
web writes. No legitimate path needed the withdrawn columns except import, which now
goes through the RPC. An API caller's `revision_number` is replaced with the next number
for its thought (the existing scheme numbers per thought, not per entry).
`accounts.created_at` is still owner-writable; nothing reads it.

**Import is one bounded transaction:** `public.import_thought(p_plot_id, p_seed_id,
p_title, p_entries)`.

| Rule | Server today | Database now |
|---|---|---|
| Entries | 1 to 500 per request | 1 to 500 **per call**; a thought may grow over several imports |
| Entry shape | `{body, date}` | exactly `entry_id`, `revision_id`, `body`, optional `date`; any other key refused |
| Title | not blank, at most 160 UTF-16 units after trimming | same |
| Body | not blank, at most 20,000 UTF-16 units | same |
| Date | null or a real `YYYY-MM-DD`, year 0100 or later | same, and no later than tomorrow's UTC date |
| Size | 1 MB on the encoded request | title plus bodies at most 1,048,576 bytes, **and** the whole payload as text at most that plus 256 bytes per entry |

- The size figures are not byte-identical to the server's (it measures its own request
  encoding). The whole-payload ceiling counts JSON escaping the way the request does, and
  the 256 bytes per entry cover the identifiers and framing, so the database is never
  stricter than the server for a payload the web builds.
- **Dates are never in the future.** A date is accepted up to tomorrow in UTC, which is
  today somewhere on earth (the "clock skew": at most one calendar day). The entry is
  stored at noon UTC of that day, or at the moment of import if noon has not come yet.
  This differs from the review's wording (refuse anything after now): refusing would
  reject a note dated today when imported before noon UTC, which the web's own
  validation accepts.
- **An existing entry is never changed.** If the revision id exists, it must be the same
  entry, thought and text (else 22023), it is counted as skipped, and nothing about it
  changes, including its date. An entry id that exists under any other revision is
  refused. An existing thought must be the caller's, in the topic named, and active, in an
  active topic and garden; that is checked before anything is read or skipped.
  Consequence: entries imported by the older call-by-call path keep whatever date they
  have; a replay does not re-date them.

**Import fallback is guarded** (`store/import-rpc.ts`). "Function not found" is what a
stale API schema cache says about a function that exists, and against the migrated
database the call-by-call import would save entries and then be refused their dates. So
it runs only on a positive signal that this is the older database: an update of
`entries.created_at` that matches no row is *permitted* (privileges are checked by
Postgres, not the cache). Otherwise the person is told import is unavailable and nothing
was imported. The migration ends with `notify pgrst, 'reload schema'`. **If the API still
answers "function not found" after applying, reload the schema cache by hand** (run
`notify pgrst, 'reload schema';`, or restart the API from the dashboard).

Messages say what is known:

| Situation | Message |
|---|---|
| The database refused the import (one transaction) | "Could not import. Nothing was saved; please retry." |
| No readable answer came back | "Could not confirm the import. It may have been saved; run the same import again to check. Nothing will be saved twice." |
| Call-by-call import (older database only) failed midway | "The import stopped partway. Some entries may have been saved; run the same import again to finish. Nothing will be saved twice." |
| Function unreachable on a migrated database | "Import is not available right now. Nothing was imported; please try again in a minute." |
| Writing refused because something is archived | "This garden is archived. Restore it to keep writing here; your draft is still here." (or topic, thought, entry) |

The archived message is built from the SQLSTATE and the one known word in the database's
message; the database's text is never shown as is. `workspace.tsx` was not edited: it
already displays the action's message.

## Review findings

| # | Finding | Resolution | Tests |
|---|---|---|---|
| 1 | Import re-dated any existing entry, including to 9999 and in archived places | Replays change nothing; existing thought must be in the named topic, the caller's, active; future dates refused or clamped | `browser_path_rules.sql` "never re-dated" and "never in the future" blocks; REST transcript |
| 2 | A pre-check hit aborted with no remedy | No abort path; triggers for editable text, permanent `NOT VALID` for append-only text | `scripts/test-upgrade-browser-path-rules.sh`; "legacy rows" block |
| 3 | Thought could be moved into an archived topic; error code distinguished another tenant's thought | Trigger covers the move; tenant-scoped lookup | section 3 |
| 4 | Unlocked archive check let writing land during an uncommitted archive | Confirmed real before the fix (the old check read without locking); share locks in the check and in `save_entry` | concurrency file, cases 3 to 5 |
| 5 | Revision number 2147483647 broke the thought; other dates owner-writable | Database assigns the number for API callers; column grants on gardens, topics, thoughts | section 6 |
| 6 | Import caps unclear; unknown keys uncounted | Per call, documented; unknown keys refused; whole payload counted | section 5 |
| 7 | Stale cache read as "RPC absent"; false "unchanged" | Positive-signal fallback, truthful messages, schema reload | `parity.test.ts` import groups |
| 8 | Archived refusal said only "please retry" | Specific message from SQLSTATE `SGA02` | `rules.test.ts`, `parity.test.ts` |
| 9 | PostgREST layer never exercised | Run locally; transcript below | |

Before the fixes, on the previously built local database, a hand-run probe confirmed
findings 3 and 5 (move into an archived topic, a garden date moved, revision number
2147483647 accepted and the next save failing with "integer out of range") and the new
test file aborted at its legacy-row fixture because the old CHECK refused it (finding 2).
Finding 1 is the reviewer's own execution; the old function is gone and was not re-run.

Not repaired, by design: a thought whose highest revision number is already 2147483647
(only possible through a past direct insert) still cannot take another save. The hosted
report counts these.

## PostgREST transcript (local)

PostgREST v13.0.7 in its own container against the local database, with a test token
signed locally with the local stack's development secret. This is PostgREST alone, not
the Supabase gateway or auth service. Two synthetic accounts, removed afterwards. Status,
route, what was attempted, and the code or a content-free summary of the answer:

```
401  POST  /rpc/garden_capabilities   capabilities, no token  ->  code=42501
200  POST  /rpc/garden_capabilities   capabilities, signed in  ->  {"tending":false,"deletion":false}
201  POST  /gardens                   create garden
201  POST  /plots                     create topic
200  GET   /gardens                   garden name stored trimmed  ->  {"trimmed":true}
400  POST  /gardens                   create garden, tab-only name  ->  code=23514
403  POST  /gardens                   create garden with a chosen date  ->  code=42501
200  POST  /rpc/import_thought        import_thought  ->  {"created":2,"skipped":0}
200  POST  /rpc/import_thought        import_thought replay, other dates  ->  {"created":0,"skipped":2}
200  GET   /entries                   entry dates after replay  ->  {"first":"2019-03-04T12","secondIsToday":true}
400  POST  /rpc/import_thought        import_thought, unknown key  ->  code=22023
400  POST  /rpc/import_thought        import_thought, date in 9999  ->  code=22023
400  POST  /rpc/import_thought        import_thought by another account  ->  code=SGA02
200  GET   /seeds                     other account reads the thought  ->  {"rows":0}
403  PATCH /entries                   move an entry date (the fallback probe)  ->  code=42501
200  POST  /rpc/save_entry            save_entry  ->  {"returnedId":true}
400  POST  /rpc/save_entry            save_entry, newline-only body  ->  code=23514
400  POST  /rpc/deletion_preview      deletion_preview, switch off  ->  code=SGA03
400  POST  /rpc/delete_entry          delete_entry, switch off  ->  code=SGA03
204  PATCH /gardens                   archive the garden
400  POST  /rpc/save_entry            save_entry in the archived garden  ->  code=SGA02
     message carried to the client: "this garden is archived; restore it to write here"
400  POST  /seeds                     new thought in the archived garden  ->  code=SGA02
400  POST  /rpc/import_thought        import_thought in the archived garden  ->  code=SGA02
200  POST  /rpc/garden_capabilities   capabilities, switch on  ->  {"tending":false,"deletion":true}
200  POST  /rpc/delete_entry          delete_entry, switch on  ->  {"deleted":true}
```

The custom SQLSTATEs arrive as HTTP 400 with `code` intact, which is what the web maps.

## Store tests, and what they do not prove

`parity.test.ts` runs the server path and the browser path over **a fake Supabase client
that checks nothing**: no RLS, no constraint, no trigger, no RPC body. It proves both
paths send the same calls and phrase the same refusals when the fake is told to refuse.
**Only the pgTAP files, the upgrade scripts and the transcript above exercise the real
rules.** The browser store itself has still never run against a real Supabase or in a
browser.

Blocker 8 (session refresh and `Cache-Control: private, no-store`, the CSP and security
headers, server redirects) has no SQL here. It belongs to the client stage: checklist
items 9 and 10 of the client data layer record.

## Hosted report

Read-only, self-contained, counts only, never content. Nothing it finds blocks the
migration or is changed by it; it tells the owner how much legacy text predates the rules.

```sql
-- Counts only. Self-contained: needs nothing from the migration. Read-only.
-- Informational: no count here stops the migration, and no row counted is changed by it.
with ws as (select E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF' as c),
u as (select '[^\U00010000-\U0010FFFF]' as bmp)
select 'garden names: blank' as rule, count(*) from public.gardens, ws where btrim(name, ws.c)=''
union all select 'garden names: over 120 UTF-16 units', count(*) from public.gardens, u where char_length(name)+char_length(regexp_replace(name,u.bmp,'','g'))>120
union all select 'garden names: padded (kept as they are; trimmed on next rename)', count(*) from public.gardens, ws where btrim(name, ws.c)<>name
union all select 'topic names: blank', count(*) from public.plots, ws where btrim(name, ws.c)=''
union all select 'topic names: over 120 UTF-16 units', count(*) from public.plots, u where char_length(name)+char_length(regexp_replace(name,u.bmp,'','g'))>120
union all select 'topic names: padded (kept)', count(*) from public.plots, ws where btrim(name, ws.c)<>name
union all select 'thought titles: blank', count(*) from public.seeds, ws where btrim(title, ws.c)=''
union all select 'thought titles: over 160 UTF-16 units', count(*) from public.seeds, u where char_length(title)+char_length(regexp_replace(title,u.bmp,'','g'))>160
union all select 'thought titles: padded (kept)', count(*) from public.seeds, ws where btrim(title, ws.c)<>title
union all select 'bodies: blank', count(*) from public.seed_revisions, ws where btrim(body, ws.c)=''
union all select 'bodies: over 20000 UTF-16 units', count(*) from public.seed_revisions, u where char_length(body)+char_length(regexp_replace(body,u.bmp,'','g'))>20000
union all select 'bloom responses: correct without text', count(*) from public.bloom_responses, ws where response='correct' and (correction is null or btrim(correction, ws.c)='')
union all select 'bloom responses: correction on keep or prune', count(*) from public.bloom_responses where response<>'correct' and correction is not null
union all select 'time zones: shape or length the web refuses', count(*) from public.accounts where char_length(timezone)>64 or timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
union all select 'thoughts in an archived topic or garden (informational; existing rows are untouched)', count(*) from public.seeds s join public.plots p on p.id=s.plot_id join public.gardens g on g.id=s.garden_id where s.status='active' and (p.archived_at is not null or g.status<>'active')
union all select 'entries dated in the future (informational)', count(*) from public.entries where created_at>now()
union all select 'thoughts whose highest revision number is 2147483647 (their next save fails; not caused or repaired by this migration)', count(*) from (select seed_id from public.seed_revisions group by seed_id having max(revision_number)=2147483647) m;
```

Then, in order: deploy the web change, apply the four pending 20261116 migrations, apply
this one, confirm the API sees `garden_capabilities` (reload the schema cache if not),
run advisors and the two-user canary (extend it with `garden_capabilities()` and one
refused `delete_entry` while the switch is off).

**Old web against the new database:** the old server import would save undated entries
and then fail at its date update, and a later replay will not re-date them. Deploy the
web first.

## Types

`applications/web/src/types/database.ts` was edited by hand to add the two functions in
the file's existing style. The local generator in this CLI (3.1.0) emits a different
dialect from the committed file (quoted keys, `ComputedFields`, `NonNullable<Json>`,
non-null view columns), unrelated to this migration and not adopted. A token-level
comparison shows only those dialect differences; the function lists match, and the
revision after review changed no signature.

## Executed

Local stack (`supabase` CLI 3.1.0, Postgres 17, database-only), 2026-11-16, after the
review fixes:

- `npx supabase db reset`: all 12 migrations apply.
- `npx supabase test db`: 11 files, **712 tests**, pass; run twice. Before this work: 9
  files, 409 tests.
- `npx supabase db lint --schema public,private --level warning --fail-on error`: no
  schema errors.
- `bash scripts/test-upgrade.sh`: passes. `bash scripts/test-upgrade-browser-path-rules.sh`:
  passes (0 existing rows changed; legacy rows still archive, restore, revise and export;
  new rows of the same kinds refused). Their dedicated stack did not exist here:
  `.local-runtime/supabase/` (git-ignored) was created from the main config with the
  project id and ports changed, and a PATH shim mapped `supabase` to `npx supabase`. It
  was stopped afterwards.
- PostgREST transcript above (image `postgrest/postgrest:v13.0.7` pulled for it; container
  removed).
- From `applications/web`: `npx tsc --noEmit` exit 0; `npx eslint` exit 0;
  `npx vitest run` twice, 40 files, 290 tests, pass both times; `npm run test:node`, 88
  pass.
- The reversal below, inside a transaction that was rolled back: no error, no object left.

## Not executed, not verified

- Anything hosted: the report query, the migration, advisors, the canary.
- The Supabase gateway and auth service, `supabase-js`, and the browser store against a
  real database or in a browser.
- That a running PostgREST picks up the migration's `notify` (it was started after the
  migration; a manual `notify` during the transcript did reload it).
- The pre-fix behaviour of finding 1 (taken from the reviewer's run).
- A production build, the web journey scripts, the local HTTP script.
- Cost of the rules on large tables (two immutable function calls per row written; a
  20,000-character body runs one regular expression; each save takes three more row
  share locks).

## Reversal

Before applying to hosted: delete the migration, the two test files and the upgrade
script, revert the two one-line test edits and the web changes. The web tolerates a
database without the RPCs.

After applying: the operational reversal for deletion is the switch itself. To remove
the rules, ship a new migration with the statements below (the committed ledger stays
the authority; do not run it ad hoc on hosted). No data is rewritten in either
direction; names trimmed in the meantime stay trimmed, and entries dated by import keep
their dates.

```sql
begin;
-- 1. Functions back to their earlier bodies: the six deletion RPCs as in
--    20261116010931_in_app_deletion.sql, save_entry as in 20260907003913_web_thinking_garden.sql.
-- (run those seven definitions here, each as `create or replace function`, exactly as written in those files)
drop function private.require_deletion_enabled();
drop function public.garden_capabilities();
drop table private.deployment_switches;
drop function public.import_thought(uuid,uuid,text,jsonb);
-- 2. The owner's earlier table privileges.
revoke insert,update on public.gardens,public.plots,public.seeds,public.entries from authenticated;
grant insert,update on public.gardens,public.plots,public.seeds,public.entries to authenticated;
revoke insert on public.seed_revisions from authenticated;
grant insert on public.seed_revisions to authenticated;
-- 3. Triggers and their functions.
drop trigger revisions_sequence on public.seed_revisions;
drop trigger revisions_refuse_archived on public.seed_revisions;
drop trigger seeds_refuse_archived_parent on public.seeds;
drop trigger accounts_timezone_shape on public.accounts;
drop trigger seeds_clean_title on public.seeds;
drop trigger plots_clean_name on public.plots;
drop trigger gardens_clean_name on public.gardens;
drop function private.assign_revision_number();
drop function private.refuse_archived_writing();
drop function private.refuse_archived_parent();
drop function private.check_timezone_shape();
drop function private.clean_seed_title();
drop function private.clean_area_name();
-- 4. Constraints and helpers.
alter table public.bloom_responses drop constraint bloom_responses_correction_rule;
alter table public.seed_revisions drop constraint seed_revisions_body_rule;
drop function private.is_calendar_date(text);
drop function private.utf16_length(text);
drop function private.trim_text(text);
notify pgrst, 'reload schema';
commit;
```

## Needed in files this work did not own

- `documents/DECISION_LOG.md`: record (a) both-must-allow and the database deletion
  switch, (b) the database trims names, (c) blank and length follow JavaScript, (d) dates
  and revision numbers are the database's and import is an RPC that never changes an
  existing entry, (e) writing in an archived garden is refused, (f) legacy text is never
  validated against new rules.
- `documents/operations/DELIVERY_2026-11-16.md` and `DELETION_2026-11-16.md`: turning
  deletion on also needs the database switch; five migrations are pending.
- `documents/operations/README.md`: link this record. `README.md`: mention the second
  upgrade script.
- `scripts/hosted-canary.sql`: add the capability and switch checks.
- `import-core.ts`: `runImport` is reached only against a database without
  `import_thought`; it and the adapters can go once the migration is applied.

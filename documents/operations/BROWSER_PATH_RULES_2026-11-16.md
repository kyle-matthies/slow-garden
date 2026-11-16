# Database rules for the browser data path

- Date: 2026-11-16
- Scope: one migration, `supabase/migrations/20261116041903_browser_path_rules.sql`, its
  pgTAP tests, the store's use of it, and this record.
- Requirements: the eight "cannot move safely yet" blockers in
  [CLIENT_DATA_LAYER_2026-11-16.md](CLIENT_DATA_LAYER_2026-11-16.md).
- **Nothing hosted was touched.** No Supabase or Vercel connector or cloud call was made.
  The migration is not applied to the hosted project; it joins the four 20261116
  migrations already pending there and must be applied after them.
- No git command was run. `workspace-guard` does not exist on this machine and was not run.

## What changed

| File | Change |
|---|---|
| `supabase/migrations/20261116041903_browser_path_rules.sql` | New. Created with `supabase migration new browser_path_rules`. |
| `supabase/tests/browser_path_rules.sql` | New. 216 tests. |
| `supabase/tests/browser_path_rules_concurrency.sql` | New. 12 tests, two real sessions over dblink. |
| `supabase/tests/deletion.sql`, `deletion_concurrency.sql` | One line each to switch deletion on (and off again in cleanup). Needed because deletion now ships switched off; nothing else in them changed. |
| `applications/web/src/types/database.ts` | Two functions added (`garden_capabilities`, `import_thought`). See "Types" below. |
| `applications/web/src/lib/garden/store/rules.ts` | Blank-character list, limits, capability parsing, the combination rule, import limits, SQLSTATE names. `deletionMissing` now also recognises the database switch. |
| `store/queries.ts` | `readCapabilities`; `loadGardenWith` combines supplied flags with the database's answer. |
| `store/import-rpc.ts` | New. `planImport`, `importThoughtWith`: the shared import call. |
| `store/browser-store.ts`, `store/provider.tsx` | Use the above; flags are now optional. |
| `store/*.test.ts` | Parity, rules and browser-store tests for all of it (287 web tests, up from 263). |
| `applications/web/src/app/garden/import/actions.ts` | **Outside the files this work owned.** Three added lines: the server import now calls the same shared `importThoughtWith`, falling back to its existing call-by-call body when the RPC is absent. Without this the server import would break once the owner can no longer write `entries.created_at`. `actions.ts`, `data.ts`, `import-core.ts`, `workspace.tsx` and CSS were not edited. |

## Design

**The database is the authority; the web only refuses early.** Every rule below is
enforced for any caller holding the person's own session, whichever path sent the request.

**Blank means what `String.prototype.trim()` empties.** Postgres `btrim` strips spaces
only, and `[[:space:]]` / `\s` do not match JavaScript either (measured on this stack:
`\s` matches U+0085 and U+001C, which `trim()` keeps, and misses U+FEFF, which it
removes). So `private.trim_text` uses an explicit list of the 25 characters: U+0009 to
000D, 0020, 00A0, 1680, 2000 to 200A, 2028, 2029, 202F, 205F, 3000, FEFF.
Zero-width space (U+200B), the joiners, U+2060, U+180E and U+0085 are **not** blank on
the server path, so they are not blank in the database: this matches the server rule
rather than improving on it. `rules.ts` carries the same list as `BLANK_CHARACTERS`;
`rules.test.ts` checks it against `trim()` for every Unicode code point and against the
literal in the migration file.

**Lengths are UTF-16 code units,** as `String.length` counts them
(`private.utf16_length`): an emoji costs two. The older code-point constraints stay.

**Names are trimmed by the database** (blocker 5's open decision). A `BEFORE` trigger
refuses a blank or over-long name measured before trimming, as the web does, then stores
it trimmed. Bodies and corrections are never trimmed. Existing padded names are left as
they are and are trimmed the next time they are renamed.

**Deployment switches: both must allow.**

- `private.deployment_switches` is one row, `deletion_enabled` default false. Only the
  operator and the service role can change it; no API role can read it. A missing row
  reads as off. All six deletion RPCs call `private.require_deletion_enabled()` after the
  sign-in check and refuse with SQLSTATE `SGA03`.
- `public.garden_capabilities()` returns `{"tending": bool, "deletion": bool}` for the
  caller. `tending` is true only when `private.ai_runtime.enabled` and the caller is in
  `private.ai_tenants`, so an account that is not allowlisted learns nothing about the
  runtime or about anyone else.
- A feature is available when the environment flag (`GARDEN_AI_ENABLED`,
  `GARDEN_DELETION_ENABLED`) **and** the database allow it (`rules.availability`).
  With no flags supplied (a static build has no server), the database decides alone.
  Against a database that predates the RPC, only explicitly supplied flags count, which
  is today's behaviour; with none, nothing is available, and the browser store asks the
  database before any deletion call so an unguarded pre-switch RPC is never reached.
- Consequence for deploy order: nothing becomes available by accident. Web first, then
  migration: no change. After the migration, deletion is off until someone sets the
  database switch, even with the environment flag on. **To turn deletion on the owner
  now needs both** `update private.deployment_switches set deletion_enabled=true;` and
  `GARDEN_DELETION_ENABLED=true` (this adds a step to item 2 of the delivery record's
  pending list).

**Source dates belong to the database** (blocker 7). The owner's session loses the
privilege to write `entries.created_at` and `seed_revisions.created_at` (column grants);
both feed the tending watermark and the 28-day "change" tier. Archiving an entry is still
an owner update. `seed_revisions.created_at` was not on the blocker list; it is the same
hole. Left as they are: `revision_number` on a direct insert, and `created_at` on
gardens, topics and thoughts.

**Import is one bounded transaction** (blocker 6): `public.import_thought(p_plot_id,
p_seed_id, p_title, p_entries)`. The caller sends the identifiers the web already derives,
so a retry is a replay. Writing goes through `save_entry`, so replay, conflict and archive
rules are those of an ordinary save. Security definer, keyed to `auth.uid()` throughout.
What the server enforces today and what the RPC holds:

| Rule | Server today | Database now |
|---|---|---|
| Entries per import | 1 to 500 (`import-core.ts`) | same |
| Title | not blank, at most 160 UTF-16 units after trimming | same |
| Body | not blank, at most 20,000 UTF-16 units | same |
| Date | null or a real `YYYY-MM-DD`, year 0100 or later | same |
| Total size | 1 MB on the encoded request (Next's default `bodySizeLimit`) | 1,048,576 bytes of UTF-8, title plus bodies |

The total-size figures are not byte-identical: the server measures the encoded request,
the database measures the text inside it. The database is therefore never stricter than
the server and is looser only by the encoding overhead. The shared web code applies the
database's definition before calling.

**Archived places** (blocker 4). A new thought in an archived topic or garden is refused
(`SGA02`, "choose an active topic"); the trigger takes `FOR SHARE` on the garden and
topic rows so a thought cannot land during a concurrent archive. A new entry or revision
in an archived thought, topic, garden or entry is refused with `save_entry`'s existing
message and code (22023). User-facing messages are unchanged: a refused thought or save
shows "Could not save. Your writing is still here; please retry."; a refused import shows
"Choose an active topic.". **Behaviour change on the server path:** writing in an
archived *garden* was allowed until now; it is refused after this migration. A missing
or foreign parent is still refused by the composite foreign key (23503), as before.

**Old web against the new database.** If the migration is applied before this web change
is deployed, the old server import fails at its date update ("Could not import") after
writing undated entries in separate transactions; re-running the import once the web is
deployed sets the dates (a replay re-dates). Deploy the web first.

## Rules and their tests

All in `supabase/tests/browser_path_rules.sql` unless noted. "Before" is what the same
statement did at migration `20261116023939`, run by hand on the local stack (see
Executed).

| # | Rule | Tests | Before |
|---|---|---|---|
| 1 | `garden_capabilities()`: off by default; tending needs runtime and allowlist; another account learns nothing; two booleans only; anonymous and identity-less sessions refused | section 1 | no such function |
| 1 | Deletion switch: default off; six RPCs refuse with `SGA03` and erase nothing; service role can flip it, cannot add or remove the row; users cannot read or flip it; a missing row reads as off | section 1, hygiene | deletion ran with no switch |
| 2 | `correct` needs non-blank text; `keep` and `prune` carry none; text stored verbatim | section 2 | both accepted |
| 3 | New thought in archived topic or garden refused, also through `create_seed` and import; new entry or revision in archived garden, topic, thought or entry refused, also by direct insert; restore reopens | section 3; concurrency file | all accepted (archived topic was refused only inside `save_entry`) |
| 4 | Blank names, titles and bodies refused for each of the 25 characters; seven near-miss characters accepted; names stored trimmed; bodies verbatim; constraints hold with triggers disabled | helpers, section 4 | tab, NBSP and newline-only text accepted; padding stored |
| 5 | Import: happy path, dates, order, replay, reused identifier rolls the whole import back, 501 entries, empty, malformed, blank, over-long, bad dates, exact size boundary (1,048,576 accepted, one more refused), bytes not characters, two-tenant negatives | section 5 | no such function |
| 6 | Owner cannot set or move `entries.created_at` or `seed_revisions.created_at`; archive and ordinary saves still work; `create_seed` still works | section 6 | both accepted |
| 8 | 120 / 160 / 20,000 in UTF-16 units, measured before trimming for names; time zone shape and 64 | section 4 | 61 emoji accepted as a name; `posix/...` zone accepted |

Blocker 8 (session refresh and `Cache-Control: private, no-store`, the CSP and security
headers, server redirects) has no SQL here. It belongs to the client stage: checklist
items 9 and 10 of the client data layer record.

Not mirrored, deliberately: the 2,000-character correction limit already exists in the
database and the server adds nothing to it; a new topic in an archived garden is allowed
on both paths today and stays allowed.

### Store tests, and what they do not prove

`parity.test.ts` gained two groups (import through the RPC; switches and refusals),
`rules.test.ts` three, `browser-store.test.ts` four cases. They run the server path and
the browser path over **a fake Supabase client that checks nothing**: no RLS, no
constraint, no trigger, no RPC body. They prove both paths send the same calls and phrase
the same refusals when the fake is told to refuse. **Only the pgTAP files exercise the
real rules.** The browser path has still never run against a real Supabase, local or
hosted, and `import_thought` and `garden_capabilities` have not been called through
PostgREST (the local run was database-only).

## Hosted pre-checks

The migration runs its own pre-check first and stops, changing nothing, if any existing
row would violate a new constraint; the error carries counts only. This was exercised
locally with a blank-named garden and a blank body: the migration refused with the two
counts and left no object behind.

To know in advance, run this on the hosted database. It is read-only, needs nothing from
the migration, and returns counts, never content. Every row above the two "informational"
lines must be 0 except the three "padded" rows, which are allowed.

```sql
-- Counts only. Self-contained: needs nothing from the migration. Read-only.
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
union all select 'entries dated in the future (informational)', count(*) from public.entries where created_at>now();
```

Then, in order: apply the four pending 20261116 migrations, apply this one, run advisors
and the two-user canary (extend it with `garden_capabilities()` and one refused
`delete_entry` while the switch is off).

## Types

`applications/web/src/types/database.ts` was edited by hand to add the two functions in
the file's existing style. The local generator in this CLI (3.1.0) emits a different
dialect from the committed file (quoted keys, `ComputedFields`, `NonNullable<Json>`,
non-null view columns), which is unrelated to this migration and was not adopted. A
token-level comparison of the committed file with the local generation shows only those
dialect differences; the function lists match.

## Executed

On the local stack (`supabase` CLI 3.1.0, Postgres 17, database-only), 2026-11-16:

- `npx supabase db reset`: all 12 migrations apply.
- `npx supabase test db`: 11 files, **637 tests**, pass; run twice. Before this work: 9
  files, 409 tests.
- Before/after: at `--version 20261116023939` the new test file aborts at its first
  statement (the functions do not exist), and a hand-run probe confirmed each previously
  permitted statement in the "Before" column succeeded. After: 228 new tests pass.
- `npx supabase db lint --schema public,private --level warning --fail-on error`: no
  schema errors.
- `scripts/test-upgrade.sh`: passes ("Upgrade preserves all 30 source revisions..."). Its
  dedicated stack did not exist here; `.local-runtime/supabase/config.toml` (git-ignored)
  was created from the main config with the project id and ports changed, and a PATH shim
  mapped `supabase` to `npx supabase`. That stack was stopped afterwards.
- From `applications/web`: `npx tsc --noEmit` exit 0; `npx eslint` exit 0;
  `npx vitest run` twice, 40 files, 287 tests, pass both times; `npm run test:node`, 88
  pass.
- The reversal below, inside a transaction that was rolled back: no error, no object left.

## Not executed, not verified

- Anything hosted: the pre-check query, the migration, advisors, the canary.
- The two RPCs through PostgREST or `supabase-js`; the browser store against a real
  database or in a browser.
- A production build, the web journey scripts, the local HTTP script.
- `supabase gen types` output was compared, not adopted (see Types).
- Performance of the constraints on large tables (two immutable function calls per row
  written; a 20,000-character body runs one regular expression).

## Reversal

Before applying to hosted: delete the migration file and the two test files, revert the
two one-line test edits and the web changes. The web tolerates a database without the
RPCs, so the order does not matter.

After applying: the quick operational reversal for deletion is the switch itself
(`update private.deployment_switches set deletion_enabled=true`). To remove the rules,
ship a new migration with the statements below (the committed ledger stays the
authority; do not run it ad hoc on hosted). No data is rewritten in either direction;
names trimmed in the meantime stay trimmed, and entries dated by import keep their dates.

```sql
begin;
-- 1. Deletion RPCs back to their bodies in 20261116010931_in_app_deletion.sql (no switch).
-- (run here, as `create or replace function`, the six definitions of deletion_preview, delete_entry,
--  delete_seed, delete_plot, delete_garden and delete_account exactly as written in that file)
drop function private.require_deletion_enabled();
drop function public.garden_capabilities();
drop table private.deployment_switches;
-- 2. Import RPC and the owner's date privileges.
drop function public.import_thought(uuid,uuid,text,jsonb);
revoke insert,update on public.entries from authenticated;
grant insert,update on public.entries to authenticated;
revoke insert on public.seed_revisions from authenticated;
grant insert on public.seed_revisions to authenticated;
-- 3. Archived-place triggers.
drop trigger revisions_refuse_archived on public.seed_revisions;
drop trigger seeds_refuse_archived_parent on public.seeds;
drop function private.refuse_archived_writing();
drop function private.refuse_archived_parent();
-- 4. Constraints, name triggers and helpers.
alter table public.bloom_responses drop constraint bloom_responses_correction_rule;
alter table public.accounts drop constraint accounts_timezone_shape;
alter table public.seed_revisions drop constraint seed_revisions_body_rule;
alter table public.seeds drop constraint seeds_title_rule;
alter table public.plots drop constraint plots_name_rule;
alter table public.gardens drop constraint gardens_name_rule;
drop trigger seeds_clean_title on public.seeds;
drop trigger plots_clean_name on public.plots;
drop trigger gardens_clean_name on public.gardens;
drop function private.clean_seed_title();
drop function private.clean_area_name();
drop function private.is_calendar_date(text);
drop function private.utf16_length(text);
drop function private.trim_text(text);
commit;
```

Revert or keep the web change as preferred: with the RPCs gone it falls back to the
call-by-call import and to environment flags alone.

## Needed in files this work did not own

- `documents/DECISION_LOG.md`: record (a) both-must-allow for deployment switches and
  the new database deletion switch, (b) the database trims names, (c) blank and length
  follow JavaScript's definitions, (d) source dates are not owner-writable and import is
  an RPC, (e) writing in an archived garden is refused.
- `documents/operations/DELIVERY_2026-11-16.md` and `DELETION_2026-11-16.md`: turning
  deletion on now also needs the database switch; five migrations are pending, not four.
- `documents/operations/README.md`: link this record.
- `scripts/hosted-canary.sql`: add the capability and switch checks.
- `import-core.ts`: `runImport` is now reached only against a database without
  `import_thought`; it and the adapters can be deleted once the migration is applied.

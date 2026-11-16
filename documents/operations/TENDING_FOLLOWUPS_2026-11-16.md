# Tending follow-ups, 2026-11-16

Operator: backend engineering agent (Claude), under D-024 and D-025.
Scope: **repository and local stacks only.** Nothing hosted was contacted, no model
was called, no secret was read or written, no Git command was run. Counts, states and
codes only; no fixture text.

The final pre-apply review of the five November 16 migrations returned "safe to apply
with switches at defaults", with findings to settle before nightly tending is enabled.
They are settled in one new migration, `supabase/migrations/20261116061751_tending_followups.sql`;
the five merged files were not edited.

Related: [runbook](AI_ACTIVATION_RUNBOOK.md), [hosted apply checklist](HOSTED_APPLY_CHECKLIST.md),
[prerequisites record](ACTIVATION_PREREQUISITES_2026-11-16.md) (§9: reversal of all six),
[browser path rules](BROWSER_PATH_RULES_2026-11-16.md).

## 0. Correction: the first version of this migration failed CI

The first version (commit `5189f63`) failed GitHub's `database` job twice, although
this record then said "816 tests PASS, also under CLI 2.109.1". That claim was wrong
in substance. Section 7 has the cause, the proof and the corrected runs; the numbers
in section 4 are the corrected ones.

## 1. Findings and what was done

| # | Finding | Done | Test, seen failing first |
|---|---|---|---|
| 1 | Bloom cap was per pass: two tended topics in one garden published six in a night | Three per garden per nightly cycle, enforced where blooms are stored (section 2) | `tending_followups.sql` (one, two and three topics), `tending_followups_concurrency.sql` case 1. Before: 6 published |
| 2 | The committing procedure's first COMMIT would have happened on hosted against the owner's data | `private.run_nightly_enqueue()` refuses inside a transaction (25001) and commits once before reading its gates, so every hourly run exercises the commit from the day it is applied, with the gates closed and nothing to do. `scripts/hosted-nightly-canary.sql` (runbook 3.12) runs it for real for a synthetic tenant; `scripts/hosted-canary.sql` proves the in-transaction refusal | `tending_followups.sql`; both scripts run locally (section 4) |
| 3 | A scope of more than twenty cross-connected topics raised 23514 and stopped that account and all later ones | The scope is skipped with a note in `private.nightly_skips` (reason code, garden id, date, topic count); 23514 is handled like the other refusals; in the scheduled procedure one account's failure is noted and the run continues | `tending_followups.sql`: 21 topics; the account's other garden and the next account are still enqueued |
| 4 | `delete_account` against allowlist removal could deadlock (40P01) | `delete_account` removes its own allowlist row right after the accounts lock, the order allowlist removal uses | Concurrency case 4. Before: "deadlock detected" |
| 5a | Deleting a thought while the worker publishes marks for it could deadlock | **Fixed by order**: `finish_garden_pass` takes a key-share lock on the thoughts its marks cite before the pass inputs; `erase_garden` and `delete_plot` lock their thoughts before any pass input | Concurrency case 2. Before: the worker held the pass inputs while waiting for the thought |
| 5b | A person cancelling a pass as the worker claims it could deadlock | **Fixed by order**: a statement trigger takes the person's own active pass inputs before the pass row | Concurrency case 3. Before: the cancel held the pass row while waiting for the inputs |

Neither 5a nor 5b adds a lock to `save_entry`, `create_seed` or import. The lock the
worker takes on a thought is the one the mark's foreign key already took, a few
statements earlier in the same short transaction. Because both are fixed by order, no
new user-facing message is needed; the web's existing "busy for a moment" wording for
40P01 stays as the backstop for any pair not yet found.

## 2. Three blooms per garden per night: the definition

- **Cycle.** One garden on one night. The night is the account's local calendar date
  (`accounts.timezone`) at the moment nightly enqueue serves it, which is its 02:00
  hour (the 03:00 hour on the one night a year a zone's clocks skip 02:00). Each pass
  enqueued that night records it in `private.pass_inputs.cycle_date`, and an account is
  enqueued once per cycle date. The date comes from the moment the enqueue was given
  and the account's zone, never from the server's zone or the clock at publish time.
- **Share, decided when the passes are created.** The garden's three are shared among
  that night's passes, ordered by how much new writing each froze (most first), then
  by scope key: one pass gets 3; two get 2 and 1; three or more get 1, 1, 1 and any
  further pass 0 (`bloom_allowance`). A share that is not used is not handed on.
- **Choice inside a pass, when it returns more than its share.** Fixed, not the
  model's order: by kind (echo, pattern, change, tension, connection, question), then
  more distinct cited revisions first, then the earlier position as the last
  tie-break. Every bloom is validated before any is stored, as before.
- **Backstop.** `private.bloom_cycles` holds `published` (a check constraint keeps it
  at most 3) and `withheld` per garden and cycle. The row is locked when a pass
  publishes, so two passes finishing together are counted one after the other, and a
  nightly pass with no recorded share (one an operator created) still cannot take the
  garden past three. The count is not given back when a bloom is later withdrawn.
- **Record.** Counts only: `blooms_withheld` on the pass; `published` and `withheld`
  on the cycle.
- **Invited passes.** A reflection a person invites is its own cycle: up to three, as
  before, neither using nor limited by the night's budget. **This is a product choice
  made here and wants an owner decision in the log**: ADR-008 says "per garden per
  cycle" without defining an invited pass's cycle. The alternative, one shared budget
  per garden per day, would make an invitation after a full night return nothing.
- **Marks** are not blooms and keep their own limits.

Consequences to know: the return gets smaller, never larger (three topics each get
one, and a topic with nothing to say does not pass its share on); the kind order is a
judgement (accumulation-dependent kinds first, a question last) and is one constant in
`finish_garden_pass`.

## 3. Lock order after this migration

`public.accounts`, the account's `private.ai_tenants` row, `gardens`, `plots`, `seeds`,
`entries`, then `private.pass_inputs`, `public.garden_passes`, `private.bloom_cycles`,
`private.ai_months`.

| Path | Takes, in order |
|---|---|
| Pass creation (invited or nightly) | accounts; allowlist row (key share); topics (share); month |
| Allowlist removal | allowlist row; pass inputs; passes |
| Account deletion | accounts; allowlist row; per garden: garden, topics, thoughts, pass inputs, passes |
| Garden or topic deletion | accounts; garden or topic; thoughts; pass inputs; passes |
| Thought or entry deletion | accounts; garden, topic (share); thought; pass inputs; passes |
| Worker claim, dispatch mark, job update | pass inputs; pass |
| Worker finish | cited thoughts (key share); pass inputs; pass; cycle; month |
| Person cancels a pass | own active pass inputs; pass |

Tested with two or more real sessions: removal against pass creation (both orders);
two passes of one garden finishing together; worker finish against a held thought;
cancel against held pass inputs; account deletion against allowlist removal.
Not tested with two sessions: garden or topic deletion against worker finish under
the new thought-first order (covered by the order above, not by an executed race).

## 4. Commands run and results

Environment: cloud session, Linux, Node v22.23.4, Docker Engine 29.9.2, Supabase CLI
3.1.0 (`npx supabase`) and 2.109.1 (the version CI pins). Database tests ran in an
isolated copy of `supabase/` (project `sg-prereq`, ports 583xx); the upgrade scripts
ran in the repository's dedicated `.local-runtime` stack (`slow-garden-web-thinking`),
started by CLI 2.109.1 (Postgres 17.6).

| Command | Result |
|---|---|
| CI's exact steps, CLI 2.109.1 from a stopped stack (`supabase start` with CI's exclude list, `db lint`, `test db`), four times | Postgres 17.6 (CI's image); 13 migrations; "No schema errors found"; 14 files, **865 tests, Result: PASS**, each time, files in CI's order |
| The same with CLI 3.1.0 (`npx supabase`) | Postgres 17.11; 14 files, 865 tests, PASS; lint clean |
| Suite with the server, the worker's and the signed-in role's time zone set to `Pacific/Kiritimati` (+14, the next calendar day), `Pacific/Pago_Pago` (-11, the previous day), `America/Los_Angeles`, `Asia/Kolkata` | 865, PASS in each. (The first Kolkata run failed two assertions in `scheduling.sql` for a different reason, fixed: section 7) |
| Suite with a committed tick token left as `pg_cron` leaves one | 865, PASS |
| `supabase@2.109.1 gen types typescript --local --schema public` against `applications/web/src/types/database.ts` | identical; no public signature changed |
| `scripts/test-upgrade.sh` | exit 0: "Upgrade preserves all 30 source revisions, timestamps and IDs; latest entry and full export verified." |
| `scripts/test-upgrade-browser-path-rules.sh` | exit 0: "0 existing rows changed or rejected; legacy rows still archive, restore, revise and export; new rows of the same kinds are refused." |
| `node --test services/garden-worker/runtime.test.mjs` | tests 93, pass 93 |
| `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | `ok: true`, `content_free: true`, 24 of 24 scenarios |
| `node --test tests/evaluation/*.test.mjs` | tests 29, pass 29 |
| `npx tsc --noEmit` in `applications/web` | exit 0 |
| `scripts/hosted-canary.sql` on the local database (rewritten, section 8) | `hosted synthetic canary passed`; nothing left behind. With a deliberately broken precondition: the error, then `hosted synthetic canary FAILED`, nothing left behind |
| `scripts/hosted-nightly-canary.sql` (rewritten, section 8), Phase-3-like local state | exit 0, `hosted nightly canary passed`: 2 passes, 1 cycle date, 3 blooms allowed for the garden, 0 other tenants, switch as found; cleanup row all zeros |
| The same script against six failing preconditions or mid-script failures | exit 3 each time, a `nightly canary refused:` line, and the runtime, nightly switch, allowlist, accounts, passes and reservations exactly as before (section 8) |
| `call private.run_nightly_enqueue()` scheduled every minute by a local-only `pg_cron` job | status `succeeded`: the in-transaction check does not misfire under `pg_cron`, and the procedure commits there |
| `begin; call private.run_nightly_enqueue(); rollback;` sent as one string | Postgres's `invalid transaction termination` at the first COMMIT, before any work (the case the 25001 check cannot recognise) |
| The hosted apply checklist's POST queries, on the local database | every expected value observed (13 versions, 5 triggers, both constraints not validated, three jobs, all ledgers empty) |

Fail-first evidence: `tending_followups.sql` was run before the migration existed
(first assertion failed; the rest stopped at the missing column). The concurrency file
was run against the five-migration schema with the lines that name new columns
removed: six blooms published; the worker held the pass inputs while waiting for the
thought; the cancel held the pass row while waiting for the inputs; "deadlock
detected" on allowlist removal.

A flaw found and fixed in my own test: the first version of `tending_followups.sql`
failed about one run in three because the worker loop stopped when a finished pass
came back for cleanup. It now acknowledges the cleanup and continues; nine consecutive
runs pass.

Not executed:

- Anything hosted, including both canary scripts and the checklist.
- The web test suites (`vitest`, `scripts/test-web-journeys.mjs`,
  `scripts/test-local-http.mjs`); no web file was changed.
- The Edge Function (`index.ts`); unchanged by this work.
- A two-session race of garden or topic deletion against worker finish.

## 5. Not fixed, and left for the owner

- **Invited passes are outside the nightly budget** (section 2): decide and record.
- **Unused shares are not redistributed.** A garden with three tended topics gets at
  most one bloom from each, even if two have nothing to say.
- **A scope of more than twenty cross-connected topics is never tended.** It is noted
  every night it is skipped. Splitting such a scope is a product question.
- **`pg_net`'s grants** remain as recorded in the runbook's known gaps.
- **Withdrawn blooms do not free budget** for the same night.

## 6. Needed in files this work did not own

- `documents/DECISION_LOG.md`: the cycle definition, the share rule, the kind order,
  and the invited-pass choice.
- `documents/architecture/ADR-008_TENDING_TIERS.md`: "at most three per garden per
  cycle" now has a precise meaning; a pointer to section 2.
- `documents/operations/BROWSER_PATH_RULES_2026-11-16.md`: its two "still possible"
  deadlocks are fixed by this migration; its reversal must now come after reversing
  migration 6.
- `documents/operations/README.md`: link this record and the hosted apply checklist.
- `scripts/hosted-nightly-canary.sql` is a new file beside `hosted-canary.sql`, because
  a committing canary cannot live in a rollback-only script.

## 7. Why CI failed, and what "tested under CLI 2.109.1" has to mean

**Root cause.** `finish_garden_pass` runs as the worker's role (`service_role`,
SECURITY INVOKER). The first version of this migration made it lock `public.seeds`
and read `public.accounts` directly. No migration grants the worker's role anything on
those tables. Whether it has a privilege anyway depends on the Postgres image: the
image CLI 3.1.0 starts (17.11) leaves it one, the image CLI 2.109.1 and CI start
(17.6) does not. On CI every ingestion with marks died with
`42501: permission denied for table seeds`, and the files after it failed on what
that left behind. It was not the time of day and not test order.

**Why the earlier claim was wrong.** The earlier "PASS under 2.109.1" ran 2.109.1's
`test db` against a database that 3.1.0 had started, so it tested the newer image
with the older client. Only starting the stack with the pinned CLI reproduces CI.

**Proof.** CI's steps were run exactly (`supabase@2.109.1 start` with CI's exclude
list from a stopped stack, `db lint`, `test db`): Files=14, Tests=631, FAIL, the same
four files and the same test numbers as GitHub, with the 42501 above in the log. On
that image `has_table_privilege('service_role','public.seeds','select')` is false; on
the other it is true.

**Fix.** Ingestion reaches those two tables only through two SECURITY DEFINER
helpers scoped to the pass (`private.lock_marked_seeds`, `private.pass_local_date`),
granted to the worker's role. `tending_followups.sql` now revokes the worker's
privileges on thoughts, accounts, entries and revisions before it runs, so it proves
the same thing on either image. Whether the hosted project grants that default is
unknown and no longer matters; the checklist records it.

**Time, checked because it was the leading hypothesis.** The container's clock could
not be moved (no libfaketime in the image; moving the host clock would have affected
everything else on the machine). What was done instead:

- Every moment the new code uses is now passed in or stored, and tested explicitly:
  the tending hour for six zones through a full day, either side of UTC midnight and
  local midnight, and the night a zone's clocks skip 02:00; the cycle date either
  side of the date line; the fallback date either side of local and UTC midnight.
- The whole suite was run with the server's and roles' time zone moved by +14, -11,
  -8 and +5:30 hours, which moves every local date and local hour the database
  computes from the same instant.
- Two real time dependences were found and fixed:
  1. **"A night is tended once" compared a pass's creation time (the wall clock)
     with the moment the enqueue was given.** In production they are the same. In
     tests with fixed dates the answer depended on today's date, and
     `scheduling.sql` would have started failing on 2026-11-18. The rule is now "one
     nightly run per account per cycle date"; passes from before this migration keep
     the twenty-hour rule.
  2. **A zone whose clocks jump from 01:59 to 03:00 has no 02:00 hour that night**,
     so an account there was not tended at all one night a year (for
     `America/Los_Angeles`, 14 March 2027). The 03:00 hour now stands in on that
     night only.
- One clock-related flake in a test of mine was found and fixed: `scheduling.sql`
  counted every tick token and queued request in the database, and the real
  five-minute `pg_cron` tick can commit one while another test file's fixtures are
  committed (a file that stores a worker URL). A run that crossed a five-minute
  boundary at the wrong moment failed. Its assertions now look only at rows the
  test's own transaction wrote.

Not verified: behaviour with the container's wall clock actually set to another time.

## 8. The two canary scripts, made to fail closed

An automated review said the nightly canary, run with psql's defaults, carried on
after a refused precondition and could switch off a nightly schedule that was already
running. Verified against the first version: with the nightly switch on, it printed
its refusal, carried on, and left the switch **off**. (It could not enqueue a real
account: that step was conditional. The switch was the real damage.)

`scripts/hosted-nightly-canary.sql`, rewritten:

- psql only, `ON_ERROR_STOP` on; preconditions, the synthetic account, the allowlist
  row, the opening of the nightly switch and the proof that the synthetic account is
  the only one nightly enqueue could reach are one transaction, so a failure there
  changes nothing;
- it changes one setting and puts back exactly the value it found, as the very next
  statement after the committing call, whether that call succeeded or not;
- it deletes only rows it created, and exits non-zero unless the verdict is "passed"
  and cleanup is complete.

Failure paths run locally, each ending with exit 3 and the database unchanged: nightly
switch already on (left on); runtime off; allowlist not empty; no worker URL; a
collision part-way through creating the synthetic account; the synthetic account not
being the only one reachable. What cannot be wrapped: the committing call and the
restore after it. If the connection is lost between them the switch is left on with
only the synthetic account allowlisted; the script's header says what to do.

`scripts/hosted-canary.sql`, rewritten: it used to rely on the client keeping
`BEGIN … ROLLBACK` as one session, and with psql's defaults it printed its closing
line even after an error. Every write now happens inside one statement, in a block
that always undoes itself, so nothing is kept whatever the client does with
transactions, and the result row reads `passed` only if every check ran, `FAILED`
otherwise. It has no psql meta-commands, so it still runs through a SQL tool.

`HOSTED_APPLY_CHECKLIST.md`: every PRE and POST query is now read-only. POST 6 used
to call `private.tick_garden_worker()`, which issues a token and queues a request when
there is work; it is replaced by counts. The runbook's 2.0a and 2.6 were changed the
same way.

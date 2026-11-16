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
  hour. Each pass enqueued that night records it in `private.pass_inputs.cycle_date`.
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
ran in the repository's dedicated `.local-runtime` stack (`slow-garden-web-thinking`).

| Command | Result |
|---|---|
| `npx supabase db reset` | 13 migrations applied in order, through `20261116061751_tending_followups.sql` |
| `npx supabase test db`, twice, then eight more times after a test fix (below) | 14 files, **816 tests, Result: PASS** on the first two runs and on all eight after the fix; three of six runs in between failed on that test flaw (before this migration: 12 files, 743). Also PASS under CLI 2.109.1 |
| `npx supabase db lint --schema public,private --level warning --fail-on error` | "No schema errors found" |
| `supabase@2.109.1 gen types typescript --local --schema public` against `applications/web/src/types/database.ts` | identical; no public signature changed |
| `scripts/test-upgrade.sh` | exit 0: "Upgrade preserves all 30 source revisions, timestamps and IDs; latest entry and full export verified." |
| `scripts/test-upgrade-browser-path-rules.sh` | exit 0: "0 existing rows changed or rejected; legacy rows still archive, restore, revise and export; new rows of the same kinds are refused." |
| `node --test services/garden-worker/runtime.test.mjs` | tests 93, pass 93 |
| `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | `ok: true`, `content_free: true`, 24 of 24 scenarios |
| `node --test tests/evaluation/*.test.mjs` | tests 29, pass 29 |
| `npx tsc --noEmit` in `applications/web` | exit 0 |
| `scripts/hosted-canary.sql` on the local database | `hosted synthetic canary passed`; nothing left behind |
| `scripts/hosted-nightly-canary.sql`, preconditions unmet (fresh database) | refused at step 1 with the reason; result row `FAILED` with all counts 0; nothing created; switch off |
| `scripts/hosted-nightly-canary.sql`, Phase-3-like local state | `hosted nightly canary passed`: 2 passes, 1 cycle date, 3 blooms allowed for the garden, 0 other tenants, 0 skips, switch off; cleanup row all zeros |
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

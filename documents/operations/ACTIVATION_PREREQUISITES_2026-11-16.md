# Activation prerequisites built, 2026-11-16

Operator: backend engineering agent (Claude), under D-024 and D-025 ("Activation: not
ready. Remaining … an evaluation receipt with a pinned model, an owner-only guard on
pass creation, and a decision on moving the worker off the batch route").
Scope: **repository and local stack only.** No Supabase, Vercel, OpenAI or other hosted
system was contacted, no MCP cloud tool was used, no secret was read or written, no
model was called, no Git command was run. This record holds commands, states, counts
and hashes only: no fixture text, note bodies, bloom prose or provider bodies.

Follows the [status review](ACTIVATION_STATUS_2026-11-16.md); the
[runbook](AI_ACTIVATION_RUNBOOK.md) was revised with it.

**Revised the same day after an independent review (APPLY AFTER FIXES, eight
findings).** The migration files were edited in place (nothing had been applied
anywhere). Section 10 lists each finding, the fix and its test. Where sections 2 to 5
describe behaviour, they describe the revised code.

## 1. What was built

| # | Prerequisite | Where | State |
|---|---|---|---|
| 1 | Owner-only allowlist `private.ai_tenants`, enforced at pass creation, nightly enqueue, claim and publish; removal cancels active passes | `supabase/migrations/20261116023935_ai_tenant_allowlist.sql`, `supabase/tests/ai_allowlist.sql`, `supabase/tests/ai_allowlist_concurrency.sql`, `scripts/hosted-canary.sql` | Built, tested locally. Not applied hosted. |
| 2 | Second provider transport (`sync`) behind `private.ai_runtime.transport` (default `batch`), pinned `reasoning_effort`, dispatch ledger `public.mark_garden_dispatch` | `supabase/migrations/20261116023937_provider_transport.sql`, `supabase/tests/sync_transport.sql`, `supabase/functions/_shared/garden-runtime.mjs`, `supabase/functions/garden-worker/index.ts` (comment only), `services/garden-worker/runtime.test.mjs`, `scripts/canary-dry-run.mjs`, `applications/web/src/types/database.ts` (one RPC added) | Built, tested locally against fakes. Never run against a provider or a deployed function. |
| 3 | Scheduling: `pg_cron` + `pg_net` + Vault, worker tick and nightly enqueue behind separate gates | `supabase/migrations/20261116023939_garden_scheduling.sql`, `supabase/tests/scheduling.sql` | Built, tested locally. No request left the database. |
| 4 | Evaluation receipt tool and one-command run | `services/garden-worker/evaluation/receipt.mjs`, `run-model.mjs`, `tests/evaluation/receipt.test.mjs`, evaluation README | Built, self-tested offline on recorded synthetic outputs. No real receipt exists. |
| 5 | Runbook revision | `documents/operations/AI_ACTIVATION_RUNBOOK.md`, worker README | Done. |

Existing test files `thinking_garden.sql`, `tending.sql`, `deletion.sql` and
`deletion_concurrency.sql` each gained one statement that allowlists their synthetic
accounts; without it they fail, which is the guard working.

## 2. Design decisions made here (reversible; for the decision log)

1. **Allowlist as its own trigger and table**, not a rewrite of `private.prepare_pass`.
   `passes_allowlist` fires before `passes_prepare`; while the runtime is off it stays
   silent so the existing refusal is unchanged. The user-facing refusal is SQLSTATE
   55000, "tending is not available for this account yet", which the web already maps
   to its generic "try again later" copy.
2. **Removal from the allowlist drains.** Deleting a row cancels that account's queued
   and in-flight passes through the existing cleanup path, so nothing is stranded.
3. **Transport and reasoning effort are frozen per pass**, like model and rates. With
   no effort pinned the request is byte-identical to before.
4. **Sync dispatches are recorded in the ledger**, limited in provider calls: at most
   four per pass, so a two-stage pass gets one retry (the first version allowed three
   dispatches, which was six calls for a staged pass). A dispatch that never reports
   back is booked at the full reservation before the next one, and the hard cap can
   refuse it. A provider refusal is closed uncharged. Nothing sent means nothing
   charged, for both transports.
5. **A stage that times out discards the whole dispatch** (the other stage's answer is
   dropped), because its usage is unknown. A stage the provider refused with an HTTP
   status behaves as in batch: the other stage may still land.
6. **One scheduling migration with two gates**, not two migrations with one held back.
   The status review proposed holding the nightly job in a second, later migration. A
   committed but unapplied migration would leave `supabase db push --dry-run` out of
   step from Phase 3 to Phase 4b (SUPABASE_CHANGE_WORKFLOW step 8), so the nightly job
   has its own switch instead: `private.ai_runtime.nightly_enabled`, default false.
7. **The worker tick posts only when there is work**, and keeps posting after the
   runtime is disabled while cleanup or orphans are owed. The brief asked for null when
   disabled; with cleanup owed that would strand late cancellations, so this one case
   differs, and it is tested. With nothing owed, disabled returns null.
8. **No secret travels through `pg_net`.** The tick refuses a plain-http URL, uses a
   140-second request timeout, and authenticates with a single-use token (two-minute
   life, only its SHA-256 stored) that the worker redeems once. `GARDEN_WORKER_SECRET`
   stays in the worker's function secrets for the operator's manual POSTs and is never
   in the database. Reason: `pg_net`'s queue is readable by every role and the
   migration role cannot revoke that (section 10, finding 2).
9. **connect-v2 parsing now ignores reasoning metadata**, as tend-connect-v3 has since
   November 2. Without it any reasoning model fails every connect-v2 pass.
10. **`private.keep_provider_orphan` charges a deleted, unsettled sync pass** when a
    dispatch was recorded (it had no provider id to key on).
11. **The receipt treats a dropped mark as a failure of "100% valid source handles"**,
    by the letter of EVALUATION_ARCHITECTURE. November 2 saw two dropped marks, so this
    is an owner decision (runbook decision 8), not a settled reading.
12. **A self-test receipt can never be `go`**, and a receipt goes stale when any
    prompt, schema, the corpus or the shared runtime file changes.

Left to the owner: runbook "Owner decisions" 1–10 (model snapshot, reasoning effort,
caps and rates, transport, scheduler, 3.10, the form of the 0.4 receipt, dropped marks,
web flag, security gaps). Nothing here chooses a model, a vendor or a transport: the
default is still `batch`, the allowlist is empty and the nightly switch is off.

## 3. Sync transport: failure modes and where each is covered

| Failure mode | Behaviour | Runtime test | Canary scenario | SQL test |
|---|---|---|---|---|
| Timeout mid-call | dispatch left open, lease released, retried; lost call booked at the reservation on redispatch | yes | `sync_timeout_mid_call`, `sync_timeouts_exhaust_call_limit`, `sync_staged_call_limit` | `sync_transport.sql` |
| Lease lost after the provider answered | nothing stored, no further write; redispatch books the lost call | yes | `sync_lease_lost_after_answer` | lease check |
| Duplicate invocation | second worker is not handed the leased pass; one provider call | partial (idle path) | `sync_duplicate_invocation` | claim under lease is null, before and during the call |
| Budget stop | a redispatch that would cross the hard cap is refused; pass fails | yes | `sync_budget_stop` | yes |
| Cancel while in flight | answer discarded, only its cost recorded, status stays cancelled | yes | `sync_cancel_in_flight` | `inactive` after cancel |
| Provider error | 429/5xx: closed uncharged and retried, up to five attempts; other statuses fail the pass | yes | `sync_provider_error` | `closed` path |
| Oversized snapshot | failed before any dispatch (200 KB per stage request; the database already rejects snapshots over 100 KB) | yes | `sync_oversized_snapshot` | — |
| Edge Function time limit | call 90 s, lease 120 s, invocation 140 s; too little time left defers without dispatching | yes | `sync_function_time_limit` | lease length |
| Invalid output or tool call | pass fails, usage still recorded | yes | — | existing finalizer tests |

**Assumption, not verified:** an Edge Function must answer within 150 seconds. No copy
of Supabase's Edge Function limits exists in this repository (the only Supabase text
here is the search-summary evidence in PRIVACY_ARCHITECTURE_OPTIONS), and hosted
documentation was out of scope for this session. If the real limit is lower than 140
seconds, lower `syncLimits` and the 120-second lease in `mark_garden_dispatch`
together. Also not verified: whether a function keeps running after pg_net's request
times out, how long a pinned model takes on a 100 KB snapshot, and whether the provider
honours `Idempotency-Key` on Responses calls.

## 4. Cost of leaving Batch

Formula and scenarios from COST_AND_CAPACITY.md. That document does not state the
Batch discount; **50% is assumed here and is not verified** (the status review also
records Batch pricing as unverified). Standard rates are what a synchronous call pays.

| Scenario | Rates (per million, input / output) | Sync per month | Batch per month (assumed 50%) | Difference |
|---|---|---:|---:|---:|
| Kyle expected: 22 passes, 15,000 / 2,000 tokens | $0.75 / $4.50 (planning rates) | $0.45 | $0.22 | $0.22 |
| Alpha stress: 87 passes, 50,000 / 4,000 tokens | $0.75 / $4.50 | $4.83 | $2.41 | $2.41 |
| Kyle expected | $2 / $10 (rates recorded November 2) | $1.10 | $0.55 | $0.55 |
| Alpha stress | $2 / $10 | $12.18 | $6.09 | $6.09 |
| Observed: 30 passes at 0.8804 cents (the one real pass, November 2) | $2 / $10 | $0.26 | $0.13 | $0.13 |

At owner scale the discount is worth well under a dollar a month, against a $10 soft
cap. The one row that matters later: alpha stress on the November 2 rates would cross
the $10 soft cap on sync and not on batch. The transport is a setting, so that choice
can be revisited with an external pilot. Sync's conservative booking of lost calls can
make the ledger read higher than the invoice; it cannot make it read lower.

## 5. Commands run and results

Environment: cloud session, Linux, Node v22.23.4, Docker Engine 29.9.2. Supabase CLI
3.1.0 (what `npx supabase` resolves today) and, for the checks CI pins, 2.109.1.
The database ran as an isolated copy of `supabase/` (project id `sg-prereq`, ports
583xx, images from `docker.io`) so it could not collide with other engineers' stacks;
the copy was refreshed from the working tree before every run. Database-only stack,
same `--exclude` list as CI.

| Command | Result |
|---|---|
| `npx supabase db reset` | 11 migrations applied in order, through `20261116023939_garden_scheduling.sql`; exit 0 |
| `npx supabase test db` | 9 files, **406 tests, Result: PASS** (before this work: 5 files, 261; first version: 8 files, 358). Same result with CLI 2.109.1 |
| `npx supabase db lint --schema public,private --level warning --fail-on error` | "No schema errors found" (3.1.0 and 2.109.1) |
| `supabase@2.109.1 gen types typescript --local --schema public`, diffed with `applications/web/src/types/database.ts` | identical |
| `node --test services/garden-worker/runtime.test.mjs` | tests 93, pass 93, fail 0 (before: 42; first version: 70) |
| `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | exit 0; `ok: true`; `content_free: true`; scenarios 24, passed 24 (before: 8; first version: 20); provider counts: uploads 8, batches 9, sync calls 25, cancels 2, downloads 5, deletes 21, `files_remaining: 0` |
| `node --test tests/evaluation/*.test.mjs` | tests 25, pass 25, fail 0 (before: 16) |
| `node services/garden-worker/evaluation/evaluate-v3.mjs` | 30 cases, 24/30 rejected outputs refused by validators, 6 left to human review, ok |
| `npx tsc --noEmit` in `applications/web` | exit 0 |
| `npm run test:node` in `applications/web` (the CI command that includes `tests/**`) | tests 84, pass 84, fail 0 |
| `psql -f scripts/hosted-canary.sql` against the local database | returned `hosted synthetic canary passed`; afterwards 0 users, runtime disabled, 0 budget rows |
| Local cron | `slow-garden-worker` ran on schedule with status `succeeded`; `net._http_response` held 0 rows (nothing was sent) |

Fail-before evidence:

- `ai_allowlist.sql` was run against the database before the migrations: it stopped at
  its third assertion (`private.ai_tenants` does not exist).
- The new runtime tests and the extended canary were run against the previous
  `garden-runtime.mjs`: both fail to load (`syncLimits` is not exported).
- `sync_transport.sql` and `scheduling.sql` were **not** run against the old schema.
  They reference columns, functions and cron jobs that only the new migrations create.
- That the four existing database test files fail on the new schema without their
  allowlist line follows from the trigger; it was not separately executed.

Not executed, stated plainly:

- Anything hosted: no migration applied, no function deployed, no Vault secret stored,
  no provider call, no real evaluation run. `run-model.mjs` was executed end to end only
  with the provider replaced by recorded synthetic outputs (the self-test).
- The Edge Function itself (`index.ts`) was not served or type-checked: no Deno is
  installed and the function was not started locally. Its only change is a comment.
- `pg_net` never sent a request. The tests check the queued request's URL, header,
  body and timeout, then roll back. Delivery, the worker's answer and pg_net's
  behaviour on a long call are unverified.
- Vault was exercised only inside rolled-back test transactions.
- `scripts/test-web-journeys.mjs`, `scripts/test-local-http.mjs`, `scripts/test-upgrade.sh`
  and the web `vitest` suite were not run.
- `/Users/kylematthies/Code/bin/workspace-guard` (AGENTS.md) does not exist in this
  environment. Changes were limited to the files listed in section 1.
- The CLI tried to send its own usage telemetry and the session's network policy
  refused it; nothing about the project was sent.

Local side effect: the isolated stack was stopped with `--no-backup` at the end of the
session. The Docker daemon was already running and was left as found.

Review reproductions rerun after the fixes: the reviewer's `leak.mjs` now reports
`"connect":"invalid_json"` and no answer text; six cancelled, never-dispatched passes
settle at 0 cents (the reviewer measured 80 cents for five).

## 6. Hashes for whoever writes the 0.4 receipt

Recompute at evaluation time; `receipt.mjs` does this and marks a receipt stale on any
difference. `garden-runtime.mjs` changed today, so `runtime_sha256` is new; prompts,
schemas and the corpus were not changed by this work (the values in the status review
§2 still hold).

## 7. Hosted steps that remain, in order

| # | Step | Who | Evidence |
|---|---|---|---|
| 1 | Record the owner decisions (runbook top) in the decision log | Owner | Decision entries |
| 2 | 1.1 provider terms read directly for the chosen transport; 1.2 dedicated project and spend limit | Owner | Dates, URLs, figures |
| 3 | 0.4: the one command, blind scoring, acceptance; copy `receipt.json` into a dated record | Owner (key in the owner's terminal), or an agent given a key for that session | `receipt.json` with `verdict: "go"` |
| 4 | Merge with green CI; rerun 0.1, 0.2, 0.6 on the merged tree | Engineers / agent | CI run |
| 5 | Apply the four November 16 migrations, in order, each on its own go; advisors; `scripts/hosted-canary.sql`; runbook 2.0, 2.0a | Agent with the project-scoped connection, on owner go | Ledger rows, read-backs |
| 6 | 1.3, 1.4: rotate the provider key, set both function secrets | Owner | Secret names only |
| 7 | 2.1–2.5 deploy and probe the worker; 2.6 store the worker URL in Vault; 2.7 record pg_net's grants | Agent deploys; owner holds the worker secret (function secrets only) | Status codes, log check |
| 8 | Phase 3 with a synthetic account allowlisted: 3.0–3.11 for the pinned transport; drain; disable; empty the allowlist; delete the synthetic account | Agent, owner watching the provider console | Canary receipts |
| 9 | Phase 4: allowlist the owner, enable, web flag, one invited reflection, receipt | Owner in the product; agent for counts | Activation receipt |
| 10 | Phase 4b: `nightly_enabled=true`, observe one night, receipt; weekly checks | Agent on owner go; owner in the morning | Nightly receipt |

## 8. Needed outside the files this work owned

- `documents/DECISION_LOG.md`: an entry for section 2 and for whichever owner decisions
  are taken. Not edited here.
- `applications/web/src/app/garden/actions.ts`: `inviteReflection` maps every 55000 to
  one message. A dedicated line for "tending is not available for this account yet"
  would be clearer once the web flag is on for a deployment that has accounts which are
  not allowlisted. Also the `level-returns.tsx` "no AI has read your writing" copy noted
  in the status review.
- `supabase/config.toml` has no `[functions.garden-worker]` block, so JWT verification
  must be disabled with the deploy flag (runbook 2.1).
- `documents/architecture/ADR-008_TENDING_TIERS.md` still names Batch as the unchanged
  adapter, and `COST_AND_CAPACITY.md` does not state the Batch discount or today's
  rates. If the owner chooses `sync`, both want a line.
- `documents/operations/README.md` index: add this record.

## 9. Reversal of the seven November 16 migrations

None is applied anywhere, so today reversal is "do not apply". After a hosted apply,
reverse **the latest first**: each later migration replaces functions and depends on
tables and columns of the earlier ones, so an earlier one cannot be removed while a
later one is in place. Run as the operator, with `private.ai_runtime.enabled=false`,
`nightly_enabled=false`, `deletion_enabled=false` and the queues drained (runbook
Rollback), and ship each reversal as a new reviewed migration, not ad hoc. No step
touches a person's writing, and none restores anything a person deleted.

Order: 7, 6, 5, 4, 3, 2, 1.

**7. `20261116080454_tending_lock_and_cycle_fixes`** (only with `private.bloom_cycles`
empty or expendable: its key changes back, and passes lose their link to a cycle)

```sql
drop trigger seeds_account_first on public.seeds;
drop trigger entries_account_first on public.entries;
drop function private.lock_account_first();
drop trigger passes_lock_inputs_first on public.garden_passes;
create trigger passes_lock_inputs_first before update on public.garden_passes
  for each statement execute function private.lock_own_pass_inputs();
-- re-create, from the files named:
--   public.save_entry, public.import_thought          20261116041903_browser_path_rules.sql
--   public.finish_garden_pass, private.enqueue_nightly_for,
--   private.run_nightly_enqueue                        20261116061751_tending_followups.sql
drop function private.pass_cycle(uuid), private.garden_cycle_near(uuid,timestamptz,uuid[]);
alter table private.nightly_skips drop constraint nightly_skips_garden_fkey;
drop index private.nightly_skips_garden_idx;
alter table private.pass_inputs drop column cycle_id;
delete from private.bloom_cycles a using private.bloom_cycles b
  where a.garden_id=b.garden_id and a.cycle_date=b.cycle_date and a.id<b.id;   -- the old key allows one row per garden and date
alter table private.bloom_cycles drop constraint bloom_cycles_pkey, drop column id, drop column started_at,
  add primary key(garden_id,cycle_date);
```

Effect: a time-zone change across the date line can again reopen a garden's night;
a save can again wait behind the worker; the archive and topic-change deadlocks
return. Do not run nightly tending without it.

**6. `20261116061751_tending_followups`**

```sql
drop trigger passes_lock_inputs_first on public.garden_passes;
drop function private.lock_own_pass_inputs();
-- re-create, from the files named:
--   public.finish_garden_pass                         20261116023937_provider_transport.sql
--   private.enqueue_nightly_for, private.run_nightly_enqueue,
--   private.erase_garden, public.delete_plot, public.delete_account
--                                                     20261116041903_browser_path_rules.sql
--   private.nightly_accounts                          20261116041903_browser_path_rules.sql
drop function private.lock_marked_seeds(uuid,jsonb), private.pass_local_date(uuid), private.is_tending_hour(timestamptz,text);
drop table private.nightly_skips, private.bloom_cycles;
alter table private.pass_inputs drop column cycle_date, drop column bloom_allowance, drop column blooms_withheld;
```

Effect: the bloom cap is per pass again (a garden with two tended topics can publish
six in a night), and the four lock orders this migration made consistent revert. Do
not run nightly tending without it.

**5. `20261116041903_browser_path_rules`**: the full statement list is in
[BROWSER_PATH_RULES_2026-11-16.md](BROWSER_PATH_RULES_2026-11-16.md), "Reversal". It
re-points `slow-garden-nightly` at `select private.tick_nightly_enqueue()` and
restores `prepare_pass`, the invalidation triggers, `erase_garden`, the deletion RPCs
and `enqueue_nightly_passes` from migrations 1 to 4. Keep `deletion_enabled=false`
until it is done: once the switch table is gone the deletion RPCs have no database
switch, so `GARDEN_DELETION_ENABLED` must already be off in the web deployment.

**4. `20261116023939_garden_scheduling`**

```sql
select cron.unschedule('slow-garden-worker');
select cron.unschedule('slow-garden-nightly');
select cron.unschedule('slow-garden-cron-prune');
drop function private.tick_nightly_enqueue(timestamptz), private.tick_garden_worker(),
  private.garden_worker_url(), public.consume_worker_tick(text);
drop table private.worker_ticks;
alter table private.ai_runtime drop column nightly_enabled;
-- delete the Vault entry garden_worker_url; leave pg_cron and pg_net installed
```

(Migration 5's `private.nightly_gates_open()` and `private.run_nightly_enqueue()` use
`garden_worker_url()` and `nightly_enabled`; they are gone after step 5.)

**3. `20261116023937_provider_transport`** (only with no sync pass unsettled:
`select count(*) from private.pass_inputs where transport='sync' and actual_cents is null` is 0):

```sql
update private.ai_runtime set transport='batch';
drop trigger pass_inputs_freeze_runtime on private.pass_inputs;
drop function private.freeze_pass_runtime(), public.mark_garden_dispatch(uuid,uuid,boolean,integer);
-- re-create claim_garden_pass from 20261116023935 and keep_provider_orphan from
-- 20261116010931 (both reference the columns below); re-create finish_garden_pass
-- from 20261010004736_tending_tiers.sql with its lease line changed to
--   j.lease_until is null or j.lease_until<=now()
-- (do not bring the NULL-unsafe lease check back). Only then:
alter table private.pass_inputs drop column transport, drop column reasoning_effort,
  drop column dispatches, drop column provider_calls, drop column dispatch_open, drop column lost_cents;
alter table private.ai_runtime drop column transport, drop column reasoning_effort;
```

An older worker build keeps working against the new schema (`batch` passes need no
new RPC), so the worker can be rolled back independently.

**2. `20261116023935_ai_tenant_allowlist`** (this removes the owner-only guard: only
with `private.ai_runtime.enabled=false`, and leave it false):

```sql
drop trigger passes_allowlist on public.garden_passes;
drop trigger ai_tenants_removed on private.ai_tenants;
drop trigger ai_tenants_no_reassign on private.ai_tenants;
drop trigger ai_tenants_no_truncate on private.ai_tenants;
-- re-create claim_garden_pass, check_garden_pass and enqueue_nightly_passes from
-- 20261010004736_tending_tiers.sql and 20260907004656_manual_garden_passes.sql, then:
drop function private.require_ai_tenant(), private.cancel_removed_ai_tenant(), private.refuse_ai_tenant_change();
drop table private.ai_tenants;
```

**1. `20261116010931_in_app_deletion`**: see
[DELETION_2026-11-16.md](DELETION_2026-11-16.md), "Reversing this migration". Do not
drop `private.provider_orphans` while it has rows, nor the `pass_inputs_keep_orphan`
trigger while any path can delete a pass.

Concurrency notes (the complete order after migration 6 is in
[TENDING_FOLLOWUPS_2026-11-16.md](TENDING_FOLLOWUPS_2026-11-16.md)). Pass creation locks `public.accounts` (for update), then the
tenant's `private.ai_tenants` row (for key share); allowlist removal locks that row,
then `private.pass_inputs`, then `public.garden_passes`; account deletion locks
`public.accounts` first and reaches the allowlist row by cascade. No two of these take
the same pair in opposite order. `mark_garden_dispatch` locks `private.pass_inputs`
then `private.ai_months`; `finish_garden_pass` locks `private.pass_inputs`,
`public.garden_passes`, then `private.ai_months`. Tested with two sessions:
removal against pass creation, both orders (`ai_allowlist_concurrency.sql`). Not tested
with two sessions: account deletion against pass creation under the new lock, and two
workers calling `mark_garden_dispatch` for one pass (the lease makes the second raise).

## 10. Review findings and what was done

| # | Finding | Fix | Test (failed before the fix) |
|---|---|---|---|
| 1 | A malformed provider answer put model text into the worker's response via a parser message | Stage outcomes are fixed codes (`invalid_json`, …); every result passes a `report` filter that keeps only known codes; `index.ts` logs nothing and never passes ledger error text on; `run-model.mjs` records codes | Runtime: ten sentinel tests (five malformed answers, both transports) assert no provider or source text in the response, any ledger argument or any console call; filter and code tests; canary `malformed_answer_reports_codes_only` |
| 2 | `anon` and `authenticated` can read `pg_net`'s queue and so the worker secret | **Could not be revoked**: those grants are made by the extension owner, and the migration role's `REVOKE` is a no-op (observed locally: "no privileges could be revoked"). `pg_net` 0.20.4 has no way to reference a Vault secret. So the secret no longer travels through `pg_net` or lives in the database at all: single-use tick tokens instead | `scheduling.sql`: the queued header is a tick token; only its hash is stored; redeemable once, not after expiry, not by `anon`/`authenticated`; no `garden_worker_secret` in Vault. Runtime: `authorizeWorker` |
| 3 | A pass committing after allowlist removal was stranded; `UPDATE tenant_id` and `TRUNCATE` bypassed the removal trigger | Pass creation takes `FOR KEY SHARE` on the allowlist row (after the accounts lock); reassigning a row and `TRUNCATE` are refused; the service role holds only select, insert, delete | `ai_allowlist_concurrency.sql` (two sessions, both orders; 7 of 12 assertions failed before); `ai_allowlist.sql` |
| 4 | With the runtime off, a released in-flight pass made the tick post forever | The tick counts `cleanup_pending` only for finished passes, and active passes only for allowlisted accounts | `scheduling.sql`: disabled + released in-flight pass sends nothing and queues nothing |
| 5 | Passes that never reached the provider were charged their full reservation | One cost rule in `finish_garden_pass` and `keep_provider_orphan`: nothing sent, nothing charged; a permanent refusal closes its dispatch before failing. Caps re-derived (runbook "Caps and reservations": soft 500 / hard 1000 at 200/1000 rates). Nightly enqueue now also stops at the soft cap, which COST_AND_CAPACITY requires and nothing enforced | `sync_transport.sql` (three zero-cost cases), `thinking_garden.sql` (batch), `scheduling.sql` (soft cap), runtime and canary |
| 6 | `lease_until < now()` is NULL when a lease was released, so a stale token could cancel a live pass | NULL-safe check in `finish_garden_pass` (replaced in the transport migration; the applied tending-tiers file is untouched) and `mark_garden_dispatch` | `sync_transport.sql`: a released token can neither dispatch nor settle; the pass stays `processing` |
| 7 | "Three dispatches" was six provider calls for a staged pass, and a failing `finish` caused a paid redispatch | Limit is four provider calls, enforced in the ledger (`p_calls`, `provider_calls`); a ledger failure after the answer is retried from memory three times, then settled as failed at real cost | `sync_transport.sql`; runtime (retry from memory, ledger keeps refusing, calls reported); canary `sync_staged_call_limit`, `sync_ledger_refuses_answer` |
| 8 | The `store:false` test was tautological | One builder sets the flag; `sendable` is checked before dispatch (fail closed, `unsafe_request`), before a batch upload, and again in the adapter before the network | Runtime: all five request shapes; the bodies that actually leave the worker in both workflows; adapter refuses without touching the network; injected broken builder |

Could not be fixed or verified here:

- **`pg_net`'s grants** (finding 2). Not revocable from a migration; hosted layout not
  checked. A role with a way to run SQL can still read a tick token in the instant
  before it is sent, read the worker's content-free responses, and call
  `net.http_post`. Runbook 2.7 records the hosted state; closing it needs the
  extension owner.
- **`index.ts`** now also authorises tick tokens. Its logic is in `authorizeWorker`,
  which is tested, but the function file itself was still not executed (no Deno).
- **Batch path:** a ledger write that keeps failing after a batch completes is still
  retried on later ticks (no provider cost, bounded by the 30-hour deadline). Only the
  sync path settles it as failed.
- **A worker process killed mid-call** still leads to one more dispatch, inside the
  four-call limit and booked at the reservation.
- **Finding 4, second half:** with the runtime off, an in-flight pass is not resolved
  by anything until the runtime is on again or the pass is cancelled (the documented
  drain-first order). The tick no longer posts for it.

## 11. Two automated review claims on the pull request (both real, both fixed)

| Claim | Verified | Fix | Test (failed first) |
|---|---|---|---|
| A. A run that returns no blooms could get a `go` receipt with pattern precision, claim faithfulness, echo precision and question grounding never measured | Real: reproduced, verdict `go` with nothing open | A threshold with nothing to score is `not-measured`, never a pass; it is listed in `open` and in a new `not_measured` field, and the verdict is `no-go`. Statuses are now exactly `pass`, `fail`, `not-measured`, `awaiting-blind-score`. `corpusCoverage` checks that the corpus's reference answers exercise every threshold, and a receipt on a corpus that does not cannot be `go` | `tests/evaluation/receipt.test.mjs`: four new tests (29 in the folder) |
| B. An enqueue run that crossed the soft cap kept creating automatic passes | Real: with two scopes waiting one cent under the cap, both were created | The soft cap is re-read before every automatic pass. The pass that crosses it is allowed; the run stops there. The read is deliberately not `FOR UPDATE`: holding the month's row across tenants would invert `prepare_pass`'s lock order (accounts, then month) and could deadlock with an invited pass; a concurrent session can only add an invited pass, which the soft cap does not restrict | `supabase/tests/scheduling.sql`: four assertions (409 database tests) |

Zero-denominator check on the other metrics: the deterministic and reference
thresholds already reported `not-measured` for an empty denominator, and that was
already a `no-go`. The current corpus exercises every threshold, some thinly (one
reference item each for unfinished marks, open questions and questions).

Rerun after these fixes: `db reset` 11 migrations; `test db` 9 files, 409 tests, PASS;
`db lint` clean; runtime 93/93; tests/evaluation 29/29; canary 24/24.

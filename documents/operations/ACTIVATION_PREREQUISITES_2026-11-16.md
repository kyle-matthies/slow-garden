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

## 1. What was built

| # | Prerequisite | Where | State |
|---|---|---|---|
| 1 | Owner-only allowlist `private.ai_tenants`, enforced at pass creation, nightly enqueue, claim and publish; removal cancels active passes | `supabase/migrations/20261116023935_ai_tenant_allowlist.sql`, `supabase/tests/ai_allowlist.sql`, `scripts/hosted-canary.sql` | Built, tested locally. Not applied hosted. |
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
4. **Sync dispatches are recorded in the ledger**, at most three per pass. A dispatch
   that never reports back is booked at the full reservation before the next one, and
   the hard cap can refuse it. A provider refusal is closed uncharged. This is
   deliberately conservative: it over-states spend rather than under-states it.
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
8. **The tick refuses a plain-http URL or a secret under 32 characters**, and uses a
   140-second request timeout so it outlasts a synchronous call.
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
| Timeout mid-call | dispatch left open, lease released, retried; lost call booked at the reservation on redispatch | yes | `sync_timeout_mid_call`, `sync_timeouts_exhaust_dispatch_limit` | `sync_transport.sql` |
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
| `npx supabase test db` | 8 files, **358 tests, Result: PASS** (before this work: 5 files, 261 tests). Same result with CLI 2.109.1 |
| `npx supabase db lint --schema public,private --level warning --fail-on error` | "No schema errors found" (3.1.0 and 2.109.1) |
| `supabase@2.109.1 gen types typescript --local --schema public`, diffed with `applications/web/src/types/database.ts` | identical |
| `node --test services/garden-worker/runtime.test.mjs` | tests 70, pass 70, fail 0 (before: 42) |
| `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | exit 0; `ok: true`; `content_free: true`; scenarios 20, passed 20 (before: 8); provider counts: uploads 8, batches 9, sync calls 17, cancels 2, downloads 5, deletes 21, `files_remaining: 0` |
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
| 7 | 2.1–2.5 deploy and probe the worker; 2.6 store the two Vault secrets | Agent deploys; owner holds and types the secret | Status codes, log check |
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

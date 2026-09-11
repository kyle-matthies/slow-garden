# AI activation runbook

Status: Draft; no gate below has a hosted receipt yet
Owner: Kyle
Applies to: `supabase/functions/garden-worker`, `private.ai_runtime`, `GARDEN_AI_ENABLED`
Related: [worker README](../../services/garden-worker/README.md),
[initiative record](../initiatives/05-activation-readiness.md),
[delivery record](WEB_DOGFOOD_DELIVERY.md), ADR-006

This runbook is the only sanctioned path for turning the manual reflection runtime on.
It is deliberately slow. Every check is go/no-go: a single **no-go** stops activation,
and nothing in this document may be skipped because a previous run passed. Activation
is reversible at every step; see [Rollback](#rollback).

The runtime is off today (`private.ai_runtime.enabled=false`, `GARDEN_AI_ENABLED=false`).
Executing this runbook is a product decision recorded in `documents/DECISION_LOG.md`
first, not an operational convenience.

## Roles and evidence

- **Operator:** the person running the steps. Only Kyle for the dogfood phase.
- **Receipt:** a dated note in the initiative record or delivery record naming the
  command, the environment, the observed result, and who observed it. Receipts never
  contain note bodies, bloom prose, email addresses, or provider error bodies.
- **Synthetic tenant:** a test account whose content is entirely made up. Real gardens
  are never used as canaries.

## Phase 0 — Preconditions (offline, repeatable)

| # | Check | Command / source | Go | No-go |
|---|---|---|---|---|
| 0.1 | Worker runtime tests pass | `node --test services/garden-worker/runtime.test.mjs` | all tests pass | any failure |
| 0.2 | Offline canary passes | `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | exit 0, `ok: true`, `files_remaining: 0` | any scenario `ok: false` |
| 0.3 | Canary report is content-free | inspect the report | no fixture text, no excerpts, no bloom prose | any text field beyond states and counts |
| 0.4 | Evaluation receipt exists | `services/garden-worker/evaluation` report and blinded scores recorded | model snapshot, workflow version, prompt/schema hashes, corpus outputs, blinded scores, and Kyle's acceptance of the small return format are all recorded | any item missing |
| 0.5 | Security review has no open high finding for the worker path | `documents/operations/SECURITY_REVIEW_2026-09.md` | worker-related threats have receipts or explicitly accepted gaps | open high/critical finding |
| 0.6 | Database tests pass | `supabase test db --local supabase/tests` (CI `database` job) | green | red |

The offline canary (0.2) exercises submit, cancel in flight, deadline expiry, provider
expiry, budget stop, duplicate provider results, and a lost lease against a fake
provider. It proves the runtime's control flow, not provider behavior, cost, or privacy.

## Phase 1 — Provider account and secrets (hosted, no runtime change)

| # | Check | Go | No-go |
|---|---|---|---|
| 1.1 | Provider data-retention terms reviewed and recorded: batch inputs and outputs are not used for training; retention window recorded | recorded with date and source URL | not reviewed or unclear |
| 1.2 | Provider account is dedicated to Slow Garden with a spend limit at or below the monthly hard cap | limit confirmed in the provider console | shared account or no limit |
| 1.3 | `OPENAI_API_KEY` and `GARDEN_WORKER_SECRET` set as **worker-only** function secrets via the provider's secure configuration path | present in worker secrets; absent from any browser config, `.env.local`, Vercel client env, and Git | any secret visible to the browser or committed |
| 1.4 | `GARDEN_WORKER_SECRET` is at least 32 random bytes and stored only in the scheduler and the worker | generated with a CSPRNG | reused or short |

No cloud resource is created in this phase beyond the two secrets.

## Phase 2 — Worker deployment with the runtime still disabled

| # | Check | Go | No-go |
|---|---|---|---|
| 2.1 | `supabase/functions/garden-worker` deployed with JWT verification disabled **only for this function** | deploy receipt names the function and the flag | flag applied project-wide |
| 2.2 | Unauthenticated POST returns 401; wrong secret returns 401 | both observed | any 200/503 without the secret |
| 2.3 | Authenticated POST with runtime disabled returns `{"state":"idle"}` | observed | any other state |
| 2.4 | Missing provider key returns 503 `Worker not configured` (test by temporarily unsetting in a **branch/preview** function, never production) | observed or explicitly skipped with reason | worker starts work without provider key |
| 2.5 | Function logs contain no request or provider bodies | inspect logs for the canary invocations | any body text |

## Phase 3 — Synthetic deployed canaries (only the synthetic tenant creates passes)

`private.ai_runtime` is a **global singleton**: `enabled=true` opens pass creation and
claiming for every tenant in the project at once; there is no per-tenant switch. Tenant
scoping in this phase comes from the surrounding controls, not from the flag: keep
`GARDEN_AI_ENABLED=false` in the web app so no real person sees a request control, give
only the synthetic tenant's plots `ai_enabled=true`, and create passes only by direct insert
as that tenant. Verify before enabling that no other plot has `ai_enabled=true`
(`select count(*) from public.plots where ai_enabled and tenant_id <> '<synthetic>'`
must be 0).

Enable `private.ai_runtime.enabled=true` **only** after pinning `model`, `workflow`,
`input_rate`, `output_rate`, `soft_cap_cents=1000`, `hard_cap_cents=1500`, and
`approved_at`.

| # | Canary | Go | No-go |
|---|---|---|---|
| 3.1 | Submit: a synthetic pass reaches `processing` with a provider batch id; exactly one input file uploaded | `provider_id` set once; provider console shows one batch | duplicate batch or file |
| 3.2 | Complete: the pass returns 0–3 blooms whose evidence quotes the synthetic snapshot exactly; `actual_cents` recorded from real usage | `status=complete`, blooms ≤ 3, `spent_cents` increased, `reserved_cents` released | invalid evidence accepted or cost unknown |
| 3.3 | Cleanup: after completion, input and output files are deleted at the provider and `cleanup_pending=false` | provider file list has no `garden.jsonl` for this pass | any remaining file |
| 3.4 | Cancel in flight: cancel a synthetic pass while the batch is `in_progress`; the worker requests provider cancellation, waits for terminal status, then deletes files | `status=cancelled`, batch `cancelled`, files deleted, reservation released | files deleted before terminal evidence, or batch left running |
| 3.5 | Expiry: a synthetic pass created with `created_at` older than 30 hours is failed and its batch cancelled on the next tick; a provider-expired batch (24h window) is failed and cleaned | `status=failed`, batch cancelled/expired, files deleted, full reservation charged | pass still `processing` after 30h |
| 3.6 | Idempotency: invoke the worker twice within one lease window for the same pass; second call is `idle`, `waiting`, or `lease_lost`, never a second upload or batch | provider console shows one batch | second batch |
| 3.7 | Budget stop: with `hard_cap_cents` temporarily lowered to one reservation, the second synthetic pass is rejected with `AI budget reached`; restore the cap afterwards | rejection observed, cap restored | pass accepted over the cap |
| 3.8 | Permission revocation: disable `ai_enabled` on the synthetic plot mid-flight; the pass is cancelled and completed output is withdrawn | `status in (cancelled, withdrawn)`, no readable blooms | blooms visible |
| 3.9 | Account deletion with pending work: **known gap** — deleting the synthetic account while `cleanup_pending=true` cascades `pass_inputs` and loses the provider ids | not executable until the proposed orphan-cleanup migration lands | — |
| 3.10 | Hosted restore: a point-in-time restore or backup restore of the project to a **branch** preserves passes, blooms, and `ai_months` | restore receipt recorded | never exercised |

Record each canary as a receipt. At the end of the phase follow [Rollback](#rollback) in
order (cancel, drain to zero, then `enabled=false`) before continuing.

## Phase 4 — Activation for the dogfood account

All of Phases 0–3 are **go**, and 3.9 and 3.10 are either receipted or explicitly
accepted as residual risk in the decision log.

1. Confirm the month's `ai_months` row shows `reserved_cents=0` and expected `spent_cents`.
2. Set `private.ai_runtime.enabled=true` with the pinned values from Phase 3 unchanged.
3. Configure the server-only five-minute scheduler to POST the worker with the worker
   secret. Confirm one tick returns `idle`.
4. Set `GARDEN_AI_ENABLED=true` for the web application. This shows the explicit
   "invite a reflection" control only; it grants no automatic tending.
5. Request one real manual pass on a plot with `ai_enabled=true`. Verify the return
   is at most three blooms, each linked to exact source revisions, and that the
   user-authored text and AI-derived text remain distinguishable in the UI.
6. Record the activation receipt: date, model, workflow, rates, caps, scheduler, and
   the first pass's state sequence (states only).

## Ongoing go/no-go (checked weekly during dogfood)

| Check | No-go action |
|---|---|
| `spent_cents` for the month exceeds `soft_cap_cents` | Disable new passes; review usage before continuing |
| Any pass `processing` for more than 30 hours | Investigate scheduler and worker; expiry should have fired |
| Any `cleanup_pending=true` older than 24 hours | Investigate provider cancellation and file deletion |
| Provider console shows files older than 48 hours | Manual deletion and incident note |
| Any log line containing note text or provider bodies | Rotate secrets, disable runtime, privacy incident note |

## Rollback

Rollback is always allowed and never requires a migration. Order matters:
`private.ai_runtime.enabled` gates **claiming** as well as requesting. `claim_garden_pass`
only hands out `queued`/`processing` passes while `enabled=true`, so switching it off
while a batch is in flight strands that pass: it is never polled, never cancelled at the
provider, its budget reservation is never released, and its input file is never deleted.
Drain first, disable last.

1. Set `GARDEN_AI_ENABLED=false` in the web application (hides the request control; no
   new passes can be requested from the product).
2. Cancel every active pass while the runtime is still enabled:
   `update public.garden_passes set status='cancelled' where status in ('queued','processing')`
   (as the operator; the owner can do the same from the garden). The `passes_cleanup`
   trigger marks each pass `cleanup_pending`; on its next claim the worker cancels the
   provider batch, releases the reservation, and deletes the files.
3. Keep the scheduler and `enabled=true` until both are zero:
   `select count(*) from public.garden_passes where status in ('queued','processing')` and
   `select count(*) from private.pass_inputs where cleanup_pending`.
4. Only then set `private.ai_runtime.enabled=false`. Cleanup of already-terminal passes
   still runs with the runtime disabled, so a late `cleanup_pending` row is not stranded.
5. Stop the scheduler once step 3's counts stay at zero.
6. Confirm the provider console shows no remaining files, then optionally revoke
   `OPENAI_API_KEY`.
7. Do not delete accounts while their cleanup is outstanding (see 3.9).

If the runtime was disabled first by mistake, re-enable it, then run steps 2–5.

## Known gaps carried by this runbook

- **Account deletion with pending provider work (3.9):** requires a schema change.
  Proposed, not applied: a `private.provider_orphans(provider_id, input_file_id,
  output_file_id, queued_at)` table populated by a `before delete` trigger on
  `private.pass_inputs` when `cleanup_pending`, plus a worker cleanup path that
  drains it. Content-free by construction.
- **Hosted restore (3.10):** requires a Supabase branch or a restore to a scratch
  project; never exercised.
- **Provider idempotency (3.6):** the runtime sends `Idempotency-Key` headers on file
  and batch creation; whether the provider honors them for these endpoints is
  unverified and must be observed in the hosted canary, not assumed.

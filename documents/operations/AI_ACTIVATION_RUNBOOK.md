# AI activation runbook

Status: Automatic activation incomplete. Revised 2026-11-16 for the owner-only allowlist, the provider transport setting, the scheduling migration, the evaluation receipt tool and the deletion/orphan migration. **None of the four November 16 migrations is applied to the hosted project and no worker is deployed.** Hosted state was last verified by anyone on November 1–2 ([November 1 receipt](TENDING_STATUS_2026-11-01.md), [supervised run receipt](SUPERVISED_TENDING_2026-11-02.md)); the global runtime was left off. See the [status review](ACTIVATION_STATUS_2026-11-16.md) and the [prerequisites record](ACTIVATION_PREREQUISITES_2026-11-16.md).
Owner: Kyle
Applies to: `supabase/functions/garden-worker`, `private.ai_runtime`, `private.ai_tenants`, `GARDEN_AI_ENABLED`
Related: [worker README](../../services/garden-worker/README.md),
[initiative record](../initiatives/05-activation-readiness.md),
[delivery record](WEB_DOGFOOD_DELIVERY.md), ADR-004, ADR-006, ADR-008, D-024, D-025

This runbook is the only sanctioned path for turning the reflection runtime on.
It is deliberately slow. Every check is go/no-go: a single **no-go** stops activation,
and nothing in this document may be skipped because a previous run passed. Activation
is reversible at every step; see [Rollback](#rollback).

## Owner decisions (make these first; record them in `documents/DECISION_LOG.md`)

D-024 authorises running this runbook for Kyle's own garden. It does not make the
choices below. Each has a recommended default with its reason; "not verified" marks
anything the repository's documents cannot settle.

| # | Decision | Recommended default | Why (source) | Not verified |
|---|---|---|---|---|
| 1 | Model family and snapshot policy | The Sol-class model used on Nov 2, pinned as the provider's **dated snapshot id**, never an alias. Re-pin only through a new evaluation receipt. | ADR-004 requires a pinned snapshot chosen by the rubric. Nov 2 ruled out the nano and mini candidates as "structurally valid but semantically poor" (status review §3). | The snapshot id itself: `gpt-6.1-sol` as written on Nov 2 is not recorded as a snapshot. The owner reads it from the provider's model page. |
| 2 | Reasoning effort | `low`, pinned in `private.ai_runtime.reasoning_effort` so the worker sends exactly what is evaluated. | Nov 2 used `low`; until today the worker sent no effort field, so the reviewed configuration was not the shipped one (status review §1 point 3). ADR-004: what is evaluated is what ships. | Whether `low` is the right quality/cost point: only the 0.4 receipt can say. The accepted value names are the provider's. |
| 3 | Caps and rates | Pin rates first: the model's **standard** per-million rates in cents (Nov 2: 200 input, 1000 output). Phase 3: `soft_cap_cents=1000`, `hard_cap_cents=1500` (COST_AND_CAPACITY). Owner steady state: **500 / 1000**; arithmetic in [Caps and reservations](#caps-and-reservations). | COST_AND_CAPACITY sets $10/$15. Each pass reserves 16–65 cents (tend-connect-v3 at 200/1000) before it runs and the caps count reservations, so a cap must hold a night's reservations, not only real spend (about 1 cent a pass on Nov 2). The earlier 300/500 suggestion was too tight. | Today's price list. COST_AND_CAPACITY says rates "must be refreshed before provider activation". With the unpinned default rates (1000/5000) a v3 reservation is 76–325 cents and these caps would stop tending within a night. |
| 4 | Transport | `sync` (set `private.ai_runtime.transport='sync'`). | PRIVACY_ARCHITECTURE_OPTIONS finding 1: Batch and Files are not eligible for zero data retention; a synchronous Responses call is. The cost difference is cents a month at owner scale ([prerequisites record](ACTIVATION_PREREQUISITES_2026-11-16.md) §4). A sync pass also finishes within one tick and leaves no provider file to clean up. | The retention finding is evidence grade **[S]** (search summary of first-party pages, not read in full). Zero retention is a contract the provider must grant, not a flag: `sync` makes the route eligible, nothing more. The Edge Function time limit the sync path is sized for (150 s) is an assumption. Check 1.1 settles the first two. |
| 5 | Scheduler | `pg_cron` + `pg_net` + Vault, installed by the committed scheduling migration; no new vendor. | ADR-008 "Scheduling". The migration installs both jobs behind separate gates, so it is safe to apply before Phase 3. | Not exercised hosted. Locally the jobs, gates and the queued request were tested; no request was sent. |
| 6 | Hosted restore (3.10) | Accept as residual risk for the single-owner stage; revisit before any external account. | A restore drill needs a Supabase branch or scratch project, a cloud resource with possible cost. The owner's writing has export; D-025 already chose immediate deletion over a recovery copy for this stage. | What a restore does to passes whose provider work is gone, and to `ai_months` spend, stays untested (security review F-9, T-12). |
| 7 | What counts as the 0.4 receipt | One `run-model.mjs` run of the 30-case v3 packet on the exact pinned configuration, blind-scored by the owner, with the five-baseline 48-case comparison and the Wizard-of-Oz study explicitly deferred to before any external pilot. | Shortest defensible form (status review §7.2). | This **deviates from ADR-004 and EVALUATION_ARCHITECTURE** as written; only the owner can make it. The receipt tool records the basis of acceptance rather than deciding it. |
| 8 | Dropped marks | Decide whether a mark the validator drops counts against "100% valid source handles". The receipt tool counts it as a failure, by the letter. | EVALUATION_ARCHITECTURE "Release thresholds"; the runtime's design is that invalid marks are dropped, not shown. Nov 2 saw two dropped marks. | — |
| 9 | Web flag | Set `GARDEN_AI_ENABLED=true` at Phase 4 and accept that the public landing page drops its "private preview" lines. | With the allowlist, the flag no longer decides who can run tending, only what copy is shown; truthful in-product copy for the owner needs it on (status review §7.9). | Whether the landing copy is then truthful for a visitor who signs up and is not allowlisted: they see the invite control and get a refusal. Report to the web engineers. |
| 10 | Security gaps for 0.5 | Record acceptance of F-3, F-4 and F-5 for the owner-only phase. | Status review §4. | — |

## Roles and evidence

- **Operator:** the person running the steps. Only Kyle for the dogfood phase, or an
  agent on Kyle's explicit go for each hosted step.
- **Receipt:** a dated note in the initiative record or delivery record naming the
  command, the environment, the observed result, and who observed it. Receipts never
  contain note bodies, bloom prose, email addresses, or provider error bodies.
- **Synthetic tenant:** a test account whose content is entirely made up. Real gardens
  are never used as canaries.
- **Allowlist:** `private.ai_tenants`. Tending runs only for accounts listed there,
  whatever the runtime switch, the web flag or an account's own settings say.

## What gates what

| Control | Scope | Effect |
|---|---|---|
| `private.ai_runtime.enabled` | whole project | Off: no pass can be created, enqueued or claimed. Cleanup still runs. |
| `private.ai_tenants` | per account | An account not listed cannot create a pass (data API included), is skipped by nightly enqueue, and is never claimed. Empty list: nothing runs even when enabled. Removing an account cancels its queued and in-flight passes. |
| `private.ai_runtime.nightly_enabled` | whole project | Off (default): the hourly job enqueues nothing. |
| Vault `garden_worker_url` | whole project | Absent: neither scheduled job does anything. The URL is not a credential. The worker secret is **not** stored in the database: each scheduled tick carries a single-use token that expires in two minutes. |
| `soft_cap_cents` / `hard_cap_cents` | whole project, one pool | At the soft cap nightly enqueue stops; an invited pass is still accepted. At the hard cap no pass is created and no lost sync dispatch is re-sent. |
| `private.ai_runtime.transport` | whole project, frozen per pass | `batch` (default) or `sync`. |
| `GARDEN_AI_ENABLED` | one deployment | Product copy and the invite control only. It does not gate the database. |
| `plots.ai_enabled`, `accounts.tend_overnight` | per account, user-set | Necessary, never sufficient. |

The monthly budget (`private.ai_months`) is one pool for the whole project.

## Caps and reservations

A pass reserves its estimated cost when it is created, and the caps count reservations
plus spend. `b` is the frozen snapshot plus context in bytes (at most 100,000); rates
are cents per million.

```text
connect-v2        ceil(((b + 10000) * input + 4000 * output) / 1e6 * 1.25)
tend-connect-v3   ceil(((2b + 20000) * input + 8000 * output) / 1e6 * 1.25)
```

| Workflow | Rates 200 / 1000 (Nov 2) | Default rates 1000 / 5000 |
|---|---|---|
| connect-v2 | 8 to 33 cents | 38 to 163 cents |
| tend-connect-v3 | 16 to 65 cents | 76 to 325 cents |

What is booked: real usage when the provider reports it (0.88 cents for the one real
pass); the whole reservation when work was sent and never answered (a lost sync
dispatch, at most one retry per staged pass); nothing when nothing was sent.

Recommended owner caps at 200/1000, **soft 500, hard 1000**:

- Real spend: up to six scopes a night is at most 180 passes a month; at about 1 cent
  each that is under 200 cents, and one or two scopes a night is 30 to 60 cents.
- Soft 500 leaves room for that plus roughly eighteen lost dispatches at 16 cents
  (or four at 65) before nightly tending pauses for a look.
- Hard 1000 keeps 500 above the soft cap, more than one night's worst reservations
  (6 scopes x 65 = 390 cents), so a night that starts just under the soft cap is not
  cut off half-way, and the month's ceiling equals COST_AND_CAPACITY's $10.
- The earlier 300/500 suggestion left 200 above the soft cap, less than one bad night.

## Phase 0 — Preconditions (offline, repeatable)

| # | Check | Command / source | Go | No-go |
|---|---|---|---|---|
| 0.1 | Worker runtime tests pass | `node --test services/garden-worker/runtime.test.mjs` | all tests pass | any failure |
| 0.2 | Offline canary passes | `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | exit 0, `ok: true`, `files_remaining: 0` | any scenario `ok: false` |
| 0.3 | Canary report is content-free | inspect the report | no fixture text, no excerpts, no bloom prose | any text field beyond states and counts |
| 0.4 | Evaluation receipt exists for the exact configuration that will run | one command, below | `receipt.json` with `verdict: "go"`, `hashes.current: true`, and its model snapshot, reasoning effort and workflow version equal to what will be pinned | `no-go`, a stale hash, or any difference from the pin |
| 0.5 | Security review has no open high finding for the worker path | `documents/operations/SECURITY_REVIEW_2026-09.md` | worker-related threats have receipts or explicitly accepted gaps (decision 10) | open high/critical finding |
| 0.6 | Database tests pass | `supabase db reset`, `supabase db lint --local --schema public,private --level warning --fail-on error`, `supabase test db --local supabase/tests` (CI `database` job) | green | red |

The offline canary (0.2) runs twenty-four scenarios against a fake provider. Batch: submit,
cancel in flight, deadline expiry, provider expiry, budget stop, duplicate provider
results, a lost lease, and a two-stage partial completion. Allowlist: an empty list
runs nothing. Sync: complete, staged partial completion, timeout mid-call, repeated
timeouts to the provider-call limit (single and staged), lease lost after the provider
answered, a ledger that refuses the answer, duplicate invocation, budget stop at
redispatch, cancel in flight, provider errors, oversized snapshot, the function time
limit, nothing sent means nothing charged, and a malformed answer reported as a fixed
code. It proves the runtime's control flow, not
provider behavior, cost, or privacy.

**0.4, the one command.** Run by the owner, or by an agent the owner has given a key
for that terminal session, after 1.1 and 1.2. The key is read from the environment
only; it is never written to a file, a receipt or Git:

```sh
OPENAI_API_KEY=<key> node services/garden-worker/evaluation/run-model.mjs \
  --owner-approved --workflow tend-connect-v3 \
  --model <dated-model-snapshot> --reasoning-effort <effort> \
  --run-dir artifacts/generated/evaluation/<yyyy-mm-dd>
```

It sends the 30 synthetic cases through the same request builder the worker uses and
writes `run.json`, `outputs.jsonl`, `review.csv`, `review-key.json` and `receipt.json`
into the ignored run directory. The receipt starts as `no-go`. Then:

1. Fill `verdict` (y/n) for every row of `review.csv`, and `clinical` (y/n) for theme
   rows. The sheet shows the returned item and the passages it cites; it hides the
   case, its family and what was expected.
2. Record acceptance and rebuild the receipt:
   `node services/garden-worker/evaluation/receipt.mjs artifacts/generated/evaluation/<yyyy-mm-dd> --accept-return-format --accepted-by "Kyle" --basis "<what was reviewed>"`
3. Copy `receipt.json` (content-free by construction) into a dated record under
   `documents/operations/`. Outputs and the review sheet stay in the ignored folder.

Any later change to a prompt, a schema, the corpus or the shared runtime file changes
a hash and makes the receipt stale: rerun.

## Phase 1 — Provider account and secrets (hosted, no runtime change)

| # | Check | Go | No-go |
|---|---|---|---|
| 1.1 | Provider data terms read directly on the first-party pages and recorded, for the endpoints the chosen transport uses (sync: Responses; batch: Responses, Batch, Files): not used for training; the retention window, including abuse monitoring; whether zero data retention or modified abuse monitoring was requested and granted | recorded with date, source URLs and who read them | not reviewed, unclear, or "zero retention" claimed without a granted agreement |
| 1.2 | Provider account is dedicated to Slow Garden with a spend limit at or below the monthly hard cap | limit confirmed in the provider console | shared account or no limit |
| 1.3 | `OPENAI_API_KEY` and `GARDEN_WORKER_SECRET` set as **worker-only** function secrets via the provider's secure configuration path | present in worker secrets; absent from any browser config, `.env.local`, Vercel client env, and Git | any secret visible to the browser or committed |
| 1.4 | `GARDEN_WORKER_SECRET` is at least 32 random bytes and stored only in the worker's function secrets and the owner's password manager. It is for manual POSTs by the operator. It is **not** put in Vault or anywhere in the database (pg_net's request queue is readable by every database role; see Known gaps) | generated with a CSPRNG | reused, short, or stored in the database |

Rotate the key that was used on Nov 2 rather than reuse it (status review §5). No
cloud resource is created in this phase beyond the two secrets.

## Phase 2 — Migrations and worker deployment with the runtime still disabled

Apply the six committed migrations through
[SUPABASE_CHANGE_WORKFLOW](../../infrastructure/SUPABASE_CHANGE_WORKFLOW.md) steps 6–8
and the [hosted apply checklist](HOSTED_APPLY_CHECKLIST.md), in order, **as one
sequence on one go, without pausing part-way** (after the first four without the
fifth, the deletion RPCs exist with no database switch in front of them):
`20261116010931_in_app_deletion`, `20261116023935_ai_tenant_allowlist`,
`20261116023937_provider_transport`, `20261116023939_garden_scheduling`,
`20261116041903_browser_path_rules`, `20261116061751_tending_followups`.

| # | Check | Go | No-go |
|---|---|---|---|
| 2.0 | The six migrations are in the hosted ledger; `supabase db push --linked --dry-run` reports up to date; `scripts/hosted-canary.sql` returns `hosted synthetic canary passed` | all three observed | any difference |
| 2.0a | After migration: `select count(*) from private.ai_tenants` is 0; `select transport, reasoning_effort, nightly_enabled, enabled from private.ai_runtime` is `batch, null, false, false`; `select jobname, schedule, command from cron.job` lists `slow-garden-worker`, `slow-garden-nightly` (command `call private.run_nightly_enqueue()`), `slow-garden-cron-prune`; `select deletion_enabled from private.deployment_switches` is false; `select private.garden_worker_url() is null` is true (so the tick can send nothing) | observed | anything else |
| 2.1 | `supabase/functions/garden-worker` deployed with JWT verification disabled **only for this function** | deploy receipt names the function and the flag | flag applied project-wide |
| 2.2 | Unauthenticated POST returns 401; wrong secret returns 401 | both observed | any 200/503 without the secret |
| 2.3 | Authenticated POST with runtime disabled returns `{"state":"idle"}` | observed | any other state |
| 2.4 | Missing provider key returns 503 `Worker not configured` (test by temporarily unsetting in a **branch/preview** function, never production) | observed or explicitly skipped with reason | worker starts work without provider key |
| 2.5 | Function logs contain no request or provider bodies | inspect logs for the canary invocations | any body text |
| 2.6 | The owner stores the worker URL (https) in Vault: `select vault.create_secret('<https url>','garden_worker_url')` | `select private.garden_worker_url() is not null` is true; `select count(*) from vault.decrypted_secrets where name='garden_worker_secret'` is 0; `select count(*) from net.http_request_queue` stays 0 over the next five minutes (runtime off, no cleanup owed: the tick sends nothing) | a secret stored in Vault, or a value pasted into chat, a log or Git |
| 2.7 | Record pg_net's grants, which a migration cannot change: `select has_table_privilege('authenticated','net.http_request_queue','select'), has_function_privilege('authenticated','net.http_post(text,jsonb,jsonb,jsonb,integer)','execute')` | recorded. `true, true` is the platform default seen locally and is why no secret travels through pg_net | not recorded |

The scheduling migration is the only one that installs `pg_cron` and `pg_net`. Its
worker tick makes no request unless the worker URL is in Vault **and** there is work
the worker could claim (an active pass of an allowlisted account while the runtime is
enabled, or cleanup owed by a finished pass or an orphan, which keeps running after
the runtime is switched off). With the runtime off and nothing owed it is inert, even
if an in-flight pass was left behind. Its nightly job enqueues nothing unless
`enabled`, `nightly_enabled` and the worker URL are all set, and stops at the soft cap.
A scheduled tick authenticates with a single-use token (two-minute life, only its hash
stored); the worker redeems it once through `consume_worker_tick`. So "one tick returns
idle" is observed with a manual POST (2.3), not by waiting for the scheduler.

## Phase 3 — Synthetic deployed canaries (only the synthetic tenant is allowlisted)

`private.ai_runtime.enabled` is one switch for the whole project. Tenant scoping in
this phase comes from the allowlist, which the database enforces at pass creation,
nightly enqueue and claim. The owner's topics and overnight preference may stay on:
an account that is not allowlisted cannot run, so the old "no other plot has tending
on" precondition is gone, and nothing needs to be switched off (switching a topic off
would withdraw its completed passes).

Before enabling:

1. `select count(*) from private.ai_tenants` is 0.
2. `select nightly_enabled from private.ai_runtime` is false.
3. Create the synthetic tenant and allowlist it:
   `insert into private.ai_tenants(tenant_id, note) values ('<synthetic>', 'phase 3 canary');`
4. Pin `model`, `workflow_version`, `reasoning_effort`, `transport`,
   `input_cents_per_million`, `output_cents_per_million`, `soft_cap_cents=1000`,
   `hard_cap_cents=1500` and `approved_at`, exactly as in the 0.4 receipt, and read the
   row back. Only then set `enabled=true`.

Create passes only by direct insert as the synthetic tenant. Rows marked **B** apply
to `transport='batch'`, **S** to `transport='sync'`; run the rows for the transport
that was pinned.

| # | Canary | Go | No-go |
|---|---|---|---|
| 3.0 | Allowlist: a pass inserted as any account that is not allowlisted is refused with `tending is not available for this account yet` (SQLSTATE 55000) | refusal observed; `select count(*) from public.garden_passes where tenant_id <> '<synthetic>' and created_at > '<phase start>'` is 0 | pass accepted |
| 3.1 B | Submit: a synthetic pass reaches `processing` with a provider batch id; exactly one input file uploaded | `provider_id` set once; provider console shows one batch | duplicate batch or file |
| 3.1 S | Dispatch: one tick takes a synthetic pass from `queued` to `complete`; `provider_calls` equals the number of stages (1 or 2); no file and no batch exists at the provider | worker answers `{"state":"complete","transport":"sync",…}`; console shows no file or batch | a file or batch, or more provider calls than stages |
| 3.2 | Complete: the pass returns 0–3 blooms whose evidence quotes the synthetic snapshot exactly; `actual_cents` recorded from real usage | `status=complete`, blooms ≤ 3, `spent_cents` increased, `reserved_cents` released | invalid evidence accepted or cost unknown |
| 3.3 B | Cleanup: after completion, input and output files are deleted at the provider and `cleanup_pending=false` | provider file list has no `garden.jsonl` for this pass | any remaining file |
| 3.3 S | Cleanup: the next tick sets `cleanup_pending=false`; the provider's stored-responses view shows nothing for the request (`store:false`) | observed | a stored response |
| 3.4 B | Cancel in flight: cancel a synthetic pass while the batch is `in_progress`; the worker requests provider cancellation, waits for terminal status, then deletes files | `status=cancelled`, batch `cancelled`, files deleted, reservation released | files deleted before terminal evidence, or batch left running |
| 3.4 S | Cancel: a sync request cannot be recalled, and a pass is in flight for seconds. Cancel a queued pass before the tick | `status=cancelled`, no dispatch, reservation released, `actual_cents=0` | a dispatch after cancellation. Cancel **during** the call is offline-only (0.1, 0.2): the answer is discarded and only its cost recorded |
| 3.5 | Expiry: a synthetic pass with `created_at` older than 30 hours is failed on the next tick (B: its batch cancelled; a provider-expired batch is failed and cleaned) | `status=failed`, full reservation charged (B: batch cancelled/expired, files deleted) | pass still `processing` after 30h |
| 3.6 | Idempotency: invoke the worker twice at once for the same pass; the second call is `idle`, `waiting`, or `lease_lost` | B: provider console shows one batch. S: `dispatches=1` | a second batch or dispatch. At most four provider calls are ever made for one pass |
| 3.7 | Budget stop: with `hard_cap_cents` temporarily lowered to one reservation, the second synthetic pass is rejected with `AI budget reached`; restore the cap afterwards | rejection observed, cap restored | pass accepted over the cap |
| 3.8 | Permission revocation: disable `ai_enabled` on the synthetic plot with a pass queued or in flight; the pass is cancelled and completed output is withdrawn | `status in (cancelled, withdrawn)`, no readable blooms | blooms visible |
| 3.9 B | Account deletion with pending work: delete the synthetic account while `cleanup_pending=true`; tick | a `private.provider_orphans` row appears, then is drained to zero; console shows no remaining file | an orphan row that stops retrying (`attempts=20`), or a remaining file |
| 3.9 S | Account deletion: delete the synthetic account with a pass queued | pass gone; its reservation released and nothing charged (charged in full only if a dispatch was still open, that is, sent and never answered); no orphan row | reservation left behind |
| 3.10 | Hosted restore: a point-in-time restore or backup restore of the project to a **branch** preserves passes, blooms, and `ai_months` | restore receipt recorded, or residual risk accepted (decision 6) | neither |
| 3.12 | Nightly canary: `psql "$DATABASE_URL" -f scripts/hosted-nightly-canary.sql`, as the operator, with the allowlist empty, the nightly switch off and no pass queued or processing (before 3.0's allowlisting, or after 3.11). psql only: it uses meta-commands and stops at the first error. Its preconditions, the synthetic account with two tended topics, the allowlisting, the opening of the nightly switch and the proof that the synthetic account is the only one nightly enqueue could reach are one transaction; then it calls the committing `private.run_nightly_enqueue()`, puts the nightly switch back to exactly the value it found, reports, and removes only what it created | exit status 0 and a last row `hosted nightly canary passed` (2 passes, one cycle date, 3 blooms allowed for the garden, 0 other tenants, switch as found; then all zeros). `scripts/hosted-canary.sql` separately proves the procedure refuses to run inside a transaction | exit status 3: a line beginning `nightly canary refused:` means a precondition was not met and nothing changed; `FAILED` means the run happened and a count was wrong. If the connection drops after the committing call, the switch may be left on with only the synthetic account allowlisted: set `nightly_enabled=false`, then delete that allowlist row and that account |
| 3.11 | Allowlist removal: `delete from private.ai_tenants where tenant_id='<synthetic>'` with a pass queued | the pass is `cancelled` and cleaned on the next tick; a new insert is refused | pass still active |

3.9 was a known gap until `20261116010931_in_app_deletion.sql`: that migration adds
`private.provider_orphans`, a `before delete` trigger on `private.pass_inputs`, and
the worker drain. See [DELETION_2026-11-16.md](DELETION_2026-11-16.md), "Provider
cleanup that survives deletion". It is closed in the repository and receipted locally;
the hosted receipt is this row.

Record each canary as a receipt. At the end of the phase follow [Rollback](#rollback)
in order (cancel, drain to zero, then `enabled=false`), confirm
`select count(*) from private.ai_tenants` is 0, and delete the synthetic account only
after `select count(*) from private.pass_inputs where cleanup_pending` and
`select count(*) from private.provider_orphans` are both 0.

## Phase 4 — Activation for the dogfood account

All of Phases 0–3 are **go**, and 3.10 is either receipted or explicitly accepted as
residual risk in the decision log.

1. Confirm the month's `ai_months` row shows `reserved_cents=0` and expected
   `spent_cents`, and that `private.ai_tenants` is empty.
2. Allowlist the owner's account, and only it:
   `insert into private.ai_tenants(tenant_id, note) values ('<owner>', 'D-024 owner activation');`
   then `select count(*) from private.ai_tenants` is 1.
3. Set `private.ai_runtime.enabled=true` with the pinned values from Phase 3 unchanged
   (model, workflow version, reasoning effort, transport, rates). Set the steady-state
   caps if decision 3 chose them. Leave `nightly_enabled=false`.
4. Confirm the worker answers a manual POST with `idle` and that `cron.job_run_details`
   shows the five-minute tick succeeding.
5. Set `GARDEN_AI_ENABLED=true` for the web application's Production environment and
   redeploy. The flag is deployment-wide, not per account. It (a) shows "Invite a
   reflection" inside Returns for every signed-in account that has a topic set to
   Tending on, (b) removes the "private preview" lines from the public landing page,
   and (c) changes the tending copy in topic settings, overnight settings and the
   Returns empty state from "not active for this account yet" to active wording. It
   grants no tending: an account that is not allowlisted is refused by the database.
6. In the product, open Returns from the top bar on a topic set to Tending on
   (`plots.ai_enabled=true`) and use "Invite a reflection". Verify the return is at
   most three blooms, each linked to exact source revisions; that AI material appears
   as "The garden noticed" beside "Your words" clippings; that catalogue marks appear
   beside thoughts and are not announced as a reveal; and that the morning reveal card
   appears once for unseen blooms and not at all for a zero-bloom return. The status
   review reported that garden-level Returns shows only the first topic with tending
   on (not re-verified for this revision), so check each tended topic's Returns, or
   confirm bloom counts per pass by a count query.
7. Record the activation receipt: date, model, workflow, reasoning effort, transport,
   rates, caps, allowlist count, and the first pass's state sequence (states only).

### Phase 4b — Nightly tending (ADR-008), only after Phase 4 has a receipt

1. Confirm the `tending_tiers` migration is in the hosted ledger (applied 2026-11-01;
   re-read the ledger) and that the 0.4 receipt covers `tend-connect-v3`.
2. Confirm `accounts.tend_overnight=true` and `accounts.timezone` for the dogfood
   account (set 2026-11-01; the control is "Tend my garden overnight" in overnight
   tending settings). Other accounts may have set it too; they are not enqueued unless
   allowlisted, and `select count(*) from private.ai_tenants` is still 1.
3. Open the nightly gate: `update private.ai_runtime set nightly_enabled=true where singleton;`
   and confirm `select private.nightly_gates_open()` is true. The hourly job runs
   `call private.run_nightly_enqueue()`, which commits after each account; 3.12 must
   have a receipt first, so that this is not the first time it commits.
4. Observe one night. Expect one pass per permission scope with changed writing, and
   none for unchanged scopes. **Each garden gets at most three blooms for the night,
   across all its passes**: the three are shared out when the night's passes are
   created (one topic 3; two topics 2 and 1; three or more 1 each), a share that is
   not used is not handed on, and `private.bloom_cycles` shows `published` (never
   above 3) and `withheld` per garden and night. A reflection the person invites is
   separate: up to three of its own. Catalogue marks are not blooms. Check
   `select count(*) from private.nightly_skips where noted_at > now() - interval '1 day'`
   is 0 (a row means a scope or account was passed over; its reason is a code). No body text
   appears in logs. With `sync`, passes finish within minutes of 02:07 local time,
   one per five-minute tick; with `batch`, within the provider's 24-hour window.
5. Record the nightly receipt as states, counts and costs only.

Rollback: `update private.ai_runtime set nightly_enabled=false`. Passes already queued
drain normally, and disabling the runtime follows the order below.

## Ongoing go/no-go (checked weekly during dogfood)

| Check | No-go action |
|---|---|
| `select count(*) from private.ai_tenants` is not 1, or `select count(*) from public.garden_passes p where not exists (select 1 from private.ai_tenants t where t.tenant_id=p.tenant_id) and p.status in ('queued','processing')` is not 0 | Disable the runtime by the Rollback order; investigate |
| `spent_cents` for the month exceeds `soft_cap_cents` | Disable new passes; review usage before continuing |
| Any pass `processing` for more than 30 hours | Investigate scheduler and worker; expiry should have fired |
| Any `cleanup_pending=true` older than 24 hours, or any `private.provider_orphans` row with `attempts=20` | Investigate provider cancellation and file deletion |
| `select max(published) from private.bloom_cycles` is above 3 (cannot happen: a check constraint), or any `private.nightly_skips` row in the last week | Read the reason code; `scope_over_20_topics` means a garden has more than twenty cross-connected tended topics and that scope is not tended |
| Any `private.pass_inputs` row with `lost_cents > 0` (sync) | A dispatch never reported back: check function logs for timeouts; compare with the provider invoice |
| `select count(*) from private.worker_ticks` is more than a handful | Ticks are being issued and not redeemed: the worker is not answering |
| Provider console shows files older than 48 hours (batch), or any stored response (sync) | Manual deletion and incident note |
| Any log line containing note text or provider bodies | Rotate secrets, disable runtime, privacy incident note |
| `cron.job_run_details` shows a failed `slow-garden-worker` or `slow-garden-nightly` run | Investigate before the next night |

## Rollback

Rollback is always allowed and never requires a migration. Order matters:
`private.ai_runtime.enabled` gates **claiming** as well as requesting. `claim_garden_pass`
only hands out `queued`/`processing` passes while `enabled=true` and their account is
allowlisted, so switching the runtime off while a batch is in flight strands that pass:
it is never polled, never cancelled at the provider, its budget reservation is never
released, and its input file is never deleted. Drain first, disable last.

1. Set `GARDEN_AI_ENABLED=false` in the web application and redeploy (hides "Invite a
   reflection" in Returns and restores the landing page's private-preview lines; no
   new manual pass can be requested from the product). This does not stop nightly
   enqueueing or direct data-API inserts; steps 2 and 5 do. With the flag off the
   Returns empty state says no AI has read the person's writing, which is untrue for
   an account that has been tended; treat that copy as a known defect until it is
   fixed.
2. Stop new work without stranding anything: `update private.ai_runtime set nightly_enabled=false`,
   then `delete from private.ai_tenants`. Removing an account cancels its queued and
   in-flight passes; the `passes_cleanup` trigger marks each `cleanup_pending`, and on
   its next claim the worker cancels the provider batch, settles the reservation, and
   deletes the files. Settlement follows one rule: real usage when it is known; the
   full reservation when work reached the provider and its usage is unknown; nothing
   when nothing was ever sent. Cancelling passes that never left costs nothing. (Cancelling by hand has the same effect:
   `update public.garden_passes set status='cancelled' where status in ('queued','processing')`;
   the owner can cancel a waiting pass from Returns.)
3. Keep the scheduler and `enabled=true` until both are zero:
   `select count(*) from public.garden_passes where status in ('queued','processing')` and
   `select count(*) from private.pass_inputs where cleanup_pending`; also
   `select count(*) from private.provider_orphans`.
4. Only then set `private.ai_runtime.enabled=false`. Cleanup of already-terminal passes
   still runs with the runtime disabled, and the scheduled tick keeps reaching the
   worker while cleanup is owed, so a late `cleanup_pending` row is not stranded.
5. The scheduler needs no stopping: with the runtime off and nothing owed, the tick
   returns null and makes no request. To remove it entirely:
   `select cron.unschedule('slow-garden-worker'); select cron.unschedule('slow-garden-nightly');`
   and delete the Vault secret `garden_worker_url`. The full reversal of each November
   16 migration is in the [prerequisites record](ACTIVATION_PREREQUISITES_2026-11-16.md) §9.
6. Confirm the provider console shows no remaining files, then optionally revoke
   `OPENAI_API_KEY`.
7. An account may be deleted while its cleanup is outstanding: the provider ids move
   to `private.provider_orphans` and the worker drains them. Do not drop that table
   or stop the worker while it has rows.

If the runtime was disabled first by mistake, re-enable it, then run steps 2–4. Until
then an in-flight pass stays `processing` and is not ticked (the tick is inert while
disabled); nothing is lost, and it is cancelled by step 2 or expires after 30 hours
once the runtime is on again.

Changing transport or model later is a re-pin, not a rollback: drain to zero first,
then change the runtime row; passes already prepared keep the transport, model, rates
and effort they were frozen with.

## Known gaps carried by this runbook

- **Hosted restore (3.10):** requires a Supabase branch or a restore to a scratch
  project; never exercised. Recommended as accepted residual risk for the single-owner
  stage (decision 6).
- **Provider idempotency (3.6):** the runtime sends `Idempotency-Key` headers on file
  and batch creation and on synchronous calls; whether the provider honors them for
  these endpoints is unverified and must be observed in the hosted canary, not
  assumed. The ledger does not rely on it: a batch pass records its provider id, and a
  sync pass records each dispatch.
- **Sync transport, not exercised against a provider or a deployed function.** The
  Edge Function limit it is sized for (answer within 150 seconds) is an assumption;
  a sync request cannot be recalled once sent; a dispatch that never reports back is
  booked at its full reservation, which over-states spend against the invoice.
- **pg_net's grants cannot be tightened by a migration.** The extension and the
  platform's event trigger grant every role, `anon` and `authenticated` included, read
  access to `net.http_request_queue` and `net._http_response` and execute on
  `net.http_post`, as the extension owner; the migration role cannot revoke them
  (verified locally on pg_net 0.20.4; hosted not checked, see 2.7). The `net` schema is
  not exposed through the data API, so using this needs a way to run SQL. Consequences
  that remain: such a role could read a tick's single-use token in the instant before
  it is sent, could read the worker's content-free state responses, and could make
  outbound requests with `net.http_post`. Closing it needs the extension owner
  (Supabase support or a dashboard setting); not available from this repository.
- **Provider-call limit.** A pass makes at most four provider calls: a two-stage pass
  gets one retry. A ledger write that fails after the provider answered is retried
  from memory and then settled as failed at its real cost; it does not cause another
  provider call unless the worker process itself dies mid-call.
- **The three-bloom cap is per garden per night for nightly passes only.** An invited
  reflection is its own cycle of up to three; a person who invites one for each of
  several topics in a day can see more than three new blooms in that garden that day.
  That is a product choice made here (ADR-008 says "per garden per cycle" and does
  not define an invited pass's cycle); it wants an owner decision in the log.
- **One budget pool.** The allowlist decides who may spend it; there is still no
  per-account cap beyond eight active passes and six nightly scopes.
- **Evaluation corpus size.** The v3 packet has one reference case each for
  "unfinished" and "open question", so those thresholds rest on very few items.
- **Web copy.** With the flag on, an account that is not allowlisted sees the invite
  control and receives the generic 55000 message. Owned by the web engineers.

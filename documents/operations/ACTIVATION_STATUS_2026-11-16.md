# AI activation status — November 16, 2026

Operator: release-engineering agent (Claude), under D-024 ("run the AI activation
runbook for Kyle's own garden under supervision; each hosted step keeps its go/no-go").
Scope of this session: **offline only**. No Supabase, Vercel, OpenAI or other hosted
system was contacted, no secret was read or written, no model was called, no Git
command was run. This receipt contains commands, states, counts and hashes only; it
holds no fixture text, note bodies, bloom prose, addresses or provider bodies.

Runbook: [AI_ACTIVATION_RUNBOOK.md](AI_ACTIVATION_RUNBOOK.md). Earlier receipts:
[November 1](TENDING_STATUS_2026-11-01.md), [November 2](SUPERVISED_TENDING_2026-11-02.md).

## 1. One-screen summary

| Phase | Verdict today | Why |
|---|---|---|
| 0 Preconditions | **No-go** (4 of 6 go) | 0.1, 0.2, 0.3, 0.6 pass, executed today. 0.4 evaluation receipt does not exist. 0.5 has no open high finding but its worker-path gaps are listed, not explicitly accepted. |
| 1 Provider and secrets | **Blocked on owner** | No receipt for 1.1–1.4. A key was "saved and tested" on Nov 2; where it is stored is not recorded. |
| 2 Worker deploy (disabled) | **Not started** | Nov 1: project had no Edge Functions. Nov 2's temporary function was deleted. |
| 3 Synthetic deployed canaries | **Not started; precondition currently fails** | The owner's two topics already have `ai_enabled=true`, so the runbook's "count must be 0" check cannot pass as written. 3.9 waits on a migration that is in the working tree today; 3.10 never exercised. |
| 4 Owner activation | **Not started** | Needs Phases 0–3. Runbook text for 4.4/4.5 is stale after wave 1 (section 6). |
| 4b Nightly tending | **Partially prepared** | 4b.1 migration and 4b.3 preference were applied Nov 1. No scheduling migration exists; no `tend-connect-v3` evaluation receipt. |

Hosted state last verified by anyone: November 1–2. Everything hosted in this document
is "as last receipted", not re-verified today.

The three things that most change the plan:

1. **`private.ai_runtime` and the monthly budget are both global.** With one real
   account, "owner only" is true by headcount, not by mechanism (section 5).
2. **The owner's account is already armed.** `tend_overnight=true` and two topics with
   tending on (Nov 1). The moment `enabled=true` coexists with a nightly cron job, real
   writing is queued at 02:00 Pacific. Nothing else needs to change for that to happen.
3. **The configuration reviewed on Nov 2 is not what the worker sends.** Nov 2 used
   synchronous requests at reasoning effort `low`; the Batch worker's request builder
   sets no reasoning effort. An evaluation receipt has to be made on the exact request
   the worker will send.

## 2. Phase 0 receipts (executed today)

Environment: cloud session, Linux, Node v22.23.4, Docker Engine 29.9.2, Supabase CLI
2.109.1 via `npx`. Observer: the agent. Working tree as found on 2026-11-16 (UTC
01:08–01:15); the tree was being edited by other engineers during the run.

| # | Command | Observed | Verdict |
|---|---|---|---|
| 0.1 | `node --test services/garden-worker/runtime.test.mjs` | exit 0; tests 31, pass 31, fail 0, skipped 0 | **Go** |
| 0.2 | `node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json` | exit 0; `ok: true`; scenarios 8, passed 8, failed 0; provider counts: uploads 8, batches 9, cancels 2, downloads 5, deletes 21, `files_remaining: 0` | **Go** |
| 0.3 | Inspect the report (by eye, then a script listing every string value) | Keys are names, states, checks and counts only. 45 distinct strings, longest 38 characters, none containing whitespace; the only non-identifier values are the timestamp and `offline-fake-provider`. `content_free: true` (the script's own leak self-check). | **Go** |
| 0.4 | Records review (section 3) | Not a single required item is recorded for the configuration that would run | **No-go** |
| 0.5 | Records review (section 4) | No finding is rated high or critical (the review assigns no severities). Worker-path gaps F-3, F-5, F-6, F-10 and the T-07 concurrency gap are open and not accepted in the decision log. | **Blocked on owner** (accept the gaps in writing, or close them) |
| 0.6 | `supabase start` (database-only, same `--exclude` list as CI), `supabase db lint --local --schema public,private --level warning --fail-on error`, `supabase test db --local supabase/tests` | Seven migrations applied in order through `20261010004736_tending_tiers.sql`. Lint: "No schema errors found". pgTAP: 3 files, **109 tests, Result: PASS**. `supabase gen types typescript --local --schema public` diffed against `applications/web/src/types/database.ts`: no difference. | **Go** for the seven migrations on main |

Notes on these receipts:

- **0.2 output location.** `artifacts/generated/` is ignored by the root `.gitignore`
  (line `artifacts/generated/`), so the report was written there as the runbook says.
  The batch count is one higher than uploads because one scenario deliberately creates
  a batch for an already-settled pass to prove it is not downloaded.
- **0.6 was a real local run, with three qualifications.**
  1. It ran in an isolated copy of `supabase/` in the session scratchpad (project id
     `slow-garden-activation-check`, ports moved to 563xx) so it could not collide
     with the other engineers' stack. Migration and test files were byte-copies taken
     at 01:09 UTC.
  2. The Docker daemon was not running; I started `dockerd` locally. Image pulls from
     `ghcr.io` (CI's registry) and `public.ecr.aws` were refused by this session's
     network policy, so images came from `docker.io`
     (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`, Postgres image `17.6.1.143`).
  3. `supabase start` printed a "failed to cache migrations catalog" (pg-delta)
     warning, the same class of warning the Nov 1 receipt recorded. Migrations still
     applied and the stack reported healthy.
- **A new migration appeared during the run and is not covered.**
  `supabase/migrations/20261116010931_in_app_deletion.sql` (312 lines, another
  engineer's work in progress) was added to the tree after my copy. It creates
  `private.provider_orphans` and a `before delete` trigger on `private.pass_inputs`,
  i.e. the orphan-cleanup change runbook 3.9 is waiting for. 0.6 must be rerun when
  that migration and its tests are final. I did not test it.
- **CI evidence (cited, not mine).** The CI `database` job was green on main's last
  pull request. Nov 1 recorded run `39065498712` green for `1645ef6`.

Additional offline checks run today (not runbook rows):

| Command | Observed |
|---|---|
| `node --test tests/evaluation/corpus.test.mjs tests/evaluation/corpus-v3.test.mjs` | exit 0; tests 16, pass 16, fail 0 |
| `node services/garden-worker/evaluation/prepare.mjs artifacts/generated/garden-evaluation-a` and `…-b`, then `diff -r` | both exit 0; status `packet-valid`, 48 cases, 0 problems; the two packets are byte-identical; manifest status `awaiting-generation-and-human-review` |
| `node services/garden-worker/evaluation/evaluate-v3.mjs --out artifacts/generated/evaluate-v3.json` | exit 0; 30 cases; 30 rejected outputs, 24 refused by validators, 6 left to human review; family coverage 8/6/6/5/5 all met; integrity problems 0 |
| `scripts/test-upgrade.sh` (unmodified copy, run in a scratch tree with a dedicated `slow-garden-web-thinking` stack on 573xx ports, seven committed migrations) | exit 0; final line reports all 30 source revisions, timestamps and ids preserved, latest entry and full export verified |
| `node applications/web/scripts/audit-gate.mjs` (queries the npm registry only) | exit 0; "No unexcepted high or critical advisories". The one listed exception expired 2026-11-09 and was not needed. |

Hashes from today's tree, for whoever writes the 0.4 receipt:

| Item | SHA-256 |
|---|---|
| connect-v2 corpus (48 cases) | `caa8fb84f8b2a4396a981ae93eb1f399bf3382ce379280ae74425eb5397bca3d` |
| connect-v2 prompt / schema | `905f2a5d…0c8ba1` / `29b0d113…619217` (full values in `manifest.json`) |
| v3 corpus (30 cases) | `5a397b1fcd07620ca685ce72f7ddcf0cb8b59c6504d9a2adb720e5412d9b98cb` |
| v3 tend prompt | `801d8031928252fbc7634cff502741b78071d826747ec9fbf8f18a6ae05377ba` |
| v3 connect prompt | `b3c9b594328ef492e8a49bde81474866503c0970d3d450dba02a4a1f0c190bcf` |
| v3 tend schema | `e69af47951c33fff99582c24821c885f130a7387962ddaf3dce8f8aa6963d579` |
| v3 connect schema (all kinds) | `ef5c869fa92821a8df978002554388b11128e089ef7a1755ec1ca9cd093fe6a5` |

These are valid only while `supabase/functions/_shared/garden-runtime.mjs` and the
corpora are unchanged; recompute at evaluation time.

Not executed today, stated plainly:

- `run-model.mjs` (it calls a provider; it also refuses without `--owner-approved`,
  `--model` and a key).
- `scripts/test-web-journeys.mjs` and `scripts/test-local-http.mjs` (they need a full
  local stack with Auth and a production web build; outside Phase 0 and inside files
  other engineers are changing).
- `/Users/kylematthies/Code/bin/workspace-guard` (AGENTS.md): the path does not exist
  in this environment. The only repository change from this session is this file;
  everything else went to ignored `artifacts/generated/` or the session scratchpad.
- Any hosted read. The project-scoped Supabase connection also failed to connect in
  this session (network policy), so no hosted state could have been read even if
  authorised.

Local side effect to know about: the Docker daemon I started is still running, and
another engineer's `supabase_db_slow-garden` container is now using it. My two stacks
were stopped with `--no-backup`.

## 3. Check 0.4 — evaluation receipt: what exists, what is missing

The runbook (Phase 0, row 0.4) requires all of: model snapshot, workflow version,
prompt/schema hashes, corpus outputs, blinded scores, and Kyle's acceptance of the
small return format. Any missing item is a no-go.

| Required item | Exists? | Source |
|---|---|---|
| Model snapshot pinned | **No.** `gpt-6.1-sol` was used on Nov 2; it is written without a dated snapshot suffix and is not recorded as a pin. Hosted `ai_runtime.model` was null on Nov 1 and "restored to its original disabled/unapproved configuration" on Nov 2. | SUPERVISED_TENDING_2026-11-02 "Result"; TENDING_STATUS_2026-11-01 "Verified cause" |
| Workflow version | **No accepted version.** Nov 2 ran `tend-connect-v3-supervised-sync-20261102`, a one-off synchronous variant. The hosted default is `connect-v2-unapproved`. No `tend-connect-v3` version has been approved. | Same; migration `20260907004656`, `ai_runtime` default |
| Generation settings | **Mismatch.** Nov 2: reasoning effort `low`, synchronous Responses, `store:false`, no tools. The Batch worker (`requestFor`, `requestLine` in `garden-runtime.mjs`) sends `store:false` and a strict schema but no reasoning-effort field. ADR-004: changing prompt, schema, adapter or model "creates a workflow version and full regression". | SUPERVISED_TENDING "Result"; ADR-004 "Consequences" |
| Prompt/schema hashes | **Computable, not recorded against a model run.** Today's values are in section 2. No receipt ties hashes to model output. Two integration fixes landed on Nov 2 (source role, reasoning-metadata parsing), so earlier hashes are superseded. | evaluation/README "Thresholds" last paragraph; SUPERVISED_TENDING "Integration fixes discovered" |
| Corpus outputs | **Partly, privately, not acceptable as a receipt.** A "stable 30-case Sol run" exists under a local Codex evidence directory outside the repository. The record itself says the first Sol trial "is not treated as a controlled acceptance run". No output exists for the 48-case packet or its five baselines; today's manifest status is `awaiting-generation-and-human-review`. | SUPERVISED_TENDING "Synthetic checks and limitations"; 04-evaluation-corpus "Not verified" |
| Blinded scores | **No.** "This is a supervised synthetic review, not blinded human scoring". | SUPERVISED_TENDING "Synthetic checks and limitations" |
| Owner acceptance of the small return | **No.** Requires a blinded Wizard-of-Oz study; "Desk review cannot satisfy that gate." The real Nov 2 pass returned four marks and zero blooms, so the owner has not yet seen a real bloom to accept or reject. | EVALUATION_ARCHITECTURE "Release thresholds", last paragraph |
| `tend-connect-v3` thresholds, tiers 1–3 | **Deterministic part passes; human part unscored.** Today: 30 cases, 24 of 30 rejected outputs refused by validators, 6 reserved for human review. None of label faithfulness ≥ 95%, zero clinical labels, open questions 100% exact, unfinished ≥ 90%, echo precision ≥ 80%, pattern precision ≥ 85%, question grounding, brevity, or tier lock has a blind score. Nov 2 observed "Recall was conservative: some expected labels and a half-finished resurfacing example yielded no return", which bears directly on the unfinished ≥ 90% threshold. | EVALUATION_ARCHITECTURE "tend-connect-v3 additions (ADR-008)"; runbook 4b.1 |
| Cost inside the soft cap | **Indicative only.** One real pass: 2,062 input and 468 output tokens, 0.8804 cents at $2/$10 per million. Batch pricing is unverified. | SUPERVISED_TENDING "Result"; COST_AND_CAPACITY "Current rate evidence" |

What Nov 2 does establish: nano and mini candidates were "structurally valid but
semantically poor" and were ruled out; Sol produced a valid result for all 30 cases
with two invalid marks dropped by the validator.

## 4. Check 0.5 — security review: where the worker path stands

Source: SECURITY_REVIEW_2026-09.md, dated 2026-09-10, status line "hosted verification
pending". It predates the tending-tiers migration (2026-10-10) and both November
receipts. Its numbers are stale (it cites 14 runtime tests and 53 database assertions;
today 31 and 109), but no later review replaces it.

| Worker-path threat | Review status | Open item | Accepted anywhere? |
|---|---|---|---|
| T-02 service credential reaches browser or logs | Inspection | F-5: no built-bundle scan, no secret scanner | No |
| T-03 note text in logs, traces, queue | Inspection | F-6: no content-free logging canary. Runbook 2.5 would receipt this for the worker. | No |
| T-04 prompt injection | Receipt (runtime, offline) | "Adversarial corpus and zero-tool-call gate belong to initiative 4/5; not re-verified here." Folded into 0.4. | n/a |
| T-05 cross-garden leak | Receipt (partial) | F-4: no mixed-owner test at the worker layer | No |
| T-06 invented evidence | Receipt (database boundary) | Faithfulness is 0.4 | n/a |
| T-07 duplicate delivery | Receipt | "Concurrency (parallel claim) not tested." Runbook 3.6 would receipt it. | No |
| T-12 backup restore | Gap | F-9: "No restore drill receipt exists." Same as runbook 3.10. | No |
| T-13 deletion misses provider files | Receipt (partial) | F-10: no deletion-graph test, provider-file cleanup receipt pending. Same as runbook 3.9. | No |
| Edge Function dependencies | Not covered | F-3: no `deno.lock` audit. Today the function imports only its own shared module (no third-party import), so the exposure is small. | No |

Reading against the runbook's criterion ("worker-related threats have receipts or
explicitly accepted gaps"; no-go on an "open high/critical finding"): there is no
finding rated high or critical, because the review rates nothing. The gaps are
enumerated but none is recorded as accepted in `documents/DECISION_LOG.md`. Several
close themselves if Phases 2–3 are run (F-6 via 2.5, T-07 via 3.6, F-10 via 3.3/3.9,
F-9 via 3.10). The honest status is: **go only after the owner records acceptance of
F-3, F-4 and F-5 for the owner-only phase**, with the rest closed by the canaries.

One item the review could not have seen: the temporary authenticated function used on
Nov 2 was deployed and deleted without a code or log review on record.

## 5. Ledger, Phases 1–4b

Columns: status from the records; who acts; action; evidence to record; reversibility.
"Agent" means an agent using the project-scoped Supabase connection with tool approval
on (SUPABASE_CHANGE_WORKFLOW "Agent access"), restricted to catalog, policy and count
reads plus reviewed writes. Project ref `sskrghiigqimvxcileqb`.

### Phase 1 — provider and secrets

| # | Status | Who | Action | Evidence | Reversible |
|---|---|---|---|---|---|
| 1.1 | **Never receipted.** Note: real writing from two topics (three revisions) was sent on Nov 2 before this check had a receipt. | Owner, OpenAI console and published data-controls page | Read and record: API and Batch inputs/outputs not used for training; retention window for `store:false` Responses, Batch files and abuse monitoring | Date, source URLs, the retention figures, who read them | n/a (a record) |
| 1.2 | **Unknown.** Nov 1 step 1 asked for a "dedicated provider project and budget"; Nov 2 says only that the key was saved and tested. | Owner, OpenAI console | Confirm a project used only by Slow Garden; set its monthly budget at or below the hard cap | Project name, limit value, date. No key material. | Yes |
| 1.3 | **Partial / unknown.** A key exists somewhere. Nov 1: "No provider key is currently installed in the hosted project." Whether Nov 2 stored it as a function secret, and whether it survived the temporary function's deletion, is unrecorded. `GARDEN_WORKER_SECRET`: no record. | Owner in a terminal or the Supabase dashboard (Edge Functions → Secrets). An agent must not handle values. | `supabase secrets set --project-ref sskrghiigqimvxcileqb OPENAI_API_KEY=… GARDEN_WORKER_SECRET=…` typed by the owner; then `supabase secrets list` | Secret **names** present; confirmation they are absent from Vercel env (Production holds only the Supabase URL and publishable key per the bootstrap receipt), `.env.local` and Git | Yes: `supabase secrets unset`; revoke the key at the provider |
| 1.4 | **Never run** | Owner | `openssl rand -base64 48`, pasted directly into 1.3 and, later, Vault | "Generated with a CSPRNG, 48 bytes, stored in two places", date | Yes: rotate |

Recommendation: because the Nov 2 key passed through a temporary function and an
agent-run session, rotate it as part of 1.3 rather than reuse it.

### Phase 2 — worker deployed, runtime disabled

| # | Status | Who | Action | Evidence | Reversible |
|---|---|---|---|---|---|
| 2.1 | **Never run** for the permanent worker. `supabase/config.toml` has no `[functions.garden-worker]` block, so the JWT setting must come from the deploy flag. | Agent with deploy approval, or owner | `supabase functions deploy garden-worker --project-ref sskrghiigqimvxcileqb --no-verify-jwt` | Function name, flag, version, date; function list shows only `garden-worker` | Yes: `supabase functions delete garden-worker` |
| 2.2 | Never run | Owner or agent (no secret needed) | `curl -s -o /dev/null -w '%{http_code}' -X POST https://sskrghiigqimvxcileqb.supabase.co/functions/v1/garden-worker`, then again with `-H 'Authorization: Bearer wrong'` | Two status codes, both 401 | n/a |
| 2.3 | Never run | Owner (holds the secret) | Same POST with the real secret from a shell variable | Status 200 and body `{"state":"idle"}` | n/a |
| 2.4 | Never run | Owner | Preview/branch only. Reasonable to record "skipped: no branch; covered by reading `index.ts`, which returns 503 before any work when the key is absent". | Observed 503, or the skip and its reason | n/a |
| 2.5 | Never run | Agent (function logs are metadata) | Read function logs for the 2.2–2.3 invocations | "No request or provider body text in N log lines", date | n/a |

### Phase 3 — synthetic deployed canaries

Precondition status: **fails as written.** The runbook requires
`select count(*) from public.plots where ai_enabled and tenant_id <> '<synthetic>'` to
be 0; the owner's two topics have been on since at least Nov 1. Turning them off to
satisfy the check is not harmless: the `plots_permissions` trigger sets every
`complete` pass on that topic to `withdrawn`, which would withdraw the Nov 2 result.
See owner decision 6.

| # | Status | Who | Action (as the synthetic tenant unless noted) | Evidence | Reversible |
|---|---|---|---|---|---|
| Pin and enable | Never run with a real pin | Agent, on owner go | `update private.ai_runtime set model='<snapshot>', workflow_version='<approved>', input_cents_per_million=<n>, output_cents_per_million=<n>, soft_cap_cents=1000, hard_cap_cents=1500, approved_at=now() where singleton;` read back; then `set enabled=true` | Read-back row (no content) | Yes, via Rollback order only |
| 3.1 Submit | Never run. Offline analogue passed today (`submit_and_complete`). | Agent inserts a synthetic pass; owner ticks the worker and reads the provider console | Insert into `public.garden_passes` as the synthetic user; POST the worker | `provider_id` set once; console shows one batch, one input file | Cancel the pass |
| 3.2 Complete | Never run on Batch. Nov 2's synchronous pass is explicitly not this receipt. | Agent | Wait for the batch; read status, bloom count, `ai_months` | `status=complete`, blooms ≤ 3, `spent_cents` up, `reserved_cents` released, actual tokens | Spend is not reversible |
| 3.3 Cleanup | Never run | Owner (console) and agent | Provider file list; `cleanup_pending` | No `garden.jsonl` for the pass; `cleanup_pending=false` | n/a |
| 3.4 Cancel in flight | Never run. Offline analogue passed. | Agent | `update public.garden_passes set status='cancelled'` while the batch is `in_progress`; tick | `cancelled`, batch `cancelled`, files deleted, reservation released, in that order | n/a |
| 3.5 Expiry | Never run. Offline analogues passed (deadline and provider). | Agent | Backdate a synthetic pass's `created_at` past 30 h (operator write); tick. A provider-side 24 h expiry cannot be forced; record it as offline-only unless it occurs. | `failed`, batch cancelled, files deleted, full reservation charged | Costs one reservation |
| 3.6 Idempotency | Never run. Provider `Idempotency-Key` support is "unverified" (runbook "Known gaps"). | Owner ticks twice inside one lease | Two POSTs in quick succession | Second response is `idle`, `waiting` or `lease_lost`; console shows one batch | n/a |
| 3.7 Budget stop | Never run. Offline analogue passed. | Agent | Lower `hard_cap_cents` to one reservation, insert a second pass, restore | `AI budget reached` (55000); cap read back restored | Yes |
| 3.8 Permission revocation | Never run hosted. pgTAP covers the database side (109 assertions today). | Agent | Set `ai_enabled=false` on the synthetic topic mid-flight | `cancelled` or `withdrawn`; no readable blooms as the tenant | n/a |
| 3.9 Account deletion with pending work | **Not executable today.** The enabling migration is in the working tree, unmerged and untested by me. | Agent, after that migration passes CI and its own hosted go/no-go | Delete the synthetic account while `cleanup_pending=true`; tick | `provider_orphans` row created then drained; console shows no remaining files | Deletion is not reversible (synthetic only) |
| 3.10 Hosted restore | **Never exercised** (also F-9). | Owner: needs a Supabase branch or scratch project, which is a cloud resource and may carry cost | Restore to a branch; count passes, blooms, `ai_months` rows | Restore receipt with counts | Delete the branch |
| End of phase | — | Agent | Rollback order: cancel, drain both counts to zero, then `enabled=false`; delete the synthetic account only after `cleanup_pending` is zero | The two zero counts, then the disabled read-back | — |

Ticking the worker in Phase 3: no scheduler exists. Either the owner POSTs by hand
from a shell holding the secret, or the worker-tick half of the 4b scheduling
migration is installed first (owner decision 8).

### Phase 4 — owner activation

| # | Status | Who | Action | Evidence | Reversible |
|---|---|---|---|---|---|
| Gate | Not met | Owner | 3.9 and 3.10 receipted or accepted in the decision log | Decision entry | — |
| 4.1 | Never run. Expected `spent_cents` should include the Nov 2 charge (0.8804 cents) only if it fell in the current budget month; November's row should show it. | Agent (count read) | `select month, reserved_cents, spent_cents from private.ai_months order by month desc limit 2` | The numbers | n/a |
| 4.2 | Never run | Agent, on owner go | `update private.ai_runtime set enabled=true where singleton` with Phase 3's pin unchanged | Read-back row | Rollback order |
| 4.3 | Never run | Depends on decision 8 | Scheduler POSTs every five minutes | One tick observed returning `idle` | Unschedule |
| 4.4 | Never run. **Not re-verified since September**: the deployed value of `GARDEN_AI_ENABLED` (runbook status paragraph). Wording stale (section 6). | Owner, Vercel project settings, then redeploy | Set `GARDEN_AI_ENABLED=true` for Production only | Deployment id, date; landing page and Returns observed | Yes: set false, redeploy |
| 4.5 | Never run through the permanent Batch worker. Nov 2 was a real pass through a temporary synchronous function: four marks, zero blooms. | Owner, in the product | Returns → "Invite a reflection" on a topic set to Tending on | State sequence; blooms ≤ 3; each links to source revisions; gold AI material distinct from "Your words" | Cancel the pass; prune returns |
| 4.6 | Never run | Agent drafts, owner confirms | Activation receipt | Date, model, workflow, rates, caps, scheduler, state sequence | — |

### Phase 4b — nightly tending

| # | Status | Who | Action | Evidence | Reversible |
|---|---|---|---|---|---|
| 4b.1 migration | **Receipted 2026-11-01**: `20261010004736_tending_tiers.sql` applied with `supabase db push --linked --yes`, ledger read back | — | Re-read the migration ledger before relying on it | Ledger row | Additive |
| 4b.1 evaluation | **Missing** (section 3) | Owner scores | See decision 2 | 0.4 receipt | — |
| 4b.2 scheduling migration | **Does not exist** in the repository (Nov 1: "No scheduling migration currently exists"; still true today). Hosted had no `pg_cron`/`pg_net` on Nov 1. | An engineer writes it with `supabase migration new`; CI; agent applies on owner go; owner stores two Vault secrets | Runbook SQL; store `garden_worker_url` and `garden_worker_secret` in Vault first; confirm a tick with the runtime disabled returns null | Migration version in ledger; `cron.job` rows (names and schedules); null tick | `select cron.unschedule(...)`; a later migration to drop |
| 4b.3 preference | **Already applied 2026-11-01**: `tend_overnight=true`, timezone `America/Los_Angeles`, read back. The runbook places this after 4b.2; it happened first. | Agent (count read) | Confirm no other account has it: `select count(*) from public.accounts where tend_overnight` must be 1 | The count | Yes: set false (also the 4b rollback) |
| 4b.4 observe one night | Never run | Owner in the morning; agent for counts | After 02:00 Pacific plus up to 24 h of Batch latency | Passes per scope, states, bloom counts ≤ 3, mark counts, cost; log check for body text | — |
| 4b.5 nightly receipt | Never run | Agent drafts, owner confirms | States, counts, costs | Receipt | — |

### What "global singleton" means now

Read from the committed migrations today:

- `private.prepare_pass` refuses a pass only when `ai_runtime.enabled` is false.
  `authenticated` holds `insert(id,tenant_id,garden_id,plot_ids)` on
  `public.garden_passes`. The web flag is checked only in the web server action
  (`inviteReflection`). So with the runtime enabled, **any signed-in account can
  create a pass for its own topics by calling the data API directly**, whatever
  `GARDEN_AI_ENABLED` says.
- `authenticated` holds table-level `update` on `public.accounts` and `public.plots`.
  The three-value tending control and the "Tend my garden overnight" checkbox are
  shown and savable with the web flag off. So **any account can arm itself for
  nightly tending**, and `enqueue_nightly_passes` selects every account with
  `tend_overnight` whose local hour is 2.
- `private.ai_months` is keyed by month only. **The soft and hard caps are one pool
  for the whole project.** There is no per-account cap beyond eight active passes and
  six nightly scopes.
- `GARDEN_AI_ENABLED` is one value per deployment. Setting it true shows the invite
  control to every signed-in account and removes the "private preview" lines from the
  public landing page for every visitor.

Consequences for an owner-only activation:

1. "Owner only" holds exactly as long as the owner is the only account. It was the
   "existing sole account" on Nov 1; that has not been re-read since, and sign-up is
   open (email one-time code; `enable_signup = true` in the committed config).
2. Before every `enabled=true`, and weekly, take three content-free counts:
   `select count(*) from public.accounts` (expect 1, or 2 with the synthetic tenant);
   `select count(*) from public.plots where ai_enabled and tenant_id <> '<owner>'`
   (expect 0 outside Phase 3); `select count(*) from public.accounts where
   tend_overnight and id <> '<owner>'` (expect 0).
3. A stranger who signs up cannot read the owner's writing (RLS is unaffected), but
   could send their own writing to the provider on the owner's key and spend the
   shared budget. The worst case is bounded by the hard cap and the provider limit.
4. The synthetic tenant in Phase 3 is itself a second account under the same flag
   and the same budget. It must be deleted afterwards, and only once its cleanup is
   drained.
5. Because the owner is already armed, a nightly cron job must not exist during any
   Phase 3 window in which the runtime is enabled.

## 6. Runbook text made stale (proposed edits, not applied)

Wave 1 ([delivery record](MARKET_READINESS_DELIVERY_2026-11-15.md), accepted by D-024)
moved the request control into Returns, introduced the Tending off / Tending on /
Tending on with cross-topic connection control, the morning reveal, and a landing page
that reads the flag. Checked against `applications/web/src` as it stood this morning.

**Step 4.4**

```diff
-4. Set `GARDEN_AI_ENABLED=true` for the web application. This shows the explicit
-   "invite a reflection" control only; it grants no automatic tending.
+4. Set `GARDEN_AI_ENABLED=true` for the web application's Production environment
+   and redeploy. The flag is deployment-wide, not per account. It (a) shows
+   "Invite a reflection" inside Returns for every signed-in account that has a
+   topic set to Tending on, (b) removes the "Overnight tending is in private
+   preview" lines from the public landing page, and (c) changes the tending copy
+   in topic settings, overnight settings and the Returns empty state from "not
+   active for this account yet" to active wording. It grants no automatic
+   tending. Before setting it, confirm the account and permission counts in
+   Phase 3's preamble, and confirm the landing page may truthfully drop the
+   preview lines.
```

**Step 4.5**

```diff
-5. Request one real manual pass on a plot with `ai_enabled=true`. Verify the return
-   is at most three blooms, each linked to exact source revisions, and that the
-   user-authored text and AI-derived text remain distinguishable in the UI.
+5. In the product, open Returns from the top bar on a topic set to Tending on
+   (`plots.ai_enabled=true`) and use "Invite a reflection". Verify the return is
+   at most three blooms, each linked to exact source revisions; that AI material
+   appears as "The garden noticed" in gold beside "Your words" clippings; that
+   catalogue marks appear beside thoughts and are not announced as a reveal; and
+   that the morning reveal card appears once for unseen blooms and not at all
+   for a zero-bloom return. At garden level Returns shows only the first topic
+   with tending on, so check each tended topic's Returns, or confirm bloom
+   counts per pass by a count query.
```

**Phase 3 preamble**

```diff
-`GARDEN_AI_ENABLED=false` in the web app so no real person sees a request control, give
-only the synthetic tenant's plots `ai_enabled=true`, and create passes only by direct insert
-as that tenant. Verify before enabling that no other plot has `ai_enabled=true`
-(`select count(*) from public.plots where ai_enabled and tenant_id <> '<synthetic>'`
-must be 0).
+`GARDEN_AI_ENABLED=false` in the web app so no real person sees a request control, and
+create passes only by direct insert as the synthetic tenant. The web flag does not
+gate the database: with the runtime enabled any signed-in account can insert a pass
+through the data API, and the Tending control and overnight preference are savable
+with the flag off. Verify before enabling:
+`select count(*) from public.accounts` is 2 (owner and synthetic);
+`select count(*) from public.plots where ai_enabled and tenant_id not in
+('<synthetic>','<owner>')` is 0; no `cron.job` row calls
+`private.enqueue_nightly_passes()`. The owner's topics may stay on only under a
+recorded owner decision: switching a topic off withdraws its completed passes.
+The monthly budget is one pool for the whole project.
```

**Enable line (column names; not wave 1, but wrong today)**

```diff
-Enable `private.ai_runtime.enabled=true` **only** after pinning `model`, `workflow`,
-`input_rate`, `output_rate`, `soft_cap_cents=1000`, `hard_cap_cents=1500`, and
-`approved_at`.
+Enable `private.ai_runtime.enabled=true` **only** after pinning `model`,
+`workflow_version`, `input_cents_per_million`, `output_cents_per_million`,
+`soft_cap_cents=1000`, `hard_cap_cents=1500`, and `approved_at`.
```

**Rollback step 1 and step 2**

```diff
-1. Set `GARDEN_AI_ENABLED=false` in the web application (hides the request control; no
-   new passes can be requested from the product).
+1. Set `GARDEN_AI_ENABLED=false` in the web application and redeploy (hides "Invite
+   a reflection" in Returns and restores the landing page's private-preview lines;
+   no new manual pass can be requested from the product). This does not stop
+   nightly enqueueing or direct data-API inserts; step 4 does. With the flag off
+   the Returns empty state says no AI has read the person's writing, which is
+   untrue for an account that has been tended; treat that copy as a known defect
+   until it is fixed.
```

```diff
-   (as the operator; the owner can do the same from the garden). The `passes_cleanup`
+   (as the operator; the owner can cancel a waiting pass from Returns). The `passes_cleanup`
```

**Phase 4 step 3 and Phase 4b step 2 (sequencing)**

```diff
-3. Configure the server-only five-minute scheduler to POST the worker with the worker
-   secret. Confirm one tick returns `idle`.
+3. Confirm the five-minute worker tick (installed by the worker-tick scheduling
+   migration, see 4b.2) is posting with the worker secret and that one tick returns
+   `idle`. The nightly enqueue job must not exist yet.
```

```diff
-   select cron.schedule('slow-garden-nightly', '7 * * * *', 'select private.enqueue_nightly_passes()');
-   select cron.schedule('slow-garden-worker', '*/5 * * * *', 'select private.tick_garden_worker()');
+   -- Migration A (before Phase 3 or Phase 4 step 3): worker tick only.
+   select cron.schedule('slow-garden-worker', '*/5 * * * *', 'select private.tick_garden_worker()');
+   -- Migration B (Phase 4b only, after the Phase 4 receipt): nightly enqueue.
+   select cron.schedule('slow-garden-nightly', '7 * * * *', 'select private.enqueue_nightly_passes()');
```

**Phase 4b step 3**

```diff
-3. Set `accounts.tend_overnight=true` and `accounts.timezone` for the dogfood account
-   only.
+3. Confirm `accounts.tend_overnight=true` and `accounts.timezone` for the dogfood
+   account (set 2026-11-01; the control is "Tend my garden overnight" in overnight
+   tending settings) and that no other account has it:
+   `select count(*) from public.accounts where tend_overnight` is 1.
```

**Other stale lines, lower priority**

- Runbook 0.2 description lists seven scenario kinds; the canary now runs eight (a
  two-stage partial-completion scenario was added with v3).
- Runbook 3.9 and "Known gaps": update once `20261116010931_in_app_deletion.sql`
  lands, since it implements the proposed `provider_orphans` table.
- `documents/operations/README.md` still describes wave 1 as "not merged or deployed
  to production"; D-024 records PR #31 as merged.
- Product copy, not runbook: `level-returns.tsx` says "no AI has read your writing"
  whenever the flag is off. For the owner's account that has been untrue since Nov 2.
  This belongs to the web engineers; I did not edit it.

## 7. Owner decisions, most urgent first

1. **Model and snapshot to pin.** Evidence so far favours the Sol class (nano and mini
   ruled out on Nov 2). The pin must be the provider's dated snapshot identifier, read
   from the provider's model page by the owner; `gpt-6.1-sol` as written is not
   recorded as a snapshot. Also decide reasoning effort: add it to the worker's
   request builder (a workflow-version change by the runtime's owners) or evaluate at
   the provider default. Whatever is evaluated must be what ships.
2. **What counts as the 0.4 receipt for an owner-only activation.** By the letter
   (runbook 0.4, ADR-004 "Verification and rollback", EVALUATION_ARCHITECTURE) it is
   the 48-case five-baseline comparison, the 30-case v3 packet, blind scores against
   every threshold, and a Wizard-of-Oz acceptance. The shortest defensible form is: a
   fresh 30-case v3 run on the exact pinned configuration via `run-model.mjs
   --owner-approved`, blind-scored by the owner against the v3 thresholds, plus a
   decision-log entry that explicitly defers the five-baseline comparison and the
   Wizard-of-Oz study to before any external pilot. That is a deviation from ADR-004
   and only the owner can make it. Running `run-model.mjs` sends synthetic text to the
   provider and requires 1.1 and 1.2 first.
3. **Provider account (1.1, 1.2) and key rotation.** Confirm the dedicated project,
   set its budget, record the retention terms with URLs and date, and decide whether
   to rotate the Nov 2 key (recommended).
4. **Monthly caps and rates.** Keep the runbook's 1000/1500 cents for Phase 3. For
   steady state the only real datum is 0.88 cents per pass at $2/$10 per million; one
   cross-topic scope per night is roughly 30 passes a month, well under a dollar at
   that size. A lower hard cap (for example 300 soft / 500 hard) would still leave an
   order of magnitude of headroom and shrinks the exposure in section 5. Rates to pin
   are the Batch rates on the provider's pricing page on the day; if unsure, pin the
   standard rates, which over-reserve rather than under-reserve. The current defaults
   (1000/5000 cents per million) are five times the Nov 2 standard rates.
5. **3.9 and 3.10: wait or accept.** 3.9: recommend waiting; the migration is being
   built today and the owner-only path never deletes the owner's account, so the cost
   of waiting is small and it also unblocks in-app deletion. 3.10: either spend on a
   Supabase branch for a restore drill, or record acceptance that a restore during
   the owner-only phase is untested (a restore could bring back passes whose provider
   files are already deleted, or drop `ai_months` spend).
6. **Phase 3 with the owner's topics left on.** Accept the deviation from the
   "count must be 0" precondition (recommended; record it), or switch the two topics
   off for the duration and accept that the Nov 2 pass becomes `withdrawn`.
7. **Owner-only enforcement.** Choose: rely on headcount plus the three counts
   (section 5), or also close new sign-ups in Supabase Auth for the owner-only period
   (reversible, but the public landing page then invites sign-ups that fail), or
   commission a per-account allowlist (a schema change with its own ADR; required
   before any second real account either way).
8. **Scheduler.** `pg_cron` + `pg_net` + Vault per ADR-008 and the runbook
   (recommended; no new vendor), split into a worker-tick migration and a later
   nightly-enqueue migration as proposed in section 6; or hand-ticked worker during
   Phase 3 and a single migration at 4b.
9. **Web flag.** Setting `GARDEN_AI_ENABLED=true` is needed for truthful in-product
   copy once tending runs, and it changes the public landing page for everyone.
   Decide whether that is acceptable during an owner-only phase, or whether the web
   engineers should first separate "landing preview copy" from "this account is
   tended". Nightly tending itself does not depend on the web flag.
10. **Security gaps for 0.5.** Record acceptance of F-3, F-4 and F-5 for the
    owner-only phase, or schedule them.

## 8. Shortest safe path to nightly tending on the owner's garden only

1. Decisions 1–4 and 10, recorded in the decision log (D-024 authorises the run, not
   these choices).
2. 1.1, 1.2; then the evaluation run and blind scoring; write the 0.4 receipt.
3. Orphan-cleanup migration merged with green CI; rerun 0.1, 0.2, 0.6; hosted apply
   through SUPABASE_CHANGE_WORKFLOW steps 6–8.
4. 1.3, 1.4; Phase 2 (2.1–2.5).
5. Worker-tick migration (A) applied; tick returns null while disabled.
6. Phase 3 with a synthetic tenant, nightly job absent: 3.1–3.9, 3.10 or its
   acceptance; drain; disable; delete the synthetic account.
7. Phase 4: counts, enable, tick `idle`, web flag (per decision 9), one manual Batch
   pass, receipt.
8. Phase 4b: nightly-enqueue migration (B); observe one night; receipt; weekly checks.

Nothing in steps 4–8 can be skipped on the strength of Nov 1–2: those receipts
themselves say they do "not satisfy Batch cancellation, idempotency, provider-file
cleanup, restore or recurring-night acceptance".

## 9. Proposed day-by-day sequence (each hosted step keeps its go/no-go)

Dates assume the owner is available daily and Batch jobs finish within a few hours;
a full 24-hour batch window pushes later days by one.

| Day | Owner | Agent / engineers | Exit condition |
|---|---|---|---|
| Mon Nov 16 | Decisions 1–10. Provider console: 1.1, 1.2. | This document. Engineers: finish the orphan-cleanup migration; draft scheduling migrations A and B; decide the reasoning-effort question in the runtime. | Decisions in the decision log; 1.1 and 1.2 receipted |
| Tue Nov 17 | Approve and run the synthetic evaluation from own terminal (key never leaves it); blind-score the outputs. | Rerun 0.1, 0.2, 0.6 on the merged tree; prepare the blind review sheet; hosted apply of the deletion/orphan migration on owner go. | 0.4 receipt written; Phase 0 all go |
| Wed Nov 18 | 1.3, 1.4 (rotate key, set both secrets). 2.3 with the secret. | 2.1 deploy, 2.2, 2.5 log read; apply migration A; Vault secrets set by owner; null tick observed. | Phase 1 and 2 receipted |
| Thu Nov 19 | Go for Phase 3 enable. Watch the provider console for 3.1, 3.3, 3.6. | Create the synthetic tenant; pre-enable counts; pin and enable; 3.1, 3.2, 3.3, 3.6, 3.7. | First five canaries receipted |
| Fri Nov 20 | Console checks for 3.4, 3.5; branch restore for 3.10 if chosen. | 3.4, 3.5, 3.8, 3.9, 3.10; then cancel, drain to zero, `enabled=false`; delete the synthetic account. | Phase 3 receipted or residuals accepted; runtime read back disabled |
| Sat Nov 21 | Go for Phase 4. Set the web flag (per decision 9). Invite one reflection from Returns. | 4.1 counts, 4.2 enable, 4.3 tick `idle`. | Pass reaches `processing` |
| Sun Nov 22 | Read the return in the product; confirm authorship is distinguishable. Go for 4b. | 4.6 activation receipt; apply migration B after the receipt. | Phase 4 receipted; nightly job scheduled |
| Mon Nov 23 | Morning: look at Returns. | 4b.4 counts (passes per scope, states, blooms, marks, cost), log check; 4b.5 receipt. If the batch is still running, repeat Tuesday. | Nightly receipt |
| Weekly after | Glance at spend. | Runbook "Ongoing go/no-go" table plus the three owner-only counts in section 5. | — |

Stop conditions at any point: any canary no-go; any account count other than
expected; any log line with body text; spend above the soft cap. In each case follow
the runbook's Rollback order (cancel, drain, disable last).

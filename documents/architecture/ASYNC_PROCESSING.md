# Asynchronous processing architecture

Status: Accepted control-plane contract; provider integration pending live spike
Date: 2026-08-25

## Principle

“Async AI” is a product timing model, not a vendor feature. Slow Garden owns the durable state before and after a provider request. The provider is a replaceable compute stage that receives one immutable snapshot and returns untrusted structured candidates.

## Why Batch, queue, and ledger are separate

- **Cron** discovers eligible work and reconciles jobs; it is not the job record.
- **Queue** delivers short tasks and may redeliver; it is not the user-visible state.
- **Job ledger** records every attempt, lease, provider ID, usage, and terminal reason.
- **OpenAI Batch** performs asynchronous model requests within its own lifecycle; it is not the garden-pass state machine.
- **Garden pass** is the product object Kyle reviews and can cancel, retry, or see become stale.

## Trigger model

| Trigger | Behavior | Permission effect |
|---|---|---|
| Manual “Let this grow” | Creates one eligibility request from latest eligible revisions | Does not alter cadence or depth |
| Weekly cadence | Cron considers enabled gardens in owner timezone | Does not run if evidence, budget, or permission gate fails |
| New note | Records a source revision only | Never directly starts processing in H1/H2 |
| Processing-depth change | Applies only to future snapshots | Does not resubmit an existing pass |
| Correction | Affects future passes through a versioned rule | Does not rewrite a completed pass |

This rejects database-triggered AI on every edit: it would violate quiet capture, create noisy costs, and couple user writes to provider availability.

## Control flow

```text
eligibility scan
  -> transactional snapshot + pass + outbox
  -> enqueue dispatch(pass_id)
  -> dispatcher claims ledger lease
  -> budget and permission recheck
  -> serialize exact snapshot to JSONL request
  -> create provider batch; record provider ID and request hash
  -> reconciliation scan polls nonterminal provider jobs
  -> download result/error files when terminal
  -> validate schema and every evidence handle
  -> persist 0-3 blooms and usage in one transaction
  -> mark complete, failed, cancelled, expired, partial, or stale
  -> reveal only after transaction commits
```

Queue payloads contain `event_version`, `event_id`, `pass_id`, `attempt_id`, and `not_before`; never source content.

## Idempotency

| Operation | Key | Duplicate result |
|---|---|---|
| Create snapshot/pass | hash of owner, garden, manifest, mode, workflow version | Return existing pass |
| Enqueue stage | `pass_id:stage:attempt_no` | Existing outbox/queue receipt |
| Provider request line | `pass_id:attempt_id:request_hash` as provider custom ID | Ignore duplicate output after first accepted hash |
| Persist result | `attempt_id:output_hash` | Return existing terminal receipt |
| Respond to bloom | client UUID | Return existing response |
| Promote bloom | `bloom_id:destination:preview_hash` | Return existing promotion receipt; never double-write |

Application code must assume at-least-once invocation even if a queue advertises stronger delivery inside a visibility window.

## State mapping

| Product pass state | Ledger/provider evidence |
|---|---|
| queued | durable pass and outbox exist; no active provider ID required |
| snapshotting | transaction in progress; not externally visible until committed |
| processing | active dispatch or provider job in validating/in-progress/finalizing |
| partially_complete | terminal provider output has independent valid results and failures; only supported complete blooms eligible |
| complete | validated zero-to-three blooms and terminal usage receipt committed |
| failed | terminal non-retryable error or retry budget exhausted; no trustworthy result |
| cancelled | cancellation requested and no result accepted after cutoff |
| superseded | a newer pass is the default return |
| stale | one or more cited current source heads differ from snapshot revisions before review |

Provider “completed” never directly means product “complete.” Validation and persistence must succeed.

## Retry and failure policy

| Failure class | Retry | Limit and behavior |
|---|---|---|
| Network/5xx/rate limit before provider ID | Yes | Exponential delay with jitter, maximum 5 dispatch attempts over 6 hours |
| Provider validation failure | Once after fixing only transport formatting | Same request semantics and snapshot; otherwise fail |
| Provider expiry at 24h | User-visible expired failure | One automatic resubmission only if garden permission, budget, and staleness checks pass |
| Individual request failure | Once | New attempt linked to failed request; never rerun successful output silently |
| Output schema/evidence failure | Once | Quarantine raw output, retry with pinned corrective workflow; then no-output failure |
| Database persistence conflict | Yes | Same output hash, maximum 5 attempts; idempotent transaction |
| Budget exceeded | No | `blocked_budget`; no provider call |
| Permission revoked or garden paused | No | Cancel queued work; do not dispatch |

Raw quarantined output is restricted, encrypted with the same data class, and deleted after 7 days unless explicitly retained for a private evaluation.

## Cancellation semantics

- Before provider dispatch: cancel immediately and delete queued/outbox work.
- After provider creation: request provider cancellation and mark `cancelling`; provider work may continue temporarily.
- No result whose ingestion starts after the cancellation cutoff becomes visible.
- Charges already incurred may remain; the cancellation receipt reports known usage and uncertainty.
- Cancellation never deletes the underlying snapshot or sources.

## Staleness and supersession

At reveal, compare every cited seed’s current revision ID with the snapshot revision. A changed source marks the bloom stale but preserves it as historical evidence. A stale bloom cannot be promoted until the user accepts the historical basis or requests a new pass. Newer passes supersede older unreviewed returns only in the default view; history stays available.

## Model contract

- Endpoint: Responses request carried by Batch.
- Model: configuration points to a pinned snapshot, not a floating alias, after evaluation.
- Tools: none for Tend and Connect. Explore is a later, separately budgeted workflow.
- Input: system policy, workflow version, correction rules, source handles/content, bounded layout relations, and required output schema.
- Output: strict JSON schema with 0-3 blooms, atomic claims, source handles, contradiction handles, uncertainty language, and no-output reason.
- Maximum input: 100k tokens for alpha. Larger gardens must use an explicitly reviewed bounded selection, never silent truncation.
- Prompt, schema, policy, adapter, model snapshot, and repository commit hashes persist with every attempt.

## Scheduling

- Eligibility Cron: hourly; evaluates weekly cadence in owner timezone and inserts transactional outbox rows.
- Dispatch Cron: every 5 minutes; invokes a short Edge Function to drain bounded queue batches.
- Reconciliation Cron: every 15 minutes for active provider jobs, slowing after six hours.
- Watchdog Cron: hourly; releases expired leases and marks jobs beyond lifecycle limits.
- Manual pass writes the same outbox event; it has no privileged fast path.

Cron expressions and provider polling frequency are environment configuration. Domain deadlines live in the database so replacing Cron does not change semantics.

## Provider portability

The adapter interface is limited to `submit(manifest)`, `status(provider_job_id)`, `cancel(provider_job_id)`, `download(provider_job_id)`, and `usage(provider_job_id)`. Canonical requests and outputs use Slow Garden schemas. A new provider must pass the same privacy checklist, structured-output conformance tests, evaluation corpus, cancellation probe, and cost cap before it can receive real data.


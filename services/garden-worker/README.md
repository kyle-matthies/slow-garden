# Manual reflection runtime

Implemented: tenant snapshots, mutual cross-plot permission checks, bounded model return,
source/excerpt validation, job leases, cancellation/reconciliation, budget reservations,
append-only review responses, provider-file cleanup, an owner-only allowlist, two provider
transports (batch and synchronous), and a gated scheduler. No provider has been activated;
the November 16 migrations are not applied to the hosted project.

Run deterministic worker checks from the repository root:

    node --test services/garden-worker/runtime.test.mjs
    node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json
    node services/garden-worker/evaluation/prepare.mjs artifacts/generated/garden-evaluation

The canary dry run drives `runOne` against an in-memory ledger and a fake provider using
synthetic text only. Its twenty scenarios cover the batch path (submit, cancel in flight,
deadline and provider expiry, budget stop, duplicate provider results, a lost lease, staged
partial completion), the allowlist (an empty list runs nothing), and the synchronous path
(complete, staged partial completion, timeout mid-call, timeouts to the dispatch limit,
lease lost after the provider answered, duplicate invocation, budget stop at redispatch,
cancel in flight, provider errors, oversized snapshot, the function time limit). It prints
a content-free JSON report (states and counts, never text). It proves control flow offline;
it is not a hosted receipt.

## Who may run: the allowlist

`private.ai_tenants` lists the accounts tending may run for. The database enforces it
where a pass is created (including a direct data-API insert), where nightly passes are
enqueued, and where the worker claims and publishes. With the list empty nothing runs,
even with `private.ai_runtime.enabled=true`. Only the operator or the service role can
change it. Removing an account cancels its queued and in-flight passes; their cleanup
still runs. A refused person sees SQLSTATE 55000, "tending is not available for this
account yet".

## Transports

`private.ai_runtime.transport` is `batch` (default) or `sync`, frozen into each pass
when it is prepared, together with `reasoning_effort` (null means the field is not sent).

- **batch**: one JSONL file and one batch per pass, polled on later ticks; files are
  deleted after terminal evidence. Discounted by the provider; not eligible for zero
  data retention according to `PRIVACY_ARCHITECTURE_OPTIONS.md` (evidence grade S).
- **sync**: one Responses call per stage with `store:false`, both stages concurrently,
  settled in the same invocation. No file, no batch, nothing to clean at the provider.
  The request cannot be recalled once sent: a cancellation that arrives mid-call
  discards the answer and records only its cost.

Everything else is shared: the frozen snapshot, the staged requests, validation in the
worker and again in SQL, budget reservation and settlement, expiry, and the lease.

Sync bookkeeping (`public.mark_garden_dispatch`): every provider call is recorded
before it is made, at most three per pass. A call that never reports back (timeout,
crash, lease lost after the answer) has unknown usage, so the next dispatch first books
the full reservation as spend and the hard cap can refuse it. A call the provider
refused outright is closed without a charge. `private.pass_inputs.lost_cents` shows
what was booked this way.

Sync time budget (`syncLimits` in the shared runtime): provider call 90 s, lease 120 s
from the dispatch mark, invocation 140 s. These assume an Edge Function must answer
within 150 seconds; **that limit was not verified against Supabase documentation** (no
copy of it exists in this repository and no hosted system was contacted).

The provider sits behind the small interface documented above `httpProvider` in
`supabase/functions/_shared/garden-runtime.mjs`. Only the OpenAI adapter exists;
another vendor is a new workflow version with its own evaluation (ADR-004).

## Scheduling

`20261116023939_garden_scheduling.sql` installs `pg_cron` and `pg_net` and three jobs.
`private.tick_garden_worker()` (every five minutes) posts to the worker only when the
Vault secrets `garden_worker_url` (https) and `garden_worker_secret` exist and there is
work: an active pass while the runtime is enabled, or cleanup that is still owed.
`private.tick_nightly_enqueue()` (hourly) enqueues only when the runtime is enabled,
`private.ai_runtime.nightly_enabled` is true and the worker is configured. Both return
null otherwise. A third job keeps a week of cron history.

## Job lifecycle rules

- A pass older than 30 hours (`passDeadlineMs`) is failed on the next tick. If a provider
  batch exists and is not terminal, cancellation is requested first; the result of an
  expired pass is never downloaded. A provider batch that reports `expired` fails the pass.
- Terminal passes are cleaned on later ticks: input, output and error files are deleted only
  after the batch reports a terminal status. A batch already `cancelling` is not re-cancelled.
- Provider output must be exactly one line for this pass; more than one line is rejected as
  `duplicate_provider_result` and the pass fails without storing anything.
- A ledger error (including a lost lease) ends the tick with `lease_lost` and no further
  writes; the ledger's `finish_garden_pass` is idempotent, so a pass is settled at most once.
- Retryable provider errors release the lease up to five attempts; other errors fail the pass.

The generated review packet has 48 synthetic cases and five comparison variants.
It does not constitute model generation, a blinded study, or a passing quality receipt.
Use the existing evaluation architecture for the full release rubric. Human judgment
is required for faithfulness and value; a valid quote alone does not prove a claim.

## Activation gate

Keep `private.ai_runtime.enabled=false` and `GARDEN_AI_ENABLED=false` until:

1. Record evaluated model snapshot, workflow version, prompt/schema hashes, corpus
   outputs, blinded scores, and Kyle's acceptance of the small return format.
2. Verify provider privacy/retention, actual costs, uncertain dispatch handling,
   cleanup, cancellation and expiry through synthetic deployed canaries.
3. Set the worker-only secrets `OPENAI_API_KEY` and `GARDEN_WORKER_SECRET` using the
   provider's secure configuration path. Never commit values or give browsers a service key.
4. Deploy `supabase/functions/garden-worker` with JWT verification disabled only
   for this endpoint: it checks its separate scheduler secret before any work.
5. Store the worker URL and secret in Vault so the scheduled tick can reach the worker.
   This dispatches explicit invitations; nightly tending has its own switch.
6. Allowlist the account in `private.ai_tenants`. Pin `ai_runtime.model`, workflow,
   reasoning effort, transport, actual input/output rates and `approved_at` exactly as
   evaluated; enable runtime, then enable the web UI.

Provider files are private transient artifacts and are deleted after terminal evidence.
Unknown usage conservatively retains the reserved cost; reconcile invoices separately.
Database queues must be drained after disabling new passes so cancelled artifacts can
be cleaned. An account deleted while cleanup is outstanding leaves its provider ids in
`private.provider_orphans`, which the worker drains.

## Known release gates

The runtime is not approved for real notes. The
[activation runbook](../../documents/operations/AI_ACTIVATION_RUNBOOK.md) lists every
go/no-go check. Expired jobs, duplicate results, both transports and the allowlist have
runtime tests and an offline canary; hosted receipts for provider retry/idempotency,
account deletion with pending provider work, the synchronous transport, the scheduler and
a hosted restore exercise are still outstanding. What was built and run on November 16
is in the [prerequisites record](../../documents/operations/ACTIVATION_PREREQUISITES_2026-11-16.md).
The worker is executable scaffolding behind these gates.

# Manual reflection runtime

Implemented: tenant snapshots, mutual cross-plot permission checks, bounded model return,
source/excerpt validation, job leases, cancellation/reconciliation, budget reservations,
append-only review responses, and provider-file cleanup. No provider has been activated.

Run deterministic worker checks from the repository root:

    node --test services/garden-worker/runtime.test.mjs
    node scripts/canary-dry-run.mjs --out artifacts/generated/canary-dry-run.json
    node services/garden-worker/evaluation/prepare.mjs artifacts/generated/garden-evaluation

The canary dry run drives `runOne` against an in-memory ledger and a fake provider using
synthetic text only. It exercises submit, cancel in flight, deadline and provider expiry,
budget stop, duplicate provider results, and a lost lease, then prints a content-free JSON
report (states and counts, never text). It proves control flow offline; it is not a
hosted receipt.

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
5. Configure a server-only five-minute scheduler to POST to the worker with the
   worker secret. This dispatches explicit invitations; it does not grant automatic tending.
6. Pin `ai_runtime.model`, workflow, actual input/output rates and `approved_at`;
   enable runtime, then enable the web UI. Keep the $10/$15 soft/hard budget defaults.

Provider files are private transient artifacts and are deleted after terminal evidence.
Unknown usage conservatively retains the reserved cost; reconcile invoices separately.
Database queues must be drained after disabling new passes so cancelled artifacts can
be cleaned. Do not delete accounts while their provider cleanup remains outstanding.

## Known release gates

The runtime is not approved for real notes. The
[activation runbook](../../documents/operations/AI_ACTIVATION_RUNBOOK.md) lists every
go/no-go check. Expired jobs and duplicate results now have runtime tests and an offline
canary; hosted receipts for provider retry/idempotency, account deletion with pending
provider work (needs a proposed migration, see
[initiative 05](../../documents/initiatives/05-activation-readiness.md)), and a hosted
restore exercise are still outstanding. Automatic nightly/weekly eligibility is deliberately deferred
until manual returns earn value. The worker is executable scaffolding behind these gates.

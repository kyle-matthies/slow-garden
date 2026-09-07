# Manual reflection runtime

Implemented: tenant snapshots, mutual cross-plot permission checks, bounded model return,
source/excerpt validation, job leases, cancellation/reconciliation, budget reservations,
append-only review responses, and provider-file cleanup. No provider has been activated.

Run deterministic worker checks from the repository root:

    node --test services/garden-worker/runtime.test.mjs
    node services/garden-worker/evaluation/prepare.mjs artifacts/generated/garden-evaluation

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

The runtime is not approved for real notes. Exact provider retry/idempotency behavior,
expired provider jobs, account deletion with pending provider work, and a hosted restore
exercise require receipts. Automatic nightly/weekly eligibility is deliberately deferred
until manual returns earn value. The worker is executable scaffolding behind these gates.

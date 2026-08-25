# Bounded architecture spikes

These probes turn high-risk rules into executable checks without scaffolding the production application prematurely.

| Spike | Status | What it proves | What remains |
|---|---|---|---|
| [Job ledger](job-ledger/README.md) | Passed | Deduplication, cancellation cutoff, stale state, max-three persistence | Postgres concurrency and queue integration |
| [Provenance validator](provenance-validator/README.md) | Passed | Exact handle/excerpt and mode constraints can reject bad output | Strict schema parser and adversarial corpus |
| [Offline conflict](offline-conflict/README.md) | Passed | Base revisions preserve divergent edits and collapse retry | IndexedDB/WebCrypto/Safari behavior |
| [Cost model](cost-model/README.md) | Passed | Expected/stress/runaway scenarios exercise caps | Current invoice, attachments, backup provider |

Spike code is disposable. Its acceptance rule must move into production tests before the spike is retired.


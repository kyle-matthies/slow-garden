# Job-ledger spike

Status: Passed as a domain-model probe on 2026-08-25

Question: Can a minimal ledger preserve pass deduplication, event deduplication, maximum-three output, stale state, idempotent result ingestion, and cancellation cutoff without trusting queue delivery semantics?

Run:

```bash
node spikes/job-ledger/job-ledger.mjs
```

Expected receipt:

```json
{"passes":2,"persistedBloomSets":1,"assertions":"passed"}
```

This proves the state rules can coexist in a deterministic model. It does not prove Postgres transaction isolation, queue behavior, or concurrent workers; those remain explicit integration backlog gates.


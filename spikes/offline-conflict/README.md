# Offline-conflict spike

Status: Passed as a sync-semantics probe on 2026-08-25

Question: Can queued mutations use a base revision and idempotency key so retries collapse while divergent text preserves both versions for explicit resolution?

Run:

```bash
node spikes/offline-conflict/offline-conflict.mjs
```

This proves the merge contract, not browser persistence. IndexedDB encryption, eviction, reload, and iPhone Safari remain runtime spike S2.


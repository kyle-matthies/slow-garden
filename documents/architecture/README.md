# Architecture work area

Do not treat this directory as proof that an architecture has been selected. It holds evidence, decisions, and diagrams produced during roadmap Phase 2.1.

Required artifacts before production implementation:

- System context and trust-boundary diagram.
- Source, revision, snapshot, bloom, provenance, response, evaluation, and job-ledger data model.
- API and event contracts with idempotency and compatibility rules.
- Batch lifecycle, retry, cancellation, stale-result, and no-output semantics.
- Offline capture and sync-conflict strategy.
- Authentication, authorization, encryption, retention, deletion, export, backup, and recovery design.
- Prompt and model versioning contract.
- Threat model and privacy review.
- Capacity, performance, cost, and provider-portability models.
- Architecture decision records for every material choice.

No production migration should be added until the owning decision is accepted and rollback is documented.

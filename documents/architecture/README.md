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

## Current decision package

- [Architecture baseline](ARCHITECTURE_BASELINE.md)
- [Data and provenance](DATA_AND_PROVENANCE.md)
- [Asynchronous processing](ASYNC_PROCESSING.md)
- [Privacy, security, and threat model](PRIVACY_SECURITY_THREAT_MODEL.md)
- [Cost and capacity](COST_AND_CAPACITY.md)
- [Evaluation architecture](EVALUATION_ARCHITECTURE.md)
- [ADR-001: Managed hybrid system](ADR-001_ALPHA_SYSTEM.md)
- [ADR-002: Async control plane](ADR-002_ASYNC_CONTROL_PLANE.md)
- [ADR-003: Data and trust boundary](ADR-003_DATA_AND_TRUST_BOUNDARY.md)
- [ADR-004: Model and evaluation](ADR-004_MODEL_AND_EVALUATION.md)

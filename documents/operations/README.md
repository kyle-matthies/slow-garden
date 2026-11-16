# Operations work area

This area will hold:

- Environment and release strategy.
- CI/CD and promotion gates.
- Secrets and access policy.
- Observability, alerting, cost budgets, and runbooks.
- Backup, restore, deletion, and disaster-recovery evidence.
- Incident response and privacy-event procedures.
- Release receipts and dogfood reports.

Local tests, merge state, deployment state, live behavior, and external receipt are separate gates. Do not collapse them into “shipped.”

Current plan: [Private-alpha implementation backlog](ALPHA_IMPLEMENTATION_BACKLOG.md).

Runbooks: [AI activation runbook](AI_ACTIVATION_RUNBOOK.md) (go/no-go checks; the runtime stays disabled until every check has a receipt).

Delivery records: [Market readiness wave 1, 2026-11-15](MARKET_READINESS_DELIVERY_2026-11-15.md) (local checks only; not merged or deployed to production).
[Static export build target, 2026-11-16](STATIC_EXPORT_2026-11-16.md) (ADR-009 stage 3; built and checked locally only; no native shell exists).

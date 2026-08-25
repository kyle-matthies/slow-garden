# ADR-002: Product-owned asynchronous control plane

- Status: Accepted
- Date: 2026-08-25
- Owner: Kyle
- Roadmap phase: 2.1

## Context

Scheduled database work, queue delivery, and provider batch jobs each expose different lifecycle semantics. None alone represents the user-visible seed-to-bloom pass.

## Options considered

| Option | Reliability | Product-state fit | Complexity | Decision |
|---|---:|---:|---:|---|
| Database trigger calls model on every edit | Low coupling tolerance | Violates quiet capture | Low initially | Rejected |
| Codex scheduled task scans notes | Weak product receipts and tenancy boundary | Useful for a workbench experiment, not core app | Low | Deferred to H3 |
| Server scheduler plus direct long request | Timeout/cancellation risk | Partial | Moderate | Rejected |
| Cron + durable queue + Postgres ledger + provider batch | Strong with idempotency | Exact lifecycle mapping | Moderate | Selected |
| General durable-workflow vendor | Strong | Strong | Highest platform surface | Fallback if measured orchestration exceeds selected stack |

## Decision

Use Supabase Cron for eligibility/reconciliation, a logged server-only queue for delivery, Postgres as the durable ledger, short-lived idempotent Edge Functions, and OpenAI Batch over Responses as the initial provider adapter. Queue events contain IDs only.

## Evidence and rationale

The official provider APIs support the required pieces, but application idempotency remains necessary. The executable ledger spike passed duplicate-trigger, duplicate-event, stale-result, cancellation-cutoff, and result-ingestion invariants.

## Consequences

Manual passes use the same asynchronous path. Provider completion is not product completion until schema/evidence validation commits. A 24-hour provider window matches the product but requires clear expiry semantics.

## Verification and rollback

Run local concurrent-worker tests and a live provider cancellation/expiry spike. If Edge Function/Cron reconciliation misses the 30-minute terminal-ingestion SLO or requires more than two compensating mechanisms, adopt a durable workflow engine behind the same event contracts.


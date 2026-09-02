# ADR-005: Personal secure multi-tenant product

- Status: Accepted
- Date: 2026-09-02
- Owner: Kyle
- Roadmap phase: 2.2

## Context

Slow Garden began as a private local proof of concept for one owner. That constraint helped validate quiet capture, delayed return, provenance, and the Meadow/Cabinet interaction without prematurely handling accounts or cloud data. It is not the intended product boundary.

The product will support many independent people while preserving the privacy model of a personal journal. “Public product” means publicly available software, not publicly readable garden material.

## Decision

Use one Supabase project per environment and model each authenticated person as one tenant. The tenant identifier is the Supabase Auth user UUID. Every exposed application row carries `tenant_id`; database relationships include the tenant key so a child row cannot reference a parent in another tenant.

Row Level Security is the primary authorization boundary. Every policy combines `TO authenticated` with `tenant_id = (select auth.uid())`. The anonymous role receives no application-table privileges. Immutable source revisions receive `SELECT` and `INSERT` only. The service role never ships to a client.

Use the existing SwiftUI application as the primary mobile client. Add a Next.js App Router companion deployed on Vercel for desktop capture and review. Both clients use the Supabase publishable key and the same RLS-protected data model. Privileged or long-running processing remains behind server-controlled functions and queues.

## Explicit non-goals for the first slice

- No anonymous reads or public profiles.
- No public garden, seed, bloom, or attachment URLs.
- No shared tenants, invitations, roles, or team collaboration.
- No automatic movement of personal material into public examples, analytics, model training, or marketing.
- No service-role proxy for ordinary reads and writes.

## Data model

- `accounts.id` equals the authenticated user UUID and establishes the tenant.
- `gardens`, `seeds`, and `seed_revisions` carry the same `tenant_id`.
- Composite foreign keys include `tenant_id` to prevent cross-tenant graph construction even if application code is wrong.
- Source revisions are append-only. Updates create a new revision rather than replacing text.
- A later publishing feature, if approved, must create a separate explicitly public artifact; it may not relax policies on private source tables.

## Verification gate

Before real personal material reaches a hosted environment:

1. Run the migration against an isolated environment.
2. Prove two synthetic authenticated users cannot select, insert, update, delete, or cross-link each other’s rows.
3. Confirm the anonymous role receives zero application rows and cannot mutate any application table.
4. Run Supabase security and performance advisors.
5. Scan client bundles and repository history for secret or service-role credentials.
6. Verify account export, session revocation, and deletion behavior with synthetic data.

## Consequences

This architecture intentionally postpones collaboration. Adding membership roles later will require a new ADR and a more complex, separately tested authorization model. Tenant-per-user keeps the first public product understandable and makes privacy failures easier to detect.

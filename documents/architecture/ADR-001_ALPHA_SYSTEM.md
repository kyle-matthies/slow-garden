# ADR-001: Managed hybrid private-alpha system

- Status: Accepted
- Date: 2026-08-25
- Owner: Kyle
- Roadmap phase: 2.1

## Context

Slow Garden needs offline quiet capture, cross-device access, transactional provenance, and scheduled processing. A full local-first sync engine would put the highest implementation risk ahead of validating the temporal loop.

## Options considered

| Option | User impact | Engineering impact | Privacy/security | Cost | Reversibility |
|---|---|---|---|---|---|
| Cloud-only Supabase | Weak offline capture | Low | Mature RLS | Low | High |
| Full local-first database | Excellent offline | High sync/conflict complexity | Strong local control | Medium | Medium |
| Supabase authority plus IndexedDB outbox | Reliable capture and cross-device return | Moderate | Explicit device/cloud boundary | Low | High |
| Local-only | Strong privacy, no cross-device background return | Moderate | Strongest cloud minimization | Low | Medium |

## Decision

Use a React/Vite PWA with an encrypted IndexedDB mutation outbox and Supabase Postgres as authoritative storage. Use a TypeScript monorepo and keep provider interfaces behind versioned contracts.

## Evidence and rationale

Source text conflicts require explicit resolution and strong transactions; only capture needs to work fully offline. The hybrid gives the core loop both properties without adopting a general sync engine.

## Consequences

Safari offline behavior and conflict resolution require a bounded spike. Device plaintext remains a documented threat. Native iOS can later reuse HTTP contracts.

## Verification and rollback

Pass the offline and canvas thresholds in `ARCHITECTURE_BASELINE.md`. If Safari cannot reliably preserve encrypted queued edits, ship read-only offline plus explicit local draft export before private alpha; do not silently drop offline writes. If managed-operator privacy becomes unacceptable, revisit a local-encryption architecture before external beta.


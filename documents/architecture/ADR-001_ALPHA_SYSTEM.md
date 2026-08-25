# ADR-001: Native-first managed private-alpha system

- Status: Accepted
- Date: 2026-08-25
- Owner: Kyle
- Roadmap phase: 2.1

## Context

Slow Garden needs offline quiet capture, cross-device access, transactional provenance, scheduled processing, and an excellent one-handed mobile experience. The primary client is native iOS; web is a companion for desktop review and curation. A full peer-to-peer local-first sync engine would put unnecessary implementation risk ahead of validating the temporal loop.

## Options considered

| Option | User impact | Engineering impact | Privacy/security | Cost | Reversibility |
|---|---|---|---|---|---|
| Cloud-only Supabase | Weak offline capture | Low | Mature RLS | Low | High |
| Full local-first database | Excellent offline | High sync/conflict complexity | Strong local control | Medium | Medium |
| Supabase authority plus platform-local outboxes | Reliable capture and cross-device return | Moderate | Explicit device/cloud boundary | Low | High |
| Local-only | Strong privacy, no cross-device background return | Moderate | Strongest cloud minimization | Low | Medium |

## Decision

Use a SwiftUI iOS application as the primary client, with encrypted device-local storage and a mutation outbox. Use a React/Vite web companion with an encrypted IndexedDB outbox. Supabase Postgres is authoritative after synchronization. Keep provider interfaces behind versioned, platform-neutral HTTP/event/schema contracts; do not require shared UI code.

The H1 mobile prototype uses the Product Design `mobile-app` web runtime only to test the selected Meadow/Cabinet interaction. It is disposable evidence, not the production SwiftUI architecture.

## Evidence and rationale

Source text conflicts require explicit resolution and strong transactions; capture and review need to remain useful offline. A local outbox per client plus server authority gives the core loop both properties without adopting a general sync engine.

## Consequences

iOS local persistence, background synchronization, protected-file behavior, and conflict resolution require bounded spikes. The web companion separately requires Safari/Chromium offline testing. Device plaintext while rendered remains a documented threat.

## Verification and rollback

Pass the offline and rendering thresholds in `ARCHITECTURE_BASELINE.md`. If iOS cannot reliably preserve and synchronize encrypted queued edits, block private alpha rather than silently dropping writes. If the web companion cannot preserve queued edits, ship it read-only offline with explicit local draft export. If managed-operator privacy becomes unacceptable, revisit a local-encryption architecture before external beta.

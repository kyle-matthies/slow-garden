# ADR-003: Immutable source lineage and approval boundary

- Status: Accepted
- Date: 2026-08-25
- Owner: Kyle
- Roadmap phase: 2.1

## Context

The product can only earn interpretive trust if originals, snapshots, derived claims, corrections, and accepted knowledge remain distinguishable and recoverable.

## Decision

Use immutable source/layout revisions, immutable snapshot manifests, atomic bloom claims with exact evidence links, append-only responses, visible garden-scoped correction rules, and explicit promotion receipts. Model output is untrusted until deterministic validation. No H1/H2 workflow executes external actions.

## Evidence and rationale

This directly implements the accepted trust contract and Kyle Knowledge authority boundary. It supports reruns, staleness, deletion, and comparison without allowing AI prose to overwrite evidence. The bounded provenance-validator probe rejects unknown handles, bad excerpts, missing evidence, excess blooms, and research in Connect.

## Consequences

Storage grows append-only until retention compaction. Exports and deletion are graph operations. Promotion integrations require a destination adapter and receipt but cannot bypass preview/approval.

## Verification and rollback

Schema tests must prove immutability, ownership, maximum-three constraint, evidence completeness, staleness, idempotent promotion, and complete deletion. Physical indexes and partitioning may change; the semantic source/derived boundary cannot be rolled back silently.

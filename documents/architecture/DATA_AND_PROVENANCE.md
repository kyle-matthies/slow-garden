# Data and provenance contract

Status: Accepted logical model; physical migration pending local spike
Date: 2026-08-25

## Invariants

1. A user edit creates a new source revision; background work cannot update source content.
2. A snapshot is immutable and names every exact source and layout revision processed.
3. A garden pass processes exactly one snapshot under one workflow, prompt, policy, and model configuration.
4. Every bloom claim has at least one exact evidence link or is rejected before persistence.
5. External research evidence and personal source evidence use different evidence types.
6. Corrections append responses and rules; they do not rewrite history.
7. Promotion creates a new user-owned artifact and receipt; it never changes the bloom’s authorship class.
8. Queue and logs contain identifiers and status metadata, not note bodies or bloom prose.
9. A user can export or delete the complete lineage rooted in a garden.
10. RLS ownership applies at every user-visible table, even when ownership is transitively derivable.

## Core relations

Every identifier is UUID, every mutable record has `created_at`, and every owner-scoped record carries `owner_id`. Enumerations below are database-constrained text values so states cannot drift from the domain package.

| Relation | Purpose | Key fields and constraints |
|---|---|---|
| `garden` | Processing and privacy boundary | `id`, `owner_id`, `title`, `status`, `cadence`, `mode`, `version`; unique owner/title only if user requests it |
| `seed` | Stable source identity | `id`, `garden_id`, `owner_id`, `kind`, `status`, `current_revision_id`; source class fixed as user-owned |
| `seed_revision` | Immutable source content | `id`, `seed_id`, `owner_id`, `revision_no`, `body`, `content_hash`, `base_revision_id`, `created_by_device`; unique `(seed_id, revision_no)` and `(seed_id, content_hash)` where appropriate |
| `layout_revision` | Immutable user-authored spatial context | `id`, `seed_id`, `owner_id`, `x`, `y`, `width`, `height`, `bed_id`, `base_layout_revision_id` |
| `attachment` | Object manifest | `id`, `seed_revision_id`, `owner_id`, `bucket`, `object_key`, `media_type`, `byte_size`, `sha256`, `processing_permission`, `backup_status` |
| `garden_snapshot` | Frozen processing input | `id`, `garden_id`, `owner_id`, `snapshot_seq`, `manifest_hash`, `policy_version`, `created_at`; unique `(garden_id, snapshot_seq)` and manifest hash |
| `snapshot_item` | Snapshot membership | `snapshot_id`, `seed_revision_id`, `layout_revision_id`, `ordinal`; unique source revision per snapshot |
| `garden_pass` | User-visible lifecycle | `id`, `snapshot_id`, `owner_id`, `mode`, `status`, `idempotency_key`, `requested_by`, `budget_cents`, `stale_at`; unique idempotency key |
| `job_attempt` | Provider-neutral job ledger | `id`, `pass_id`, `attempt_no`, `stage`, `status`, `provider`, `provider_job_id`, `request_hash`, `not_before`, `lease_until`, `error_class`, `usage_json`; unique `(pass_id, stage, attempt_no)` and provider ID when present |
| `workflow_version` | Reproducibility manifest | `id`, `name`, `semantic_version`, `prompt_hash`, `schema_hash`, `policy_hash`, `model_config`, `source_commit` |
| `bloom` | Derived return container | `id`, `pass_id`, `owner_id`, `rank`, `kind`, `headline`, `body`, `uncertainty`, `status`; check rank 1-3 and unique `(pass_id, rank)` |
| `bloom_claim` | Atomic derived assertion | `id`, `bloom_id`, `claim_no`, `text`, `claim_class`, `confidence_language`; no hidden numeric confidence shown to users |
| `evidence_link` | Exact claim support | `claim_id`, `evidence_type`, `seed_revision_id` or `research_source_id`, `excerpt_start`, `excerpt_end`, `support_role`; exactly one source type set |
| `research_source` | Explore-only external evidence | `id`, `owner_id`, `url`, `title`, `publisher`, `retrieved_at`, `content_hash`, `citation_excerpt` |
| `bloom_response` | Append-only user judgment | `id`, `bloom_id`, `owner_id`, `kind`, `edited_text`, `reason`, `created_at` |
| `correction_rule` | Visible garden-scoped memory | `id`, `garden_id`, `owner_id`, `rule_text`, `source_response_id`, `status`, `version` |
| `promotion_receipt` | Approval and projection audit | `id`, `bloom_id`, `owner_id`, `destination`, `preview_hash`, `approved_at`, `destination_receipt`, `status` |
| `evaluation_case` | Synthetic or explicitly approved test case | `id`, `privacy_class`, `input_manifest`, `expected_properties`, `corpus_version` |
| `evaluation_run` | Workflow regression run | `id`, `case_id`, `workflow_version_id`, `output_hash`, `status`, `usage_json` |
| `evaluation_score` | Human or deterministic judgment | `run_id`, `dimension`, `score`, `rater_kind`, `rationale`, `rubric_version` |
| `audit_event` | Content-free security/operation receipt | `id`, `owner_id`, `actor`, `action`, `target_type`, `target_id`, `metadata`, `occurred_at` |

## Immutability and deletion

- Application roles cannot update `seed_revision`, `layout_revision`, `garden_snapshot`, `snapshot_item`, `workflow_version`, or accepted provider manifests.
- “Delete” first tombstones the active source and excludes it from future snapshots. A retention worker later hard-deletes content in dependency order after the disclosed recovery window.
- Bloom provenance referencing a tombstoned source shows “source later deleted.” After hard deletion, only a non-reversible deletion receipt and hashes remain; excerpts are removed.
- Legal hold is out of scope for the private alpha.

## Snapshot construction

Snapshot creation runs in one database transaction:

1. lock the garden version;
2. select current eligible source and layout revisions ordered by stable seed ID;
3. record the current correction-rule versions and processing policy;
4. create snapshot and items;
5. compute a canonical manifest hash from IDs, content hashes, layout hashes, and policy version;
6. create one garden pass using `garden_id:snapshot_manifest_hash:mode:workflow_version` as its idempotency material;
7. commit before enqueueing through a transactional outbox record.

The worker reconstructs input only from snapshot items. It never queries “latest seeds.”

## Provenance validation

Model output cites opaque source handles mapped to revision IDs in the request manifest. Before a bloom persists:

- every cited handle must exist in the snapshot;
- every excerpt range must match normalized source text;
- every claim must have at least one supporting evidence link;
- contradictory evidence included by the model must be stored with `support_role = contradiction`;
- research handles are rejected in Tend or Connect mode;
- more than three blooms, unknown fields, invalid ranks, and unsupported classes reject the whole candidate set to quarantine.

Validation failure creates no user-visible bloom. It records a content-free error class and may retry once with the same snapshot and pinned workflow.

## API resource versions

All external contracts begin at `/v1`. Writes require:

- authenticated owner session;
- `Idempotency-Key` header for create/sync/pass operations;
- `If-Match` garden or source version for mutations that can conflict;
- response envelope containing `request_id`, `resource_version`, and server time.

Breaking semantic changes create `/v2`; additive optional fields remain in `/v1`. Stored workflow schemas are independently versioned from HTTP APIs.

## Export format

An export is a ZIP containing documented JSONL tables, Markdown source renderings, original attachments, checksums, and a manifest with schema version. It preserves source/derived classes, revisions, layout, exact provenance, responses, corrections, provider/workflow metadata, and promotion receipts. The import contract must reject missing checksums and cannot silently promote derived artifacts.


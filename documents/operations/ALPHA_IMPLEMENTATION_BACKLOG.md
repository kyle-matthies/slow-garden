# Private-alpha implementation backlog

Status: Decision-complete first plan; visual selection and runtime spikes remain gates
Date: 2026-08-25
Sizing: each item is intended to fit one to three focused implementation days

## Priority model

- **P0:** required for one trustworthy text-only seed-to-bloom loop.
- **P1:** required before real private dogfood.
- **P2:** valuable during dogfood but cannot weaken P0/P1 gates.

An item is complete only when its listed evidence exists. A commit or deployed function alone is not acceptance.

## Dependency order

```text
F0 repo/tooling
  -> F1 contracts -> F2 schema/RLS -> F3 auth
                    |                 |
                    +-> C1 source API +-> C2 offline sync
                    +-> B1 snapshot/ledger -> B2 fake provider -> B3 live provider
                    +-> E1 corpus/evaluator -----------+
                                                       v
Visual selection -> U1 garden -> U2 return/provenance -> U3 correction
                                                       |
Privacy/export/backup ---------------------------------+
                                                       v
                         integrated private-alpha gate
```

## Wave 0: Prove the risky seams

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| F0 | P0 | Scaffold pnpm monorepo, pinned toolchain, lockfile, lint/type/test scripts | none | Fresh clone installs reproducibly; CI runs format, lint, type, unit; no runtime secrets or production data |
| F1 | P0 | Implement domain enums, state transitions, API/event JSON schemas | F0 | Contract tests cover every documented pass/bloom state; unknown enum and >3 blooms fail |
| S1 | P0 | Canvas performance spike with 5/25/100/1,000 seeds | F0 | Desktop p95 frame <20 ms and iPhone p95 <33 ms at 1,000 logical nodes; input <100 ms; accessibility tree remains usable; fallback decision recorded if not |
| S2 | P0 | Safari offline/outbox spike with WebCrypto and IndexedDB | F0,F1 | Create/edit offline, reload, reconnect, and sign out on iPhone Safari; no lost writes; ciphertext at rest; key/cache gone after sign-out; explicit conflict produced |
| S3 | P0 | Postgres ledger concurrency spike | F1 | Two workers and duplicate events create one pass, one accepted output, max 3 blooms; cancelled late output invisible; tests run 100 repetitions |
| S4 | P1 | Live OpenAI Batch contract spike using synthetic inputs | F1 | Record submit/status/cancel/output/error/usage receipts; strict output parses; provider files deleted or retention gap documented; no real private data |
| S5 | P1 | Attachment backup/restore comparison | F0 | Select backup mechanism, restore 20 synthetic objects by checksum after primary deletion, document monthly cost and deletion window |
| D1 | P0 | Select/refine visual direction and produce state set | Kyle selection | Garden/Return/Bloom Detail plus 5/25/100 seeds, iPhone, reduced-motion, keyboard, large-text frames; source/derived comprehension gate passes |

## Wave 1: Trusted source foundation

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| DB1 | P0 | Migrations for garden, seed, immutable revisions, layout, snapshot, pass, ledger | F1,S3 | Up/down or compensating migrations tested on synthetic DB; constraints and indexes reviewed; database advisors have no unresolved security finding |
| DB2 | P0 | RLS, protected views/RPCs, and two-user negative suite | DB1 | Every table/API/storage path denies other owner; unauthenticated denied; update cannot change owner; service key absent from client bundle |
| A1 | P0 | Closed alpha email-code auth and session lifecycle | DB2 | Only allowlisted owner signs in; code single-use/expiry tested; sign-out clears local data; revoked session denied on sensitive endpoint |
| C1 | P0 | Revisioned seed CRUD and recoverable deletion API | DB1,DB2,A1 | Create/edit/history/trash/restore work; edit creates revision; provider identity cannot mutate source; idempotent writes and `If-Match` conflict tests pass |
| C2 | P0 | Offline sync and explicit text conflict UI | C1,S2 | 100 queued edits sync once after reconnect; divergent edit preserves both versions; no silent last-write-wins; recovery export offered on unrecoverable sync error |
| C3 | P1 | Private attachments and extraction permission | C1,DB2,S5 | Owner-only signed access, checksum manifest, size/type limits, excluded-by-default processing, malware/type failure state, backup receipt |
| C4 | P1 | Versioned export and deletion graph | DB1,C1,C3 | Export verifier reconstructs sources/layout/derived lineage and checksums; deletion canaries disappear from active stores/provider files and expire from disclosed backups |

## Wave 2: Quiet Garden

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| U1 | P0 | Selected Garden canvas, text capture, and structured-list alternative | D1,C1,S1 | Capture works with pointer/touch/keyboard; no AI interruption; 5/25/100/1,000-state thresholds; list alternative exposes all seed content and paths |
| U2 | P0 | Beds, user paths, spatial revision history, bounded chronology/search | U1,DB1 | Proximity is never stored as system truth; movement undo works; search returns exact owner-scoped sources and opens garden neighborhood |
| U3 | P1 | Responsive and accessibility hardening | U1,U2 | Automated checks plus keyboard, VoiceOver, 200% text, contrast, reduced motion, iPhone portrait receipts; no meaning depends on motion/color |

## Wave 3: Asynchronous return

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| B1 | P0 | Snapshot transaction, eligibility, outbox, budget reservation | DB1,C1 | Same manifest/mode/version returns same pass; edit after snapshot excluded; unchanged/sparse/budget-over cases do not enqueue; source capture latency unaffected |
| B2 | P0 | Queue dispatcher/reconciler with fake provider | B1,S3 | Every state/failure path reproducible; retries bounded; leases recover; logs/queue contain no canary content; cancellation cutoff holds |
| B3 | P1 | OpenAI Batch adapter and pinned workflow manifest | B2,S4,E1 | Synthetic canary passes submit/reconcile/validate within SLO; request/output hashes, model/prompt/schema/policy/usage persisted; provider failure never reveals output |
| B4 | P0 | Evidence validator and zero-to-three bloom persistence | B2,F1 | Unknown handle, bad excerpt, research in Connect, >3 blooms, unsupported claim, and injection output all reject; valid zero-output completes |
| B5 | P1 | Scheduling, manual pass, staleness, cancellation, cost kill switch | B1,B2 | Weekly owner-timezone dedupe; manual does not alter schedule; edit-during-pass marks stale; 100 duplicate triggers create one pass; hard cap produces zero provider calls |

## Wave 4: Return, correction, and evaluation

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| R1 | P0 | Bounded Return Reveal and bloom review | D1,B4,U1 | 0-3 reveal only; zero-output receipt does not pressure capture; state remains understandable without animation; private notification has no content |
| R2 | P0 | Exact provenance inspection | R1,DB1 | Every claim opens exact immutable revision/excerpt; contradiction visible; missing/deleted and stale sources handled; unknown evidence cannot render as valid |
| R3 | P0 | Keep/refine/coincidence/wrong-source/prune responses | R2 | Append-only responses; source unchanged; recurrence rule preview/revoke works; duplicate response ID creates one response |
| R4 | P1 | Promotion preview and receipt stub | R2,R3 | No destination write in alpha; preview clearly separates new artifact from source; cancel creates no receipt; adapter cannot execute without explicit approval capability |
| E1 | P0 | Versioned 48-case synthetic corpus and deterministic evaluator | F1 | All required case families present; protected cases excluded from CI; deterministic gates produce stable machine-readable report |
| E2 | P1 | Blind baseline runner and human rubric | E1,B3 | No-AI/immediate/weekly/Slow-Garden/negative-control comparison can be blinded; release thresholds calculated; raw scores and missing data preserved |
| E3 | P1 | Privacy-minimized product metrics | B4,R3 | Metrics contain IDs/status/count/cost only; canary source text absent; keep/correct rates never presented as standalone quality proof |

## Wave 5: Private-alpha operational gate

| ID | Pri | Package | Depends | Acceptance evidence |
|---|---|---|---|---|
| O1 | P1 | Local/preview/production environment and migration promotion | F0,DB2 | Synthetic-only preview, secret separation, migration/rollback rehearsal, no production data copied backward |
| O2 | P1 | Content-free observability, SLOs, alerts, cost controls | B5,E3 | Alerts fire for stuck job, failures, 50/80/100% budget, auth anomalies; canary content absent from logs |
| O3 | P1 | Backup, restore, and disaster drill | C4,S5,O1 | Database plus 20 attachments restored by checksum into isolated environment; RLS and lineage verifier pass after restore |
| O4 | P1 | Threat-model verification and incident/rotation drill | DB2,A1,C3,O2 | T-01 through T-13 receipts complete; processing kill switch and key/session rotation witnessed; known gaps explicitly accepted or block release |
| O5 | P1 | Integrated desktop/iPhone seed-to-bloom acceptance | all P0, O1-O4 | Offline capture through delayed return, provenance, correction, export, deletion, failure recovery, reduced motion, and budget stop verified end-to-end |

## P2 dogfood additions

- Explore-mode research packet behind a default-off flag only after Connect quality passes.
- Garden history and content-free pass cost details.
- Optional notification channel after content-free mobile testing.
- Attachment image understanding after extraction, backup, and separate cost/privacy review.
- Kyle Knowledge promotion adapter after the local preview/receipt stub is accepted.

## Explicitly rejected from alpha

- Chat as primary navigation or capture.
- Automatic workflow execution, code changes, messages, publication, or Agent Ops mutation.
- Team accounts, sharing, public links, and collaboration.
- Whole-vault ingestion, vector memory, or cross-garden synthesis.
- Mood scores, diagnosis, streaks, and engagement notifications.
- Native iOS before the web loop and Safari limitations are measured.

## Release definition

Private alpha is not “done” when the UI renders or a batch completes. It is ready only when O5 has an evidence bundle covering local tests, deployed state, live desktop/iPhone behavior, provider receipt, RLS negatives, backup/restore, export/deletion, cost stop, and the evaluation threshold. The four-week dogfood remains a separate product-validation gate.


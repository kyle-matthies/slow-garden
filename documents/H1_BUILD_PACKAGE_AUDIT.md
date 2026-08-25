# H1 build-package audit

Audit date: 2026-08-25
Evidence scope: current `main` worktree, generated design artifacts, executable local probes, and current official provider documentation
Conclusion: the H1 build package is decision-complete after the native-iOS-first correction. Kyle selected Meadow and Cabinet as two views of one garden; matched mobile targets now exist. Remaining density, accessibility, runtime, and study gates are implementation evidence, not missing product decisions.

## Requirement audit

| Objective requirement | Authoritative evidence | Finding |
|---|---|---|
| H0 product framing | [Product framing](product/PRODUCT_FRAMING.md) | Complete as a planning artifact: four jobs, current-workflow boundary, wedge, non-goals, and disconfirming evidence are explicit. Diary and transfer studies remain validation work, not missing framing. |
| Competitive/substitute research | [Competitive research](product/COMPETITIVE_RESEARCH.md) | Complete desk-research baseline across journals, canvases, agents, and innovation systems with a comparison set. Hands-on tests remain research work. |
| Trust and approval contract | [Trust contract](product/TRUST_AND_APPROVAL_CONTRACT.md) | Complete: permissions, artifact classes, correction, zero-output, density, data promises, non-clinical boundary, and anti-goals are specified. |
| Core journeys and state model | [Journeys and state model](design/JOURNEYS_AND_STATE_MODEL.md) | Complete for prototype implementation, including pass/bloom states, desktop/touch/keyboard/small-screen rules, notifications, provenance, and failures. |
| Three Flower-inspired visual directions | [Visual brief and generation receipt](design/VISUAL_DIRECTIONS_BRIEF.md) | Complete: exactly three Garden frames were generated from one inspected moodboard and shared constraints. |
| Evaluate the three directions | [Visual evaluation](design/VISUAL_DIRECTIONS_EVALUATION.md), [Meadow and Cabinet](design/MEADOW_AND_CABINET.md) | Complete: expert rubric plus Kyle review selected Windborne as Meadow exploration and Pressed Botanical as Cabinet review. Matched refinement frames establish the shared system; comprehension testing remains an implementation gate. |
| Data and provenance architecture | [Data contract](architecture/DATA_AND_PROVENANCE.md), [ADR-003](architecture/ADR-003_DATA_AND_TRUST_BOUNDARY.md), provenance probe | Complete logical decision and executable boundary probe. Physical Postgres/RLS migration is an implementation item. |
| Asynchronous processing architecture | [Async architecture](architecture/ASYNC_PROCESSING.md), [ADR-002](architecture/ADR-002_ASYNC_CONTROL_PLANE.md), ledger probe | Complete control-plane decision: trigger, snapshot, queue, ledger, provider, idempotency, retry, cancellation, stale, and cost behavior are explicit. Live provider and concurrent Postgres tests remain bounded implementation spikes. |
| Privacy and security architecture | [Threat model](architecture/PRIVACY_SECURITY_THREAT_MODEL.md) | Complete control design with data classes, 18 threats, Supabase-specific controls, auth, encryption, retention, incident order, and release gate. Verification receipts remain required before real notes. |
| Infrastructure and capacity | [Architecture baseline](architecture/ARCHITECTURE_BASELINE.md), [ADR-001](architecture/ADR-001_ALPHA_SYSTEM.md) | Complete native-iOS-first stack, web-companion boundary, shared-contract seam, environments, capacity limits, fallback rules, and authority boundaries. Native storage/background sync, web offline, rendering, and backup measurements remain explicit gates. |
| Cost architecture | [Cost model](architecture/COST_AND_CAPACITY.md), executable cost probe | Complete planning model with expected/stress/runaway cases, whole-system ranges, reservations, no-run gates, soft/hard caps, and rate-refresh rule. |
| Evaluation architecture | [Evaluation architecture](architecture/EVALUATION_ARCHITECTURE.md), [ADR-004](architecture/ADR-004_MODEL_AND_EVALUATION.md) | Complete corpus plan, baselines, deterministic gates, human rubric, numerical release thresholds, production metrics, and rollback. Corpus construction and blinded study remain implementation/research work. |
| Prioritized implementation backlog | [Alpha backlog](operations/ALPHA_IMPLEMENTATION_BACKLOG.md) | Complete dependency-ordered P0/P1/P2 plan with 1-3-day packages, acceptance evidence, fallbacks, exclusions, and integrated release definition. |
| Preserve quiet capture | Product, journey, async, backlog | Preserved: note edits do not trigger AI; no chat-first UI; manual and scheduled work share the delayed path. |
| Preserve source versus derived | Trust, data, provenance probe | Preserved through immutable revision/snapshot lineage, separate artifact classes, and exact claim evidence validation. |
| Preserve Kyle-first private lab | Product, architecture, threat model | Preserved through closed single-owner alpha, no team features, synthetic preview, and real-data release gate. |
| Preserve prepare-never-execute | Trust, ADR-003, backlog | Preserved: no H1/H2 workflow can mutate external systems; promotion is a preview/receipt stub only. |

## Executed probe receipts

All four run with Node and passed on 2026-08-25:

- Job ledger: two passes, one persisted bloom set; duplicate events and late cancelled result suppressed.
- Provenance validator: one valid candidate accepted and five invalid classes rejected.
- Offline conflict: one mutation applied, one retry collapsed, one divergent version preserved for resolution.
- Cost model: expected $0.45/month, stress $4.83/month, runaway $111/month under the documented planning rates.

These are domain probes. They do not claim browser, database, deployment, provider, or device behavior.

## Selected visual gate resolution

Kyle rejected the forced either/or choice. Meadow preserves the open grass-field exploration experience; Cabinet uses the pressed botanical system for evidence-rich review. The same living flower becomes a pressed specimen, with shared identity, labels, provenance, and controls. Living Constellation remains a preserved rejected direction.

## Remaining evidence is implementation work

D1 now has matched mobile Meadow and Cabinet targets and an interactive prototype package. It still requires density, reduced-motion, keyboard, Dynamic Type/large-text, and comprehension testing. Native iOS offline/background sync, web companion offline, rendering, Postgres/RLS, live Batch, and attachment-backup spikes also remain open. Every one has a measurable acceptance threshold and fallback in the backlog. None requires an implementer to decide the product’s visual posture, authority boundary, data model, orchestration semantics, privacy promise, cost cap, or evaluation standard.

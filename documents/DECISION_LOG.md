# Decision log

## D-001: Kyle-first private lab

- Status: Accepted
- Date: 2026-08-24
- Decision: Design and validate the first experience for Kyle before generalizing to creators, teams, or employers.
- Rationale: Real private workflows provide higher-quality evidence and avoid premature onboarding, collaboration, and market complexity.
- Revisit when: The four-week dogfood passes or the Kyle-first loop fails to transfer in early concept tests.

## D-002: Spatial garden as the primary surface

- Status: Accepted
- Date: 2026-08-24
- Decision: Use a spatial garden for active thinking; chronology, search, and project views remain secondary lenses.
- Rationale: The product should help ideas relate and evolve rather than reproduce a journal feed with AI summaries.
- Revisit when: Spatial usability testing shows it harms capture speed, accessibility, or long-term retrieval.

## D-003: Meaning and connections as the first return

- Status: Accepted
- Date: 2026-08-24
- Decision: Prioritize recurring themes, tensions, changes, and surprising connections over crafted life stories or action plans.
- Rationale: This best expresses accumulation-dependent value and preserves the user’s role as meaning-maker.
- Revisit when: Comparative studies show another return format creates more durable value with equal or better agency.

## D-004: Prepare, never execute

- Status: Accepted
- Date: 2026-08-24
- Decision: Background AI may synthesize private material and prepare proposals. Consequential external or project actions require explicit approval.
- Rationale: The initial product must earn interpretive trust before receiving operational authority.
- Revisit when: A later Codex workbench has scoped permissions, verified receipts, rollback, and repeated user demand.

## D-005: Documentation-first isolated repository

- Status: Accepted
- Date: 2026-08-24
- Decision: Start in `/Users/kylematthies/Code/GitHub/slow-garden` and keep it independent from the existing Personal OS during concept validation.
- Rationale: The existing app has its own active state and constraints. Isolation makes product evidence easier to interpret and preserves unrelated work.
- Revisit when: The private alpha architecture is selected and integration costs can be compared with evidence.

## D-006: Web-first, iOS after loop validation

- Status: Provisional
- Date: 2026-08-24
- Decision: Validate the complete experience in a responsive web prototype and private web alpha before committing to a native iOS client.
- Rationale: The interaction and batch-return model is the highest-risk assumption; platform duplication should not precede its validation.
- Revisit when: Web capture or offline limitations prevent a valid Kyle-first test.

## D-007: Weekly default deep pass

- Status: Provisional
- Date: 2026-08-24
- Decision: Use a weekly default for deep Connect passes, with manual processing for selected gardens and independent processing-depth controls.
- Rationale: Weekly accumulation creates a meaningful delay while keeping early evaluation manageable.
- Revisit when: Diary evidence identifies a better cadence by use case.

## D-008: Slow Garden is an incubation layer, not an authority system

- Status: Accepted
- Date: 2026-08-25
- Decision: Slow Garden specializes in unfinished thought and reviewable interpretation. Kyle Knowledge remains authoritative for accepted durable meaning, Agent Ops for operational state, and Personal OS for command-center access.
- Rationale: Duplicating those systems would dilute the quiet foreground and create conflicting sources of truth.
- Revisit when: A validated integration cannot preserve the authority and promotion boundaries.

## D-009: Source and derived artifacts never silently merge

- Status: Accepted
- Date: 2026-08-25
- Decision: Store user source revisions separately from observations, inferences, external research, corrections, and accepted derived artifacts. Every bloom cites exact source revisions.
- Rationale: Interpretive agency, correction, reruns, and trustworthy exports require immutable lineage.
- Revisit when: Never for silent replacement; storage mechanics may change while the semantic boundary remains.

## D-010: Promotion creates a receipt and requires acceptance

- Status: Accepted
- Date: 2026-08-25
- Decision: A bloom may project into Kyle Knowledge only after explicit acceptance and destination preview. Promotion creates a new user-owned artifact and receipt; it does not convert the system bloom or alter sources.
- Rationale: The vault accepts curated meaning, not unattended model output.
- Revisit when: The vault contract changes or another destination establishes an equally explicit authority contract.

## D-011: Maximum three blooms and zero is valid

- Status: Provisional
- Date: 2026-08-25
- Decision: A garden pass returns zero to three blooms. It ranks for supported usefulness and withholds obvious, unsupported, or overreaching output.
- Rationale: Scarcity makes the return reviewable and gives no-output behavior product legitimacy.
- Revisit when: Density testing at one, three, and five-plus blooms produces better evidence.

## D-012: Managed hybrid alpha architecture

- Status: Accepted
- Date: 2026-08-25
- Decision: Use a private React/Vite PWA with an encrypted IndexedDB mutation outbox and managed Supabase Postgres as the authoritative store in a TypeScript monorepo.
- Rationale: Offline capture and transactional provenance are required; a full local-first sync engine is not required to validate the loop.
- Evidence: [ADR-001](architecture/ADR-001_ALPHA_SYSTEM.md).
- Revisit when: Safari offline or managed-operator privacy fails its documented gate.

## D-013: Product-owned asynchronous control plane

- Status: Accepted
- Date: 2026-08-25
- Decision: Separate the user-visible pass from Cron, queue delivery, job ledger, and provider batch state. Use IDs-only queue events and application idempotency.
- Rationale: Provider and queue completion semantics cannot protect quiet capture, provenance, cancellation, or duplicate prevention alone.
- Evidence: [ADR-002](architecture/ADR-002_ASYNC_CONTROL_PLANE.md) and passed job-ledger spike.
- Revisit when: Reconciliation cannot meet the documented SLO without excessive compensating logic.

## D-014: Pinned model and evidence-first release gate

- Status: Accepted
- Date: 2026-08-25
- Decision: Select a pinned model snapshot through the comparative evaluation corpus; require strict outputs, exact evidence validation, no tools in Tend/Connect, and hard database cost caps.
- Rationale: “Latest” and fluent prose are not measures of accumulation-dependent, trustworthy value.
- Evidence: [ADR-004](architecture/ADR-004_MODEL_AND_EVALUATION.md) and passed cost-model spike.
- Revisit when: A provider or workflow fails quality, privacy, cancellation, or cost thresholds.

## D-015: Meadow and Cabinet are two views of one garden

- Status: Accepted
- Date: 2026-08-25
- Decision: Use Windborne Meadow as the spacious exploration and capture view, and Pressed Botanical as an evidence-rich Cabinet review view. They share the same garden, bloom identity, provenance, controls, and visual tokens; switching views changes disclosure, not data or authority.
- Rationale: Kyle identified a real task distinction rather than a style compromise: Meadow supports flowing connection-making, while Cabinet supports deliberate inspection of clippings and evidence. Keeping both preserves the Flower-inspired experience without forcing provenance into the capture surface.
- Evidence: [Meadow and Cabinet visual system](design/MEADOW_AND_CABINET.md) and matched refinement frames.
- Revisit when: Mode-switch comprehension, density, mobile, or accessibility testing shows the two views fragment the experience or duplicate work.

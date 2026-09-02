# Multi-horizon planning roadmap

Status: H1 native local vertical slice implemented; full-Xcode and product validation gates open
Planning model: Evidence-gated horizons, not date commitments
Primary rule: Do not advance a horizon because code exists; advance when its exit evidence exists.

## 2026-08-26 implementation receipt

- Implemented the production-shaped native iPhone project, shared Swift domain, conditional SwiftData adapter, local outbox, immutable revisions and pass snapshots, five-minute foreground-reconciled fixture tending, Meadow/Cabinet views, multi-garden lifecycle, exact evidence, and append-only bloom responses.
- Added a portable behavior runner, Xcode UI journey test, approved visual assets, and versioned contract fixture.
- Portable Swift build, domain behavior checks, JSON syntax, project-file syntax, and existing web prototype verification can run now.
- Full Xcode is not installed. Simulator/device build, SwiftData macro generation, protected-file inspection, force-quit relaunch, VoiceOver, Dynamic Type, reduced-motion, screenshot comparison, and XCUITest evidence remain open; H1 does not advance on source code alone.

## Horizon map

| Horizon | Product state | Main question | Feature class |
|---|---|---|---|
| H0: Frame | Concept and research program | Is delayed, visual synthesis meaningfully better than journaling plus a weekly summary? | No production features |
| H1: Prove | Instrumented experience prototype | Can the seed-to-bloom loop create value without interrupting or overpowering the person? | Core loop only |
| H2: Build | Native iOS personal beta + web companion foundation | Can the loop run safely and reliably across isolated private tenants? | Personal garden V1 |
| H3: Extend | Agent-connected and multi-surface product | Which adjacent workflows strengthen the core rather than turn it into an automation dashboard? | Web depth, Codex workbench, deeper research |
| H4: Generalize | Team or institutional product | Can collaboration serve organizations without weakening personal tenant boundaries? | Collaboration, innovation, platform APIs |

## Dependency chain

```text
Product thesis and research plan
        |
        v
Interaction model + trust contract
        |
        +--> Visual and motion directions
        |
        +--> Data and provenance model
        |
        v
Instrumented prototype + offline batch study
        |
        v
Architecture selection + threat model + evaluation harness
        |
        v
Native iOS alpha + web companion + four-week dogfood
        |
        +--> Deeper web curation
        +--> Codex workbench
        +--> External beta / team innovation
```

---

## H0: Frame the product and evidence program

### Phase 0.1: Project foundations

Goal: Create one durable source of truth and prevent premature implementation choices.

Tasks:

- [x] Create an isolated Code-rooted Git repository.
- [x] Record the product brief, initial decisions, risks, and research questions.
- [x] Define planning status language and document ownership.
- [ ] Choose the final working name and naming test criteria.
- [x] Define the privacy classification for source notes, derived blooms, research sources, telemetry, and exports.
- [x] Define how this project relates to Kyle Knowledge, Agent Ops, and the existing Personal OS without making any of them a V1 dependency.
- [x] Decide whether accepted product decisions should also project into the Kyle Knowledge vault and what constitutes a migration receipt.
- [ ] Define repository contribution, review, branch, commit, and release conventions before implementation begins.
- [ ] Decide license and repository visibility before any remote is created.

Outputs:

- Canonical planning index.
- Accepted initial decision set.
- Project-to-personal-system boundary map.
- Repository and privacy policy.

Exit gate:

- A new contributor can locate the current thesis, open decisions, risks, and next planning task in under five minutes.

### Phase 0.2: Problem and market research

Goal: Prove the problem is more specific than “AI journaling” or “background agents.”

Tasks:

- [x] Write a jobs-to-be-done statement for personal reflection, decision incubation, creative problem solving, and research gardening.
- [x] Inventory current behavior using existing tools: paper/GoodNotes, journal, Obsidian, ChatGPT/Codex, and project notes.
- [ ] Run a two-week diary study of moments when immediate AI would interrupt thought and delayed synthesis could help.
- [x] Catalog adjacent products across AI journals, visual canvases, knowledge gardens, agent workspaces, and innovation-management tools.
- [x] Compare each product on capture interruption, accumulation, spatiality, delayed processing, provenance, correction, agency, and return ritual.
- [x] Identify the smallest differentiated wedge that existing products do not already satisfy.
- [ ] Test concept language including temporal co-thinking, slow AI, thinking garden, and asynchronous prompting.
- [ ] Interview or observe 5 to 8 reflective knowledge workers only after Kyle-first workflows are documented.
- [x] Define disconfirming evidence that would stop or reposition the product.

Outputs:

- Current-workflow map.
- Competitive and substitute matrix.
- Ranked problem statements.
- Differentiation memo and stop conditions.

Exit gate:

- Evidence identifies one high-frequency or high-importance problem where accumulation and delay improve the outcome, not merely the atmosphere.

### Phase 0.3: Product principles and trust contract

Goal: Make human agency testable rather than aspirational.

Tasks:

- [x] Define what the system may observe, infer, research, remember, and propose.
- [x] Define what always requires approval: knowledge promotion, external messages, project changes, code, publication, and data sharing.
- [x] Specify how observation, inference, uncertainty, contradiction, and research appear in the UI.
- [x] Define the correction model: reject, edit interpretation, dispute source, mark coincidence, and prevent recurrence.
- [x] Define the no-output behavior for sparse, duplicate, contradictory, or unchanged input.
- [x] Define maximum bloom count and information density for each return.
- [x] Define retention, export, deletion, model-training, and account-recovery promises.
- [x] Define the boundary between reflective support and mental-health or clinical claims.
- [x] Write anti-goals for engagement streaks, manipulative notifications, false certainty, and gamified emotional scoring.

Outputs:

- Product-principles document.
- Human-agency and approval matrix.
- Data-use promise in plain language.
- Safety and non-clinical positioning note.

Exit gate:

- Every automated behavior has a visible source, bounded permission, correction path, and no-action fallback.

---

## H1: Prove the temporal experience

### Phase 1.1: Information and interaction architecture

Goal: Define the smallest complete seed-to-bloom loop before visual styling.

Tasks:

- [x] Map end-to-end journeys for first seed, ongoing capture, spatial arrangement, waiting, return, bloom review, correction, and archive.
- [x] Define entities and language: seed, bed, cluster, path, garden pass, bloom, response, and workflow proposal.
- [x] Specify seed creation, editing, revision history, deletion, restoration, and attachment behavior.
- [x] Specify spatial canvas behavior across mouse, touch, keyboard, and small screens.
- [x] Decide when chronology, search, filters, tags, and project context appear without overtaking the garden.
- [x] Define garden-pass states: queued, snapshotting, processing, partially complete, complete, failed, cancelled, superseded, and stale.
- [x] Define return timing and notification rules that avoid pressure or false urgency.
- [x] Specify bloom lifecycle: new, viewed, kept, corrected, pruned, promoted, and superseded.
- [x] Design provenance inspection from a bloom back to exact source revisions.
- [x] Design empty, loading, offline, failed, stale, contradictory, and reduced-motion states.
- [x] Define manual “let this grow” and automatic cadence controls separately from processing depth.

Outputs:

- Journey maps and state diagrams.
- Domain glossary.
- Screen and state inventory.
- Interaction contract for the prototype.

Exit gate:

- The full loop can be tested in a clickable prototype without a live model or backend.

### Phase 1.2: Visual, motion, and content design

Goal: Turn the Flower inspiration into an interaction language rather than decorative animation.

Tasks:

- [x] Produce exactly three distinct visual directions establishing a Garden grammar that can extend to Return Reveal and Bloom Detail.
- [ ] Establish how seeds, paths, clusters, and blooms differ visually without relying only on color.
- [ ] Define color semantics and prevent decorative colors from implying unsupported meaning.
- [ ] Define motion principles for gathering, wind, growth, reveal, correction, and pruning.
- [ ] Prototype reduced-motion equivalents for every meaningful animation.
- [ ] Define typography for quiet capture, reflective reading, source evidence, and system uncertainty.
- [ ] Design desktop, iPhone portrait, iPad, large text, keyboard-only, VoiceOver, dark mode, and low-power states.
- [ ] Write interface language that avoids therapy claims, certainty inflation, and AI personification.
- [ ] Test whether the garden remains legible with 5, 25, 100, and 1,000 seeds.
- [ ] Establish reusable design tokens only after a visual direction is selected.

Outputs:

- Selected visual direction with rejected alternatives preserved.
- Motion storyboard and reduced-motion mapping.
- Content and uncertainty language guide.
- Accessibility requirements and early design tokens.

Exit gate:

- Users can distinguish their material from system interpretation, understand why a bloom appeared, and complete the main loop without instruction.

### Phase 1.3: Wizard-of-Oz and batch-quality study

Goal: Validate the return before building the production intelligence system.

Tasks:

- [ ] Create a synthetic and privacy-safe seed corpus with sparse, repetitive, contradictory, evolving, and unrelated cases.
- [ ] Manually assemble garden-pass snapshots from real Kyle-first inputs under a documented private-data procedure.
- [ ] Generate candidate blooms offline using at least two prompt or workflow approaches.
- [ ] Compare immediate per-entry feedback against delayed cross-entry synthesis.
- [ ] Blind-review outputs for novelty, faithfulness, usefulness, emotional overreach, and source support.
- [ ] Test one-bloom, three-bloom, and report-style returns to find the overwhelm threshold.
- [ ] Measure keep, correct, prune, promote, and “obvious summary” rates.
- [ ] Test no-output behavior and adversarial cases such as prompt injection inside notes.
- [ ] Record which insights required elapsed time or accumulated evidence.
- [ ] Define the first evaluation rubric and release threshold for batch quality.

Outputs:

- Reusable evaluation corpus and rubric.
- Comparative study results.
- Validated return format or a documented pivot.
- Initial prompt/workflow candidates.

Exit gate:

- Delayed synthesis beats the immediate-feedback baseline on usefulness and preserves source faithfulness without increasing overreach.

---

## H2: Build and validate the native iOS personal beta

### Phase 2.1: Architecture selection and technical spikes

Goal: Choose infrastructure from measured requirements rather than habit.

Tasks:

- [x] Quantify expected seed volume, attachment size, garden count, snapshot size, batch duration, concurrency, and monthly cost envelope.
- [x] Decide native iOS-first client architecture, web-companion boundary, and rendering models with measured fallback gates.
- [x] Finalize `applications/`, `packages/`, `prototypes/`, and `supabase/` boundaries.
- [x] Compare managed Postgres/Supabase against local-first and hybrid storage options.
- [x] Decide authentication, authorization, encryption, key ownership, backup, deletion, and account recovery.
- [x] Define the source-revision, snapshot, bloom, provenance, response, evaluation, and job-ledger schemas.
- [x] Define API/event contracts and idempotency keys for garden passes.
- [x] Compare scheduled polling, database triggers, queues, durable workflows, and Codex scheduled tasks for orchestration.
- [x] Define model-provider abstraction, batch API use, structured output validation, retries, fallbacks, budgets, and cancellation.
- [x] Define prompt/version provenance and reproducible reruns.
- [x] Decide attachment storage, text extraction, image handling, and content limits, with backup activation gate.
- [ ] Prototype spatial rendering at 1,000 nodes on target iPhone and desktop hardware.
- [ ] Prototype offline capture, conflict resolution, and delayed sync.
- [x] Produce a threat model covering private data, prompt injection, cross-garden leakage, service credentials, logs, and exports.
- [x] Produce a cost model for inference, storage, egress, observability, and backups.

Outputs:

- Architecture decision records.
- System context and data-flow diagrams.
- Tested performance, offline, orchestration, and privacy spikes.
- Threat model, cost model, and rollback plan.

Exit gate:

- The chosen architecture meets documented privacy, offline, reliability, performance, and cost thresholds with spike evidence.

### Phase 2.2: Alpha delivery plan

Goal: Convert the architecture into small, independently verifiable work packages.

Tasks:

- [ ] Write separate implementation briefs for identity, garden data, canvas, batch orchestration, bloom review, provenance, settings, and observability.
- [ ] Define schema migration order and reversible rollback for each data change.
- [x] Define API contracts with versioning and compatibility rules.
- [x] Define shared domain types and ownership between client and service layers.
- [x] Define seed data, test fixtures, local development, preview, and production environments.
- [x] Define CI checks for types, lint, unit, integration, accessibility, security, migration, and end-to-end tests.
- [ ] Define deployment promotion and rollback gates.
- [ ] Define feature flags for processing modes, external research, notifications, and new model workflows.
- [x] Define operational dashboards, alerts, cost budgets, and incident ownership.
- [x] Break work into 1-to-3-day issues with explicit dependencies and acceptance criteria.

Outputs:

- Decision-complete alpha epic and child issues.
- Environment and release plan.
- Testing pyramid and fixtures plan.
- Operational readiness checklist.

Exit gate:

- An unfamiliar implementer can take any first-wave issue without making an unstated product or architecture decision.

### Phase 2.3: Native iOS alpha feature sequence

Feature group A, trusted source foundation:

- Revisioned seed CRUD and deletion recovery.
- Garden and bed organization.
- Authentication and tenant-isolated personal authorization.
- Encrypted transport, private storage, export, and deletion.
- Provenance-ready source identifiers.

Feature group B, quiet thinking surface:

- One-handed native Meadow garden with mobile-appropriate spatial exploration.
- Fast text capture and editing.
- Touch, dictation, share-sheet capture, encrypted offline queue, and sync-conflict handling.
- Chronology and bounded search as secondary lenses.
- No AI during capture.

Feature group C, asynchronous return:

- Snapshot creation and eligibility rules.
- Manual and weekly garden passes.
- Job status, retry, cancellation, stale-result detection, and budgets.
- Tend and Connect modes.
- Maximum-three-bloom reveal and review.

Feature group D, trust and learning:

- Exact source-revision links.
- Observation/inference/research labels.
- Keep, correct, prune, annotate, and promote responses.
- Prompt/workflow version recording.
- Evaluation sampling and privacy-minimized telemetry.

Feature group E, alpha readiness:

- Reduced motion, VoiceOver, large text, keyboard, and contrast validation.
- Backup and restore drill.
- Security review and dependency scan.
- Cost guardrails and no-run behavior at budget limits.
- Incident, rollback, and data-export verification.

Web companion foundation:

- Desktop Cabinet review, provenance inspection, search, and longer-form curation.
- Contract-parity tests against the native client and the same source/derived authority rules.
- Platform-specific offline behavior without shared UI-code constraints.

Exit gate:

- The alpha supports one complete private seed-to-bloom loop on native iPhone plus companion review on desktop web, including offline capture, failure recovery, provenance, correction, export, and deletion.

### Phase 2.4: Four-week Kyle-first dogfood

Goal: Decide whether the product earns continued investment.

Tasks:

- [ ] Select three live gardens: one decision, one creative/product problem, and one research inquiry.
- [ ] Establish a baseline using current tools and a conventional weekly summary.
- [ ] Run weekly Connect passes and opt-in Explore passes under fixed evaluation rules.
- [ ] Record capture friction, useful surprises, obvious summaries, corrections, false connections, missed connections, and overwhelm.
- [ ] Review no-output weeks, failed jobs, offline edits, and cross-device conflicts.
- [ ] Conduct weekly qualitative reviews without tuning the system to every individual output.
- [ ] Compare results against the baseline and predefined stop conditions.
- [ ] Decide continue, narrow, reposition, or stop.

Exit gate:

- Continue only if the loop repeatedly creates source-faithful meaning that Kyle would miss or spend material effort producing with current tools.

---

## H3: Extend a validated personal product

### Phase 3.1: Deeper web companion and native extensions

- [ ] Add desktop-scale comparison, chronology, project context, and multi-bloom curation without turning the companion into an admin dashboard.
- [ ] Add native widgets, shortcuts, richer share-sheet intake, dictation, photos, and carefully bounded notifications after the core loop validates.
- [ ] Preserve contract, provenance, and correction parity while allowing platform-specific interactions.
- [ ] Test VoiceOver, Dynamic Type, reduced motion, keyboard, low connectivity, and interrupted background work on each platform.
- [ ] Plan TestFlight privacy disclosures, web release controls, crash reporting, and rollback gates.

Gate: Extensions must materially improve capture or review without weakening the quiet foreground or creating a second authority system.

### Phase 3.2: Explore mode and deeper research

- [ ] Define source-quality, recency, citation, contradiction, and uncertainty requirements.
- [ ] Add research budgets, domain controls, source allow/block lists, and cancellation.
- [ ] Separate personal inference from externally supported claims.
- [ ] Add research packets that remain reviewable proposals.
- [ ] Evaluate multi-agent research only against a simpler single-workflow baseline.

Gate: External research must improve decisions without obscuring what came from Kyle versus the web.

### Phase 3.3: Codex workbench

- [ ] Map Codex project identity to gardens without replacing Agent Ops as the operational ledger.
- [ ] Define read-only imports for project status, recent tasks, decisions, and delivery evidence.
- [ ] Let Kyle attach notes to a project and classify them as reflection, correction, decision, or workflow request.
- [ ] Generate bounded workflow proposals for research, documentation, requirements, tests, or code changes.
- [ ] Require approval before task creation, external writes, branches, commits, PRs, messages, or publication.
- [ ] Show source note, proposed scope, affected systems, permissions, cost, and expected receipt before approval.
- [ ] Define how accepted proposals become Codex tasks and how verified receipts return to the garden.
- [ ] Prevent thread state or agent confidence from masquerading as delivery proof.

Gate: The workbench reduces coordination overhead without turning the garden into a noisy task dashboard or duplicating Agent Ops.

### Phase 3.4: Personal knowledge integration

- [ ] Define bounded projections into and retrieval from Kyle Knowledge.
- [ ] Preserve authority, freshness, provenance, contradiction, and privacy metadata.
- [ ] Promote only explicitly accepted blooms into durable knowledge.
- [ ] Avoid bulk ingestion until bounded retrieval tests pass.
- [ ] Verify export portability and clean disconnection from every integration.

Gate: Integrations strengthen continuity without creating a second canonical knowledge system.

---

## H4: Generalize beyond Kyle

### Phase 4.1: External individual beta

- [ ] Choose a narrow audience based on Kyle-first evidence: reflective creators, founders, designers, researchers, or another observed segment.
- [ ] Design onboarding, sample gardens, privacy explanation, consent, and data import.
- [ ] Establish tenant isolation, support, abuse handling, account recovery, deletion, and billing foundations.
- [ ] Test whether product language and visual metaphors transfer beyond Kyle.
- [ ] Define activation around a meaningful first return, not account creation or seed count.
- [ ] Validate willingness to return and pay before broad feature expansion.

### Phase 4.2: Team innovation greenhouse

- [ ] Define ownership and visibility for submitted ideas, research, comments, and AI enrichment.
- [ ] Preserve the submitter’s original idea and distinguish team edits from machine additions.
- [ ] Add configurable enrichment workflows, review queues, comparison views, and export contracts.
- [ ] Define research source and confidentiality policies for employer data.
- [ ] Integrate with product-management tools only through scoped, reversible connectors.
- [ ] Require approval before writing enriched concepts back to an external system.

### Phase 4.3: Platform and ecosystem

- [ ] Define a permissioned garden-pass API and event model only after two product modes reuse it.
- [ ] Evaluate plugin or workflow templates without exposing raw private material by default.
- [ ] Support portable export formats for sources, layout, revisions, provenance, and derived artifacts.
- [ ] Evaluate local and user-selected models for privacy, cost, and offline use.
- [ ] Define enterprise controls, audit logs, retention, legal terms, and compliance only when a real buyer requires them.

Gate: Generalize only behaviors proven in at least two real contexts; do not build a speculative agent platform.

---

## Cross-cutting planning tracks

These tracks run through every horizon and must be represented in each phase gate.

### Product and research

- Problem evidence, target user, baseline, success measure, stop condition, and feedback loop.
- Feature classification as now, next, later, or rejected.
- Explicit non-goals and cannibalization risk when a new feature competes with quiet thinking.

### Design and accessibility

- Interaction states, visual hierarchy, content language, motion, reduced motion, responsive behavior, keyboard, screen reader, large text, and cognitive load.
- Prototype evidence before production implementation.

### Data, privacy, and security

- Classification, minimization, source/derived separation, authorization, encryption, retention, export, deletion, backup, restore, audit, incident response, and threat modeling.
- Private data never becomes public examples, analytics payloads, prompt logs, or model-training material without explicit permission.

### AI quality and safety

- Versioned workflows, structured outputs, provenance, uncertainty, contradiction, no-output behavior, prompt-injection resistance, evaluation corpus, regression gates, cost caps, and human correction.

### Architecture and infrastructure

- Capacity, performance, offline behavior, sync, queues, idempotency, retry, cancellation, observability, environments, CI/CD, rollback, provider portability, and disaster recovery.

### Delivery and operations

- Small implementation issues, dependency graph, acceptance criteria, test pyramid, release receipts, support process, cost review, and post-release monitoring.

## Roadmap maintenance

- Review the current horizon at least monthly during active development.
- Update a task only when there is an owner, evidence link, or explicit decision.
- Record reversals in the decision log; do not silently rewrite past rationale.
- Preserve rejected concepts and failed experiments with concise evidence so they are not repeatedly rediscovered.
- Move features across horizons only when the dependency and product-thesis impact are documented.
- Treat shipped code, a completed Codex task, and a deployed build as intermediate state; phase completion requires the stated exit gate.

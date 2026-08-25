# Trust and approval contract

Status: Proposed product contract for prototype testing
Date: 2026-08-25

## Plain-language promise

Your notes remain yours. Slow Garden keeps the words you wrote separate from what it inferred or researched. It may quietly prepare a small number of possible connections from a specific snapshot. It does not diagnose you, manufacture meaning when evidence is thin, or act in another system without a separate, explicit approval.

## Permission matrix

| Capability | Default permission | Visible evidence | User control |
|---|---|---|---|
| Observe source material in the selected garden | Allowed for an enabled pass | Exact garden, snapshot time, and source revisions | Exclude seed, pause garden, cancel before processing |
| Infer a pattern or relationship | Allowed in Connect and Explore | Source excerpts, reasoning label, confidence language, contradictions | Keep, correct, mark coincidence, prune, prevent recurrence |
| Use external research | Off except Explore | Linked sources, retrieval time, and separation from personal evidence | Enable per garden, exclude domains, remove research |
| Remember a correction | Allowed within that garden | Correction history and affected future rule | Edit or delete remembered correction |
| Promote a bloom to accepted knowledge | Approval required | Destination preview plus source lineage | Explicit accept and promote action |
| Prepare a workflow proposal | Approval required to leave the garden | Proposed steps, targets, permissions, and expected changes | Edit, approve for handoff, or discard |
| Send, publish, modify code/files, or change an external system | Never in V1 | Not applicable | Must occur in a separately authorized execution product |
| Share data with a new provider or person | Explicit approval required | Recipient, purpose, fields, retention, and terms | Approve once or cancel |

## Artifact classes

| Class | Owner | UI treatment | Mutation rule |
|---|---|---|---|
| Source | User | Solid form and first-person typography | Only explicit user edits create a new revision |
| Observation | System | Neutral “noticed” label | Must point to exact sources; may be corrected |
| Inference | System | Distinct “possible connection” label | Never presented as fact; retain uncertainty |
| Contradiction | System | Paired evidence and unresolved marker | Do not resolve on the user’s behalf |
| Research | External source plus system synthesis | Citation and retrieval date | Never blended invisibly into personal evidence |
| Accepted bloom | User-owned derived knowledge | Acceptance receipt and lineage | Promotion creates a new artifact; sources stay unchanged |
| Workflow proposal | System proposal | Preview with permission boundary | Cannot execute inside V1 |

Color may reinforce these classes but cannot be the only distinction. Labels, shapes, texture, and accessible descriptions must carry the same meaning.

## Correction model

Every bloom offers five responses:

- **Keep:** useful as written, without promoting it.
- **Refine:** edit the interpretation while preserving the system version and source lineage.
- **Coincidence:** sources are related in form but not meaning; reduce recurrence of that connection.
- **Wrong source:** dispute one or more supporting revisions without altering the source itself.
- **Prune:** remove the bloom from the active garden; optionally explain why.

“Prevent recurrence” must show the garden-scoped rule it will remember. A correction changes future derived behavior, never historical source text.

## Earned output and no-output rules

A pass returns zero to three blooms. A bloom is not earned when:

- evidence is sparse, duplicative, or unchanged since the last accepted snapshot;
- the connection is only a paraphrase or obvious summary;
- the system cannot cite the exact source revisions that support it;
- contradictory evidence makes the claim misleading without more context;
- confidence depends mainly on external assumptions about the person;
- the safest wording would become therapeutic, diagnostic, or falsely certain.

The no-output return says what was processed, why no bloom was offered, and when another pass could become useful. It does not encourage writing more to please the system.

## Return-density contract

- Maximum of three blooms per pass across all processing modes.
- Each bloom leads with one sentence and one visible evidence cue.
- Details, source excerpts, research, and correction controls unfold on demand.
- Rank by supported usefulness, not emotional intensity or likelihood of engagement.
- A pass may complete partially, but incomplete blooms are not revealed as conclusions.

## Data-use promises to validate before alpha

- Private by default and single-user in V1.
- Encryption in transit and at rest; credentials and content separated where practical.
- No model training on private content unless Kyle explicitly opts into a named provider program.
- Bounded provider retention and a documented zero-retention preference where available.
- Export includes sources, revisions, spatial layout, derived artifacts, corrections, and provenance in documented formats.
- Deletion covers originals, revisions, derived artifacts, attachments, indexes, and queued work, with backup expiry disclosed.
- Account recovery must not expose journal contents to support staff by default.
- Telemetry excludes note bodies and derived prose; content-level evaluation requires an explicit study procedure.

These are prototype promises, not claims about an implementation that does not yet exist. Architecture selection must prove them.

## Non-clinical boundary

Slow Garden supports reflection; it does not assess mental health, infer diagnoses, predict crises, prescribe treatment, or claim therapeutic outcomes. It should avoid mood scores, personality labels, trauma interpretations, and urgency language derived from journal content. A future safety policy may provide static crisis resources for explicit user requests, but no covert monitoring is authorized.

## Anti-goals

- No streaks, guilt, decay, or rewards tied to capture frequency.
- No manipulative or emotionally personalized notifications.
- No anthropomorphic claim that the garden “knows” or “understands” the person.
- No certainty inflation, hidden confidence scores, or unsupported causal stories.
- No invisible rearrangement of source material.
- No autonomous promotion into Kyle Knowledge, Agent Ops, or project repositories.


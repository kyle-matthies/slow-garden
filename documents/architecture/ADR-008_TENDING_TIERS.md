# ADR-008: Tending tiers and nightly tending

- Status: Accepted for implementation by Kyle on 2026-10-09. Activation remains gated by the [AI activation runbook](../operations/AI_ACTIVATION_RUNBOOK.md).
- Date: 2026-10-09
- Owner: Kyle
- Roadmap phase: 2.3 feature group C (Tend and Connect), delivered on web per ADR-006

## Context

AI knowledge tending is central to Slow Garden. The intended experience is:

- The person writes and leaves.
- Overnight, the garden is gently tended.
- At first, tending is light cataloguing.
- As material accumulates, tending notices recurring themes and changes.
- Eventually, tending brings an older or half-finished thought beside current writing, with a small grounded question.
- The return is never a long write-up.

Today one manual Connect-style workflow exists (`connect-v2-unapproved`):

- It runs as OpenAI Batch over Responses.
- No model is pinned and the runtime is disabled.
- It returns 0–3 quote-checked blooms from a frozen snapshot.

There is no catalogue, theme, retrieval, resurfacing, or schedule. `PROJECT_BRIEF.md`
names Tend ("organize, label, deduplicate, and identify unfinished material without
adding interpretive claims") and Connect, but Tend has no schema, prompt, or
evaluation.

## Options considered

| Option | User impact | Engineering impact | Privacy/security | Reversibility |
|---|---|---|---|---|
| Tiered tending, unlocked by accumulated evidence, in one frozen snapshot per pass with two staged requests | Starts light, deepens as material grows, stays bounded | Extends existing ledger, worker and validators | Same tenant and plot scopes; no new provider | High: tiers are workflow versions |
| One larger Connect prompt over everything | Long, unfocused returns | Simple | Larger snapshots | Medium |
| Embedding retrieval first (pgvector) | Better recall across months | New provider data flow and index lifecycle | New derived store to delete/export | Medium |

## Decision

### Tiers

Tiers unlock from evidence already in scope, never from usage frequency or calendar
time alone. `private.prepare_pass` evaluates the unlocks deterministically and
records them in the snapshot.

| Tier | Output | Artifact class | Unlocks when |
|---|---|---|---|
| 1 Catalog | Per changed thought: ≤ 2 **theme** labels (1–3 words, ≤ 32 chars), any **open question** the person wrote and left (exact quote), an **unfinished** marker (exact trailing excerpt) | Observation, shown as "Tended" | Any new or changed writing in an AI-on topic |
| 2 Notice | Recurring **pattern** across thoughts or time; **connection**, **tension**, **change** blooms | Observation ("Noticed") and Inference ("Possible connection") | ≥ 6 entries across ≥ 3 distinct ISO weeks in scope |
| 3 Resurface | **Echo**: an older thought placed beside current writing, citing both; at most one grounded **question** | Inference | Some in-scope material is ≥ 28 days older than the newest changed entry |

### Contract rules

- **Cap:** at most three blooms per garden per tending cycle, across all kinds.
  Catalogue marks are not blooms. They are limited to two theme labels plus at most
  one open-question and one unfinished mark per changed thought. They are never
  presented as a reveal event.
- **Brevity:**
  - A `tend-connect-v3` bloom interpretation is one sentence of ≤ 280 characters.
  - Questions are ≤ 160 characters.
  - Labels are ≤ 32 characters.
- **Evidence:** every mark and bloom cites exact excerpts of revision IDs in the
  frozen snapshot, validated in JS and again in SQL. Recurrence counts ("4 days since
  May") are computed from stored marks in SQL, never claimed by the model.
- **Derived material** (labels, counts) may steer candidate selection but never counts
  as evidence.
- **Labels:** never describe mood, health, diagnosis, personality, or worth. A label
  denylist joins the existing overreach check.
- **Corrections:**
  - Pruned marks and blooms, and corrections, are passed as corrections to later
    passes in the same scope so they do not recur.
  - Pruning never changes source text.
- **No guilt:** time since writing is a retrieval input only. The interface never
  reports how long someone has been away and never nudges them to write.

### Snapshot and retrieval

A pass remains one frozen snapshot under one workflow version. `prepare_pass` freezes
three parts:

- **changed:** current revisions created since the scope's last completed pass. When
  nothing changed, a nightly pass is skipped at no cost.
- **candidates:** up to 12 older current revisions in scope, ranked by Postgres
  full-text similarity (`to_tsvector('simple', body)`, GIN expression index) to the
  changed text, plus overlap with kept theme labels.
- **index:** thought titles and kept labels in scope, for orientation only.

The existing 100 KB snapshot cap stays. Embeddings are deferred to a later ADR, once
lexical recall is measured on the evaluation corpus.

### Workflow `tend-connect-v3`

- One Batch file per pass with two request lines, `custom_id` `<pass>:tend` and
  `<pass>:connect`.
- Each line has its own system prompt, strict JSON schema, and validator.
- When one stage fails validation, the other may still land, and the pass records a
  partial result.
- The connect stage only runs the kinds its unlocked tiers allow.

### Scheduling

- **Consent:** nightly tending is opt-in per account (`accounts.tend_overnight`,
  default false). Per-topic `ai_enabled` and `cross_pollinate` remain the consent
  boundary for what may be read.
- **Enqueue:** `private.enqueue_nightly_passes()` runs hourly via `pg_cron`. It
  enqueues for tenants whose local time (`accounts.timezone`) is in the 02:00 hour.
- **Scopes:** it creates one pass per permission scope:
  - each AI-on, cross-off topic alone;
  - one pass for a garden's cross-pollinating group.
- **Concurrency:** the current "one active pass per tenant" rule becomes one per
  scope, with a per-tenant nightly cap and the existing budget reservation.
- **Worker:** the worker is invoked every five minutes through `pg_cron` and `pg_net`,
  with its secret in Vault.
- **Delivery:** results appear quietly when ready. There is no notification and no
  guaranteed overnight delivery (ADR-006). Manual "Tend now" remains.

### Storage

New tables:

- **`public.tending_marks`:** kind `theme | open_question | unfinished`, label,
  evidence, seed, pass.
- **`public.tending_mark_responses`:** keep or prune, append-only.

Both mirror bloom RLS: readable only through a completed pass, and users insert only
responses.

Changes to existing tables:

- **`blooms.kind`** gains `pattern` and `echo`.
- **`garden_passes`** gains `trigger` (`manual | nightly`) and `scope_key`.
- **`public.garden_themes`** (new view) aggregates kept theme marks.
- **Export** places marks under `derived` with `authorship: "ai-derived"`.

## Evidence and rationale

- `TRUST_AND_APPROVAL_CONTRACT.md` already defines Observation and Inference classes,
  earned-output rules, and correction semantics. Tiers map onto those classes rather
  than inventing new authority.
- `DATA_AND_PROVENANCE.md` requires snapshot-only inputs and exact evidence. The staged
  design keeps both.
- The evaluation corpus has one long-gap case (`connection-across-months`). Resurfacing
  needs its own families before any model is chosen.

## Consequences

- **Easier:** a person sees useful structure (labels, open questions) early without
  waiting for rare insight. Deeper returns arrive only when material can support them.
- **Harder:** more output surface to evaluate and correct. Two schemas and two prompts
  must be versioned together.
- **Newly required:**
  - Evaluation families for catalogue, recurrence, resurfacing, question grounding, and
    brevity.
  - Thresholds in `EVALUATION_ARCHITECTURE.md`.
  - A synthetic-only model-run harness.
- **Unchanged:**
  - Provider adapter (OpenAI Batch over Responses).
  - No tools, no research, no external actions.
  - Model pinned only by evaluation (D-014).
  - Activation only through the runbook.

## Verification and rollback

- **Acceptance (repository):**
  - Runtime tests cover both stages, partial completion, skip-when-unchanged, and scope
    fan-out.
  - pgTAP tests cover RLS isolation, cross-off isolation, caps, and invalidation.
  - The evaluation packet passes its deterministic checks.
- **Acceptance (activation):** the runbook phases in order, each an explicit owner
  go/no-go:
  - 0.4 evaluation receipt and model pin;
  - 1.x provider terms and secrets;
  - hosted migration apply;
  - 2.x worker deploy;
  - 3.x synthetic canaries;
  - 4 owner-only enable.
- **Rollback:**
  - `accounts.tend_overnight=false` and `private.ai_runtime.enabled=false` stop new
    work.
  - Workflow versions are independent, so `connect-v2` remains available.
  - Migrations are additive.

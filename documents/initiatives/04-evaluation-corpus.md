# Feature brief: Distinct 48-case corpus and deterministic evaluator report

- Horizon and phase: H1 web dogfood, model-activation gate (closed)
- Status: Implemented, awaiting acceptance evidence (human review of model output)
- Owner: Initiative 4 of the September 2026 wave

## User problem

The evaluation packet that gates AI activation reused nine scenario templates 48 times
and had no fixtures for revision supersession, cross-plot exclusion, or correction
history. A model that passed it would have been tested on six near-identical inputs per
family, and the mechanical checks (exact excerpts, no tool fields) could not be shown to
be stable from one run to the next. Kyle, as the only reviewer, would be scoring
repetition rather than coverage.

## Why delay or accumulation matters

The garden pass runs later over frozen sources. The corpus must therefore exercise what
only accumulation exposes: entries revised after a previous pass, preferences that were
ruled out weeks later, corrections the person gave to earlier returns, and material in
other plots that must stay out of scope. A synchronous editor test would not need these.

## Proposed capability

Forty-eight hand-written synthetic cases across the required families, each carrying a
frozen snapshot plus never-citable fixtures (superseded revisions, other-plot sources),
prior corrections in time order, an expected-output frame, a reference return that must
validate, and rejected returns that must be refused. `prepare.mjs` emits a
machine-readable `report.json` alongside the manifest, cases, and blinded review sheet.
A `node --test` gate verifies family coverage, evidence validity, fixture integrity,
and byte-level determinism.

## Trust and agency

The packet reads only the checked-in synthetic corpus and the runtime prompt/schema. It
never calls a provider, never reads private data, and creates files only under the
ignored `artifacts/generated/`. Corrections in the corpus are modelled as user feedback
about a disputed interpretation, not as new facts; superseded and cross-plot revisions
are present precisely so a return that cites them is refused. Nothing here changes
`GARDEN_AI_ENABLED` or any hosted configuration.

## States and failure modes

- Empty or corrupted corpus: report status `packet-invalid`, per-case `problems`
  listed, `prepare.mjs` exits non-zero.
- Reference return quoting outside a source, citing a superseded or excluded revision,
  exceeding three blooms, or using diagnostic wording: caught by `validateReturn` and
  reported per case.
- Duplicate case IDs or reused bodies across cases: reported.
- Non-deterministic artifact (clock, ordering): the two-run byte comparison fails.
- Output folder outside `artifacts/generated/`: refused.

## Acceptance evidence

- `node --test tests/evaluation/corpus.test.mjs` passes (11 tests).
- Two independent `prepare.mjs` runs produce byte-identical `manifest.json`,
  `report.json`, `cases.jsonl`, and `review.csv`.
- `services/garden-worker/evaluation/README.md` lists every release threshold, which are
  deterministic, and that the rest require blinded human review.
- Not satisfiable by this initiative: model output scored against thresholds; Wizard-of-Oz
  acceptance of the three-bloom format.

## Dependencies and non-goals

Depends on `supabase/functions/_shared/garden-runtime.mjs` (`validateReturn`,
`systemPrompt`, `outputSchema`) and `documents/architecture/EVALUATION_ARCHITECTURE.md`.
Non-goals: generating model output, scoring quality, activating AI, changing the runtime
validator, or adding real journal content in any form.

## Implementation receipt

Built (owned files only):

- `services/garden-worker/evaluation/corpus.mjs`: 48 distinct cases (sparse 6,
  connection 6, evolving 6, tension 6, unrelated 6, correction 4, injection 8, stale 4,
  overreach 2). Fixtures: 7 superseded revisions across 6 cases (one entry revised twice,
  one same-day edit), 6 excluded other-plot sources across 6 cases (including an
  injection case attempting cross-plot exfiltration), 6 corrections across 5 cases (one
  two-round history with `correct` then `coincidence`), 21 rejected returns. Exports
  `requiredFamilies` and `requiredFixtures`.
- `services/garden-worker/evaluation/evaluate.mjs`: `evaluateCorpus()` returns a
  deterministic report (status, corpus/prompt/schema SHA-256, family and fixture
  coverage, expected-output distribution, per-case results and problems) and exports the
  `thresholds` table.
- `services/garden-worker/evaluation/prepare.mjs`: `buildPacket()` / `writePacket()`
  pure functions plus CLI; now writes `report.json` and embeds `corpus_sha256` and
  `thresholds` in the manifest; exits non-zero on `packet-invalid`.
- `tests/evaluation/corpus.test.mjs`: 11 `node --test` cases covering count, family
  coverage, fixture minimums, distinctness, exact-excerpt validity, refused rejected
  returns, correction ordering, in-process determinism, a corrupted-packet negative
  test, two-run byte stability, and a no-contact/no-URL sweep over all bodies.
- `services/garden-worker/evaluation/README.md`: families, case shape, gate checks, and
  the threshold table with a deterministic-vs-human-review column.

Verified locally on Node 22.23.2:

- `node --test tests/evaluation/corpus.test.mjs`: 11 pass, 0 fail.
- `node services/garden-worker/evaluation/prepare.mjs artifacts/generated/a` and `.../b`
  then `diff -r`: identical; status `packet-valid`, 48 cases, 0 problems.
- `node --test services/garden-worker/runtime.test.mjs`: 14 pass.
- `npm --prefix applications/web ci`, `run lint`, `npx tsc --noEmit`, `run build`: pass
  (no web files changed by this initiative).

Not verified:

- Any model output against the corpus; no provider was called.
- CI coverage lands through initiative 1's `npm run test:node`, whose glob includes
  `tests/**/*.test.mjs`; until that merges the suite runs only locally.
- Whether reviewers find the reference returns useful anchors; they are examples of
  validity, not model targets.

## Follow-ups

- `evaluateCorpus` now reports structurally malformed cases (missing arrays, blank ids,
  sources without bodies, corrections without revision lists, reference returns without
  blooms) as `packet-invalid` problems instead of throwing; covered by
  `tests/evaluation/corpus.test.mjs`.
- Proposed decision: the worker snapshot contract does not yet pass superseded-revision
  or excluded-plot identifiers to `validateReturn`; the corpus models them as absent from
  the snapshot. If the runtime later exposes revision history to the model, the validator
  should refuse superseded IDs explicitly rather than by absence.
- Proposed decision: `expected_output: "either"` cases (7) need a written reviewer rule
  for how they count toward no-output precision/recall.
- Roadmap note: the packet remains a starter corpus for private alpha; growth beyond 48
  cases should keep `requiredFamilies` as the single source of the family contract.
- No migrations or hosted changes proposed.

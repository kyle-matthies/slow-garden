# Feature brief: First-run flow from sign-in to first saved entry

- Horizon and phase: September 2026 initiative wave · Initiative 10 · P2
- Status: Implemented, pending merge; complete only on the evidence below
- Owner: Kyle (wave owner); delivered by an independent agent

## User problem

A new account signs in through a code flow the sign-in page barely explains, then
lands on a single "name a garden" form. After naming the garden the person must
discover on their own that a garden holds topics, a topic holds thoughts, and a
thought holds dated entries. Nothing they wrote exists until they find all three.
The first return to the garden is unlikely if the first visit ends in an empty page.

## Why delay or accumulation matters

Slow Garden earns its value from writing that accumulates and is returned to later.
That only starts once a first real entry exists. The first run therefore optimizes
for one thing: reaching a saved, dated, private entry in a few quiet steps, without
tours, tooltips, or sample content that would put words in the garden the person
did not write.

## Proposed capability

- Sign-in page: plain-language explanation of the six-digit code flow, a
  confirmation of which address the code went to, and a "Resend code" control with
  a 30-second cooldown. Only the newest code works; the copy says so.
- First run: when an account has no gardens, the garden page renders a single
  four-step flow — garden → topic → thought → write — one step visible at a time,
  with the hierarchy explained once in a sentence that stays visible on every step.
- Starter topics ("Reading", "Work", "Questions") are offered as unchecked
  checkboxes on the topic step and are created only when explicitly checked.
- The write step saves a first entry with the existing `saveEntry` action and lands
  the person on that thought with the entry anchored. "Write later" leaves the flow
  at the new thought without saving; it asks for confirmation if text was typed.
- Existing empty states already explain the hierarchy per level; the first run
  removes the need to discover them cold.

## Trust and agency

The flow reads nothing and infers nothing. It only writes what the person types,
through the existing `createArea` and `saveEntry` server actions (RLS-scoped to
the signed-in tenant). Each create uses a client-generated idempotency id that is
reset when the input changes, so a retried submit never duplicates a garden, topic,
thought, or entry. Starter topics are never created implicitly. No AI is involved;
`GARDEN_AI_ENABLED` is untouched and the flow shows the one-line note "Private by
default. AI stays outside your writing."

## States and failure modes

- Empty: account with zero gardens → first run. Account with gardens → unchanged
  workspace.
- Loading/pending: inputs and buttons disabled, button reads "Saving…".
- Failed action: the action's message (or "Could not save. Please retry.") is shown
  in a `role="status"` element; the typed text is kept; retry replays the same id.
- Partial: if a starter topic fails after the named topic succeeded, the error is
  shown and the retry re-submits; the named topic replay is a no-op by id.
- Mid-flow data refresh: `createArea` revalidates `/garden`, so the workspace's
  `data` can gain a garden mid-flow. The workspace keeps the flow mounted via a
  `firstRun` state initialized from `gardens.length === 0` and cleared on `onDone`.
- Unsaved writing: a `beforeunload` guard is active while the textarea is non-empty;
  "Write later" confirms before discarding. The first-run textarea does not persist
  a draft to storage (see Follow-ups).
- Sign-in: resend disabled while pending and for 30 s after any send; the status
  message uses `aria-live="polite"`; a send error shows the provider message.
- Unauthorized/expired session: actions throw "Please sign in again…" which the
  flow surfaces as a retryable error; writing stays in the textarea.

## Acceptance evidence

- Interactions from a fresh account to a saved entry (each "type + submit" counted
  as one interaction): (1) name garden → Continue, (2) name topic → Continue,
  (3) name thought → Continue, (4) write → Save entry. Four interactions; five with
  an optional starter-topic checkbox. Meets "five or fewer".
- Lint, type-check, and production build pass (see receipt).
- Accessibility: every input has a `<label for>`; step changes are announced via
  `aria-live`; errors use `role="status"`; starters are a `<fieldset>` with a
  `<legend>`; focus moves to the new step's input.
- Privacy: no analytics, no sample content, no AI call, no new environment variables.

## Dependencies and non-goals

Depends on the existing `createArea`/`saveEntry` actions and the Supabase OTP email
sign-in. Non-goals: tours, tooltips, sample AI content, analytics, changing the
schema or hosted configuration, durable draft storage (Initiative 2 owns drafts).

## Implementation receipt

Built:

- `applications/web/src/app/garden/first-run.tsx` — `FirstRun` client component,
  four steps, idempotent ids, optional starters, write/“Write later”, `onDone`
  callback with `{ gardenId, topicId, thoughtId, entryId? }`.
- `applications/web/src/app/garden/first-run.css` — styles scoped to `.first-run`,
  imported by the component; `globals.css` untouched.
- `applications/web/src/app/garden/workspace.tsx` — minimal hook: import, a
  `firstRun` state, and the former `.first-garden` branch replaced by
  `<FirstRun … onDone={…router.push(/garden?garden&topic&thought#entry-…)…} />`.
- `applications/web/src/app/login/login-form.tsx` — clearer code-flow copy,
  "code sent to <email>" line, "Resend code" with 30 s cooldown.

Verified (Node 22, `applications/web`):

- `npm ci` — ok
- `npm run lint` — pass
- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `node --test services/garden-worker/runtime.test.mjs` — 14/14 pass

Not verified:

- No live sign-in or database run: the environment has no Supabase project and the
  wave forbids creating one, so the interaction count above is derived from the
  component's step structure, not from a recorded session against a real account.
- No automated component tests (Initiative 1 owns the test harness); none added.
- Screen-reader and 390 px layout of the new flow were not exercised in a browser.

## Follow-ups

- Once Initiative 1's Vitest harness lands, add component tests for `FirstRun`:
  step progression, idempotent id reset on input change, starters created only when
  checked, "Write later" confirm.
- Once Initiative 2's draft store lands, persist the first-run textarea through it
  so a tab close during the write step does not lose text.
- Proposed decision: whether the first run should also appear when an account has
  only archived gardens (today it appears only when there are zero gardens).
- Proposed decision: keep or change the starter topic names ("Reading", "Work",
  "Questions"); they are product copy, not schema.
- No migrations proposed.

# Initiative wave — September 2026

Status: Accepted for parallel implementation (D-021); each initiative closes only on its own evidence
Date: 2026-09-10
Owner: Kyle
Delivery model: ten scoped initiatives, each delivered as one reviewable pull request by an independent agent, with a per-initiative record under `documents/initiatives/`

## Why this wave

The web writing garden is deployed and the manual return runtime is scaffolded but gated.
The [web delivery record](WEB_DOGFOOD_DELIVERY.md) says the next product question is
whether the garden earns a voluntary return *without* AI, and whether AI later adds value.
This wave therefore invests in three things, in priority order:

1. **Trustworthy writing.** Nothing a person writes may be lost, and the writing surface
   must stay quiet on phone and desktop. Draft loss, missing tests, and accessibility gaps
   are dogfood blockers.
2. **A garden worth returning to.** Chronology, search, import of existing notes, and a
   first-run that gets someone to a real thought quickly make the no-AI garden desirable.
3. **Honest activation gates.** The evaluation corpus, worker release gates, return UI, and
   security review must exist before any provider is enabled; none of them enables it.

Review of the current app surfaced the concrete gaps behind each initiative: drafts live
only in tab `sessionStorage`; `workspace.tsx` is a 1,150-line client component with no
unit or component tests and only a manual Playwright harness; search is a substring filter
with no chronology lens; there is no import path for existing notes; exports omit derived
material; the return UI is a functional list rather than the designed Cabinet reveal; the
48-case corpus reuses scenario structures; the worker README lists unreceipted release
gates; `next.config.ts` sets no security headers; CI runs no dependency audit; the first-run
state is a single "name a garden" form.

## Priority model

- **P0:** protects existing writing or the ability to change the product safely.
- **P1:** makes the no-AI garden materially more useful, or is required before activation.
- **P2:** improves adoption once P0/P1 land.

## Initiatives

| # | Slug | Pri | Initiative | Owned files (others must not edit) |
|---|---|---|---|---|
| 1 | `test-foundation` | P0 | Web unit/component test harness in CI | `applications/web/vitest.config.*`, `applications/web/src/**/*.test.ts(x)`, `applications/web/package.json` test scripts, CI `web` job test step |
| 2 | `durable-writing` | P0 | Durable drafts and quiet keyboard-first writing | `applications/web/src/app/garden/entry-editor.tsx` (extracted), `src/lib/garden/drafts.ts` |
| 3 | `return-cabinet` | P1 | Cabinet-style return reveal and provenance inspection | `applications/web/src/app/garden/returns.tsx`, `returns-*.tsx`, dev-only fixture preview |
| 4 | `evaluation-corpus` | P1 | Distinct 48-case corpus and deterministic evaluator report | `services/garden-worker/evaluation/**`, `tests/evaluation/**` |
| 5 | `activation-readiness` | P1 | Worker release-gate receipts and synthetic canary dry run | `supabase/functions/_shared/garden-runtime.mjs`, `services/garden-worker/runtime.test.mjs`, `services/garden-worker/README.md`, `scripts/canary-dry-run.mjs`, `documents/operations/AI_ACTIVATION_RUNBOOK.md` |
| 6 | `import-portability` | P1 | Import existing notes; export v2 with separated derived material | `applications/web/src/app/garden/import/**`, `src/lib/garden/import.ts`, `src/lib/garden/export.ts`, `src/app/garden/export/route.ts` |
| 7 | `chronology-search` | P1 | Chronology lens and bounded search with excerpts | `applications/web/src/app/garden/chronology.tsx`, `src/lib/garden/search.ts` |
| 8 | `accessibility-mobile` | P1 | Accessibility, reduced motion, dark mode, 390px hardening | `applications/web/src/app/globals.css`, `layout.tsx`, `page.tsx`, `error.tsx`, `loading.tsx`, `login/page.tsx` |
| 9 | `security-hardening` | P1 | Security headers, dependency audit, RLS review receipts | `applications/web/next.config.ts`, CI audit step, `documents/operations/SECURITY_REVIEW_2026-09.md` |
| 10 | `first-run-onboarding` | P2 | First-run flow from sign-in to first saved entry | `applications/web/src/app/garden/first-run.tsx`, `login/login-form.tsx` |

`applications/web/src/app/garden/workspace.tsx` is shared. Initiatives may add imports and
minimal hook points there but must move new UI into their owned files. New styles go in a
CSS file imported by the owning component, never in `globals.css` (initiative 8 owns it).

### 1. Test foundation (P0)

Problem: the web application has lint, type-check, and build only. Every other initiative
changes behavior nobody can regress-test in CI.

Scope: add Vitest (jsdom + React Testing Library) to `applications/web`; extract pure logic
that is currently inline in route handlers or actions into `src/lib/garden/*` where needed
for testability; cover export formatting, action input validation, proxy cache headers,
and `EntryTime` rendering; run `npm test` in the CI `web` job.

Non-goals: Playwright against a live Supabase stack in CI; rewriting `workspace.tsx`.

Evidence: `npm test` passes locally and in CI; at least ten meaningful assertions across
three modules; README documents the test command.

### 2. Durable writing (P0)

Problem: drafts survive only in tab-local `sessionStorage`. Closing the tab, a browser
crash, or switching devices loses unsaved writing. K-015 is open.

Scope: extract `EntryEditor` to `entry-editor.tsx`; persist drafts per tenant/thought in
IndexedDB with `sessionStorage` fallback; recover drafts on return in any tab and show a
quiet "unsaved draft from <time>" notice with restore/discard; keep the existing
stale-edit rejection; save with Ctrl/Cmd+Enter; auto-grow the textarea; a "quiet page"
toggle that hides the rail while writing. No autocomplete, counters, or streaks.

Evidence: unit tests for the draft store; manual receipt of reload, tab close, and
browser restart on Chromium; lint/type/build pass.

### 3. Return Cabinet (P1)

Problem: `returns.tsx` is a functional list. The designed Cabinet reveal, exact clipping
inspection, and Keep/Correct/Prune ritual (D-015, R1–R3) are not yet legible.

Scope: rebuild the returns surface as a Cabinet panel: 0–3 blooms revealed with kind
labels, each clipping linking to its exact entry anchor, stale and withdrawn states,
prior responses shown inline, and "Continue this thought" pre-filling a new entry that
quotes the clipping with visible AI-derived attribution. Add a dev-only fixture preview
route (disabled in production builds) so states can be reviewed without any provider.

Non-goals: enabling AI, changing schema, notifications.

Evidence: all pass/bloom states render from fixtures; keyboard and screen-reader pass
on the panel; lint/type/build pass.

### 4. Evaluation corpus (P1)

Problem: the 48-case packet intentionally reuses scenario structures and lacks
supersession, multi-plot exclusion, and correction-history fixtures.

Scope: author 48 distinct synthetic cases across the required families; add fixtures for
revision supersession, cross-plot exclusion, correction history, and injection; make
`prepare.mjs` emit a machine-readable report and add a `node --test` gate that verifies
family coverage, evidence validity, and determinism.

Evidence: tests pass; report is stable across runs; README documents thresholds.

### 5. Activation readiness (P1)

Problem: the worker README names unreceipted gates: provider retry/idempotency, expired
provider jobs, account deletion with pending work, and hosted restore.

Scope: implement and test expired-job and duplicate-result handling in the runtime;
add a fake-provider canary dry run script that exercises submit, cancel, expire, budget
stop, and cleanup; write the activation runbook with explicit go/no-go checks. Any
required database change is documented as a proposed migration, not applied.

Evidence: runtime tests cover each gate; dry run completes with a content-free report.

### 6. Import and portability (P1)

Problem: people arrive with existing notes and cannot bring them in; exports omit blooms
and responses so a full account picture is not portable.

Scope: import Markdown/plain text files into a chosen topic with a preview (one file →
one thought, dated entries from headings or file date), idempotent by content hash,
using the existing `save_entry` path; extend exports with a clearly separated `derived`
section for blooms and responses and a per-garden export option.

Evidence: unit tests for parsing and idempotency; export verifier round-trips a fixture.

### 7. Chronology and search (P1)

Problem: search is a client-side substring filter; there is no dated view across a
garden. The brief calls for chronology and bounded search as secondary lenses.

Scope: a `view=timeline` lens listing entries by day across the garden or a topic;
search with excerpt highlighting across titles and bodies with an archived toggle; keep
the garden overview primary.

Evidence: unit tests for search ranking and excerpting; keyboard navigation receipt.

### 8. Accessibility and mobile (P1)

Problem: no automated accessibility check exists; dark mode and reduced-motion
equivalents are unverified; 390px layout was inspected once.

Scope: run axe on landing, login, and garden (component-rendered) states; fix findings;
add `prefers-color-scheme` dark tokens and `prefers-reduced-motion` equivalents; verify
200% zoom, focus order after navigation, and 390px layout; record receipts.

Evidence: zero serious/critical axe findings; screenshots at 390px and 1280px in light
and dark; contrast values recorded.

### 9. Security hardening (P1)

Problem: no CSP or security headers; no dependency audit in CI; threat-model receipts
T-01–T-13 are not tracked against the deployed web app.

Scope: add CSP (report-only first if needed), HSTS, frame, referrer, and permissions
headers in `next.config.ts`; add `npm audit --audit-level=high` to CI; review RLS tests
against the threat model and record receipts and gaps in a security review document.

Evidence: headers verified on a local production build; CI audit step green; review
document lists each threat with receipt or explicit gap.

### 10. First-run onboarding (P2)

Problem: a new account lands on a single "name a garden" form and must discover topics,
thoughts, and entries alone. The sign-in page does not explain the code flow.

Scope: a quiet three-step first run (garden → topic → thought → write) in one flow;
optional starter topics created only on explicit choice; clearer code sign-in with
resend; empty states that explain the hierarchy once.

Non-goals: tours, tooltips, sample AI content, analytics.

Evidence: synthetic account reaches a saved entry in under five interactions.

## Conventions for every initiative

- Read `AGENTS.md`. Do not create cloud resources, apply migrations, activate AI, or add
  chat/autocomplete. `GARDEN_AI_ENABLED` stays `false`.
- Write `documents/initiatives/<NN>-<slug>.md` using the feature brief template plus an
  implementation receipt and follow-ups. Do not edit `ROADMAP.md` or `DECISION_LOG.md`;
  the wave owner rolls up status.
- Verify with `npm --prefix applications/web run lint`, `npx tsc --noEmit`, `npm run build`,
  and `node --test services/garden-worker/runtime.test.mjs` before opening a PR.
- A merged PR is intermediate state. Mark an initiative complete only with its evidence.

## Explicitly not in this wave

Scheduled tending, provider activation, native iOS work, the botanical scrapbook visual
phase, Explore mode, team features, and any hosted configuration change.

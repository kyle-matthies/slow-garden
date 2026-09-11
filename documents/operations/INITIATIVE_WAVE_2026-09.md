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

## Roll-up — 2026-09-10

All ten initiatives opened pull requests the same day. Every agent reported lint,
`tsc --noEmit`, build, and worker runtime tests passing; none had a Supabase stack, so no
initiative has live-data, browser, or hosted evidence. Statuses stay **In progress** until
the receipts in each record's follow-ups exist.

| # | PR | Notes from the agent's receipt |
|---|---|---|
| 1 | [#14](https://github.com/kyle-matthies/slow-garden/pull/14) | Vitest harness, `npm test` in CI; pure logic extracted to `export-format.ts`, `validation.ts`, `cache-headers.ts`, `entry-time.tsx`. Initiative 6 must fold `export-format.ts` into `export.ts`. |
| 2 | [#13](https://github.com/kyle-matthies/slow-garden/pull/13) | IndexedDB draft store with recovery notice, Ctrl/⌘+Enter, auto-grow, quiet page. Editor not exercised live; K-015 closes only after a browser receipt. |
| 3 | [#15](https://github.com/kyle-matthies/slow-garden/pull/15) | Cabinet panel, exact clipping anchors, continuation with `[Clipping chosen by AI · <kind> …]` marker, `/garden/returns-preview` fixtures (soft 404 in production). |
| 4 | [#8](https://github.com/kyle-matthies/slow-garden/pull/8) | 48 distinct cases, supersession/exclusion/correction/injection fixtures, byte-stable `report.json`, `tests/evaluation/corpus.test.mjs` (not yet in CI). |
| 5 | [#10](https://github.com/kyle-matthies/slow-garden/pull/10) | Expired-job, duplicate-result, lease-loss handling; 25 runtime tests; `scripts/canary-dry-run.mjs`; `AI_ACTIVATION_RUNBOOK.md`. Proposes a `private.provider_orphans` migration for deletion with pending work. |
| 6 | [#9](https://github.com/kyle-matthies/slow-garden/pull/9) | `/garden/import` preview-then-confirm, content-hash idempotent ids via `save_entry`; export v2 with `source`/`derived` sections and `?garden=` filter. |
| 7 | [#12](https://github.com/kyle-matthies/slow-garden/pull/12) | `view=timeline` lens, tokenized ranked search with excerpts, archived excluded by default, 30-result cap. |
| 8 | [#16](https://github.com/kyle-matthies/slow-garden/pull/16) | Colour tokens with dark scheme, reduced motion, skip links, Playwright+axe harness with receipts under `documents/initiatives/receipts/08/`. One serious finding (`.plant-grid` aria) left for `workspace.tsx`. |
| 9 | [#11](https://github.com/kyle-matthies/slow-garden/pull/11) | Enforced CSP (still `'unsafe-inline'`), COOP/CORP, `npm audit` in CI, `SECURITY_REVIEW_2026-09.md` with T-01..T-13 receipts and follow-ups F-1..F-10. |
| 10 | [#7](https://github.com/kyle-matthies/slow-garden/pull/7) | `FirstRun` four-step flow replacing the first-garden branch; starter topics opt-in; login explains the code and adds resend. |

## Verification — 2026-09-11 (combined tree `9d5eae1`, wave still unmerged)

Two review rounds (Devin browser run, then Codex + maintainer) produced corrections on each
initiative branch. Nothing has merged; `main` is untouched. Evidence is grouped by kind so
that passing checks are not mistaken for closed gates.

### Corrections landed on the owning branches

| PR | Round 1 (Devin/Codex) | Round 2 (maintainer) |
|---|---|---|
| #13 | per-tab draft keys; editor locked while the pending write flushes; sign-out clears pending writes | atomic version-checked Restore transfer, compare-and-delete Discard, live-tab registry so opener/duplicated tabs get fresh ids, cross-tab sign-out tombstone + `BroadcastChannel` with post-clear writes blocked |
| #9 | entry ids keyed by date + occurrence; impossible calendar dates rejected; date-update failures surfaced; form remounts per garden | date stamping re-applied on every confirm so a retry repairs a failed update (`import-core.ts`, fake-db regression) |
| #15 | continuation queue appended to existing durable drafts; archived source links carry `view=archive` | Continue only for a writable owning thought/topic/garden; otherwise "Restore the thought to continue it" (`lib/garden/writable.ts`) |
| #14 / #11 | CI runs the `.mjs` suites via `npm run test:node` | Vitest 4.1.11 + lockfile; combined `npm audit --audit-level=high` clean |
| #8 | malformed arrays/fields reported as `packet-invalid` | null cases and null sources validated before property access |
| #10 | — | rollback cancels and drains active passes before disabling the global `private.ai_runtime` switch; switch documented as global, not per tenant |
| #7 / #16 | resend aligned to the 60 s throttle; dark card tokens | muted-ink token for first-run text (≥ 8.68:1 measured); `.plant-grid` is a labelled `<section>`, axe allowlist emptied |

### Static and unit verification (combined tree)

`npm ci` · `npm audit --audit-level=high` (0) · `npm run lint` · `tsc --noEmit` · Vitest 8/8 ·
`npm run test:node` 70/70 · worker runtime 25/25 · `scripts/canary-dry-run.mjs` 7/7 offline
scenarios · `next build`.

### Browser receipts (local Supabase + Mailpit, synthetic identities, `GARDEN_AI_ENABLED=false`)

Passed at `9d5eae1`: opener-tab isolation; Restore and Discard after the other tab edited
(newer record preserved); cross-tab and same-tab pending-write sign-out cleanup; reload and
close/reopen recovery; rapid save keeps submit-time text; stale-edit rejection; Cabinet
Continue gated on archived thought, still offered for an archived entry in an active thought,
appends after existing draft text; archived source link lands in the archive view; duplicate
dated import creates three entries and replays as three skips with source dates retained;
Feb 30 rejected; garden switch resets the topic; export v2 filters; timeline/search/archive;
resend enabled at ~60.3 s and accepted; FirstRun starter gating at 390 px light/dark; skip
links; axe harness 0 violations over 32 state/scheme/viewport cases; production `next start`
security headers and CSP with local-only `connect-src`, zero CSP/console errors;
`/garden/returns-preview` and `/dev/axe-fixtures` soft-404 in production.

### Local database verification

Supabase database tests and lint run in CI per branch; the combined tree was exercised against
the `.local-runtime` stack only. No migration in this wave has been applied anywhere.

### Remaining gaps (roadmap boxes stay unchecked)

- Physical phones/tablets: only emulated 390 px viewports were checked.
- Real-tenant continuation persistence: only synthetic tenants; hosted preview not exercised.
- `/dev/axe-fixtures` isolation with `GARDEN_AXE_FIXTURES` explicitly set was not tested.
- Full regression on the final tree was a delta run over the earlier full run at `64628c6`.
- Proposed migrations (`provider_orphans`, `source_date`/`p_created_at`, `entry_drafts`) remain
  proposals.

### Closed gates

AI activation and any external pilot remain closed (ADR-006). The activation runbook's global
enable switch means any future canary needs a synthetic-only environment or a maintained
exclusion of real tenants. Merge of the wave is held pending maintainer approval.

### Suggested merge order

Non-`workspace.tsx` PRs first, then the five that add hook points to `workspace.tsx`,
rebasing each after the previous merge: **#14 → #11 → #8 → #10 → #16**, then
**#13 → #15 → #12 → #9 → #7**. Expect small conflicts in `workspace.tsx` imports and in
`applications/web/README.md`, where several initiatives appended sections.

### Cross-initiative follow-ups for the wave owner

- CI: add `node --test tests/evaluation/corpus.test.mjs` and the axe harness (needs a
  Chromium install step) once #8 and #16 merge.
- `workspace.tsx`: fix `.plant-grid` aria (serious axe finding) and restore focus to a
  heading after `navigate()`; remove the harness allowlist entry afterwards.
- Hard 404 for `/garden/returns-preview` in production via `proxy.ts` (initiatives 3 and 9).
- Decision candidates for `DECISION_LOG.md`: continuation attribution marker as a stable
  format (3, 6, 4); system-only dark mode vs manual toggle (8); back-dating imported
  entries vs an explicit `source_date` column (6); nonce-based strict CSP (9 F-1);
  WebCrypto requirement for IndexedDB drafts (9 F-7 / 2).
- Proposed migrations, none applied: `private.provider_orphans` + deletion trigger (5);
  `source_date`/`imported_at` (6); `entry_drafts` for cross-device drafts (2).
- Live-stack receipts: run the `.local-runtime` journeys for import, first run, drafts,
  timeline/search, and Cabinet states before any of these close; then close K-015.
- Port the `node:test` files from initiatives 2 and 6 onto the Vitest runner from #14.

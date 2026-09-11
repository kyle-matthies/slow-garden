# Feature brief: Web unit/component test harness in CI

- Horizon and phase: September 2026 initiative wave, initiative 1 (P0)
- Status: Implemented; awaiting CI evidence on `main`
- Owner: Kyle

## User problem

The web application shipped with lint, type-check, and build only. Every behavior
change in the garden (validation limits, export formatting, cache policy, time
rendering) could regress without any automated signal. Nine concurrent initiatives
in this wave change that behavior, so the absence of tests is a dogfood blocker.

## Why delay or accumulation matters

Slow Garden's promise is that nothing a person writes is lost and that derived
material stays traceable. Both are properties that erode through small regressions
over time rather than single failures. A regression-test harness lets the product
accumulate safety with each change instead of relying on manual re-verification.

## Proposed capability

A `npm test` command in `applications/web` that runs Vitest with jsdom and React
Testing Library against colocated `src/**/*.test.ts(x)` files, executed by the CI
`web` job between lint and build.

## Trust and agency

The harness reads only synthetic fixtures committed to the repository. It does not
connect to Supabase, read journal content, or call any provider. No AI is activated;
`GARDEN_AI_ENABLED` remains unset in tests.

## States and failure modes

- Empty test set: Vitest exits non-zero when no test files match; the four committed
  files prevent this.
- Timezone/locale variance: the `EntryTime` test asserts structure (year, month
  abbreviation, `hh:mm`, non-ISO text) rather than an exact rendered string.
- Dependency drift: exact devDependency versions are pinned; `npm ci` fails loudly if
  the lockfile and manifest diverge.

## Acceptance evidence

- `npm test` passes locally and in the CI `web` job.
- At least ten meaningful assertions across at least three modules.
- `applications/web/README.md` documents the command.

## Dependencies and non-goals

Depends on ADR-006 (web-first implementation). Non-goals: Playwright against a live
Supabase stack in CI; rewriting `workspace.tsx`; testing async Server Components
(the Next.js Vitest guide recommends E2E for those).

## Implementation receipt

Built:

- `applications/web/vitest.config.mts`, `vitest.setup.ts` (jest-dom matchers),
  `npm test` (`vitest run`) and `npm run test:watch` scripts; exact-pinned
  devDependencies `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/jest-dom`.
- Pure logic extracted for testability, behavior unchanged:
  - `src/lib/garden/export-format.ts` — `formatSourceExport`, `exportHeaders`,
    `SourceExport` (from `app/garden/export/route.ts`).
  - `src/lib/garden/validation.ts` — `validateAreaName`, `validateEntryBody`,
    `validateBloomResponse`, `saveErrorMessage` (from `app/garden/actions.ts`).
  - `src/lib/garden/cache-headers.ts` — `PRIVATE_NO_STORE`,
    `applyPrivateCacheHeaders` (used by `lib/supabase/proxy.ts`,
    `app/garden/history/route.ts`, and the export headers).
  - `src/app/garden/entry-time.tsx` — `EntryTime` moved verbatim out of
    `workspace.tsx`, which now imports it.
- Tests: `export-format.test.ts`, `validation.test.ts`, `cache-headers.test.ts`,
  `entry-time.test.tsx` — 4 files, 8 tests, 45 assertions across four modules.
- CI: `npm test` step added to the `web` job in `.github/workflows/ci.yml`.
- README: `## Tests` section and `npm test` added to the promotion checklist.

Verified locally (Node 22.23.2):

- `rm -rf node_modules && npm ci` — succeeds with no flags.
- `npm test` — 4 files, 8 tests passed.
- `npm run lint` — clean.
- `npx tsc --noEmit` — no diagnostics.
- `npm run build` — compiled successfully, 6/6 static pages.
- `node --test services/garden-worker/runtime.test.mjs` — 14 passed.
- Lockfile diff against `main` contains no version changes or removals of
  previously locked packages; only additions and reordering.
- `npm audit --audit-level=high` — 0 vulnerabilities with `vitest` 4.1.11 (4.0.18 carried
  GHSA-5xrq-8626-4rwp and GHSA-82fw-gwwq-j7x9 via `@vitest/mocker`).
- Combined checkout with initiative 9 (`devin/1789018546-security-hardening`): `npm ci`,
  `npm audit --audit-level=high`, `npm test`, `npm run test:node`, lint, `tsc`, build,
  and the worker `runtime.test.mjs` all pass.

Not verified:

- The CI run of the `npm test` step on GitHub Actions passed on the pull request; the
  integrated run on `main` with all wave branches merged is pending.
- Rendering of `EntryTime` under non-English locales; the test asserts an English
  month abbreviation via the jsdom/Node default locale.

## Follow-ups

- `npm run test:node` (`node --test 'src/**/*.test.mjs' '../../tests/**/*.test.mjs'`) is
  wired into the web CI job alongside `npm test`, so the `node:test` suites that Vitest
  deliberately excludes (import/export, drafts, continuation, evaluation corpus) run in
  integrated CI. An empty glob passes, so branches without such suites are unaffected.

- Initiative 6 owns `src/lib/garden/export.ts` and `app/garden/export/route.ts`; the
  export formatter here lives in `export-format.ts` to avoid a filename collision, and
  the route edit is limited to importing it. Initiative 6 should fold or rename as it
  sees fit and keep `export-format.test.ts` green.
- Initiative 2 (`entry-editor.tsx`) and others adding pure modules should colocate
  `*.test.ts(x)` files; the harness picks them up without configuration.
- Proposed decision: whether a coverage threshold should gate CI once more modules are
  covered. Not proposed now; no migrations or hosted changes are proposed.

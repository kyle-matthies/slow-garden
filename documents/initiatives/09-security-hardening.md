# Feature brief: Security headers, dependency audit, RLS review receipts

- Horizon and phase: H1 web dogfood · September 2026 initiative wave, initiative 9 (P1)
- Status: Implemented; hosted verification pending
- Owner: Kyle (delivered by an independent agent under D-021)

## User problem

A person writing private, unfinished thoughts must be able to trust that the web
garden cannot be framed by another site, cannot load or send data to an unexpected
origin, cannot leak identifiers through referrers, and cannot silently depend on a
vulnerable package. Before this initiative the app set a basic header set with no
Content Security Policy, CI ran no dependency audit, and the threat-model receipts
T-01–T-13 were not tracked against the deployed web app.

## Why delay or accumulation matters

Slow Garden asks people to leave writing in place for weeks. The longer material
accumulates, the more a single origin compromise or dependency advisory would
expose. Security controls must be receipted before AI activation adds a provider
to the data path.

## Proposed capability

- Every web response carries an enforced Content Security Policy plus HSTS,
  frame, referrer, permissions, MIME, and cross-origin isolation headers, and no
  framework fingerprint.
- Pull requests fail when `applications/web` depends on a package with a high or
  critical advisory.
- A security review document lists each threat T-01–T-13 with an automated
  receipt, an inspection note, or an explicit gap and follow-up.

## Trust and agency

The system reads nothing new. Headers are static per build; the only environment
input is `NEXT_PUBLIC_SUPABASE_URL`, used to allow the browser to talk to the
configured Supabase project and nothing else. No telemetry or reporting endpoint
is added. No hosted configuration, migration, or AI activation is touched.

## States and failure modes

- **Unconfigured build** (no Supabase URL): `connect-src 'self'`; the app already
  redirects to `/login` and makes no Supabase calls.
- **Environment mismatch** (build URL differs from runtime project): browser
  requests to Supabase are blocked by CSP and Auth fails closed; nothing leaks.
- **Development**: `'unsafe-eval'` is added to `script-src` for React's debug
  tooling; `upgrade-insecure-requests` is omitted so `http://localhost` works.
- **Audit advisory appears upstream**: CI fails on the next pull request until the
  lockfile is updated or the finding is documented.
- **Static assets and API routes** receive the same headers; there is no route
  without a policy.

## Acceptance evidence

- Headers verified with `curl -sI` against a local production build on `/`,
  `/login`, `/api/health`, `/garden`, and a `/_next/static` asset. Receipt table in
  [SECURITY_REVIEW_2026-09.md](../operations/SECURITY_REVIEW_2026-09.md#receipt--headers-on-a-local-production-build).
- CI `web` job contains `npm audit --audit-level=high`; local run reports
  `found 0 vulnerabilities`.
- The review document lists T-01–T-13 with receipt, inspection, or gap.

## Dependencies and non-goals

Depends on ADR-006 (web-first) and the threat model. Non-goals: nonce-based strict
CSP (requires `proxy.ts` and a rendering decision; follow-up F-1), secret scanning,
Edge Function dependency audit, hosted header verification through Vercel, any
change to Supabase configuration or migrations.

## Implementation receipt

What was built:

- `applications/web/next.config.ts`: enforced CSP built from directives with the
  Supabase origin (`https` and `wss`) derived from `NEXT_PUBLIC_SUPABASE_URL`;
  HSTS (2 years, `includeSubDomains; preload`), `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, expanded `Permissions-Policy`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control: off`, and
  `poweredByHeader: false`.
- `.github/workflows/ci.yml`: `Audit dependencies` step (`npm audit
  --audit-level=high`) after `npm ci` in the `web` job.
- `documents/operations/SECURITY_REVIEW_2026-09.md`: header rationale and
  receipt, audit receipt, RLS test receipt, per-threat table T-01–T-13, and
  follow-ups F-1–F-10.

How it was verified (Node 22.23.2, 2026-09-10):

- `npm --prefix applications/web ci` — pass, `found 0 vulnerabilities`.
- `npm --prefix applications/web run lint` — pass.
- `cd applications/web && npx tsc --noEmit` — pass.
- `npm --prefix applications/web run build` — pass (with and without synthetic
  Supabase environment values).
- `node --test services/garden-worker/runtime.test.mjs` — 14/14 pass.
- `cd applications/web && npm audit --audit-level=high` — `found 0 vulnerabilities`.
- `npm run start -p 3123` + `curl -sI` on five routes — all headers present,
  `X-Powered-By` absent, CSP string matches the documented policy.
- `npx supabase@2.109.1 start` (Docker) + `supabase test db --local supabase/tests`
  — `Files=2, Tests=53, Result: PASS`; `supabase db lint --local --schema
  public,private --level warning --fail-on error` — no schema errors. No file under
  `supabase/` was changed.

What was NOT verified:

- Absence of CSP violations in a browser on the authenticated garden workspace
  (needs a local Supabase stack with Auth; F-2).
- Headers as served by the hosted Vercel deployment.
- CI run of the new audit step on GitHub (the PR's CI result is the receipt).
- Any hosted Supabase advisor output.

## Follow-ups

See F-1–F-10 in the review document. Proposed decisions for the wave owner:

- Nonce-based strict CSP vs. static landing and login pages (F-1).
- Whether the WebCrypto key requirement applies to initiative 2's IndexedDB drafts
  (F-7).
- Recent-authentication requirement for export (F-8).

No migration is proposed. Test-only extensions to `supabase/tests` (F-4, F-10) are
recommended for the next database change.

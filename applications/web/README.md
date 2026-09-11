# Slow Garden web companion

Next.js App Router companion for secure desktop capture and review. The native SwiftUI application remains the primary mobile client.

## Local setup

1. Run `vercel env pull .env.local --environment=development` after the Vercel development environment has been connected to a non-production Supabase project, or copy `.env.example` to `.env.local` and use local Supabase values.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never use the production project for local or preview development.
3. Run `npm install` and `npm run dev`.

The login UI expects a six-digit email OTP, explains the code flow, and offers
"Resend code" with a 30-second cooldown. An account with no gardens lands on the
four-step first run in `src/app/garden/first-run.tsx` (garden → topic → thought →
write) instead of the workspace. The repository includes the local
template at `supabase/templates/magic_link.html`. Deploy Auth URL, expiry, MFA,
and template changes with `supabase config push --project-ref <project-ref>`.

Only the Supabase publishable key belongs in this application. Never add a secret or service-role key to a `NEXT_PUBLIC_` variable.

## Accessibility checks

`accessibility/` holds a self-contained axe harness. It boots `next dev` without
Supabase env, renders synthetic garden fixtures through `/dev/axe-fixtures`
(only when `GARDEN_AXE_FIXTURES=1`; the route 404s otherwise), and checks
light/dark, 390px and 1280px, overflow, a 200% zoom proxy, and contrast. See
`accessibility/README.md`; receipts live in `documents/initiatives/receipts/08/`.
Colours are tokens in `src/app/globals.css` with dark values under
`prefers-color-scheme: dark`; add new colours as tokens in both blocks.
## Garden lenses

The garden overview is the primary surface. Two secondary, URL-backed lenses live in
`src/app/garden/chronology.tsx` with pure helpers in `src/lib/garden/search.ts`:

- `?view=timeline` (optionally with `topic=`) lists saved entries by calendar day.
- The search field ranks thought titles above entry bodies, shows a bounded excerpt
  with highlighted terms, caps results at 30, and hides archived writing unless
  "Include archived" is checked (or the Archive view is open).

Both read only the already-loaded page data; nothing is fetched or stored. Test the
helpers with Node 22 type stripping:

    node --test src/lib/garden/search.test.mjs

## Authorization boundary

The browser and Server Components use the authenticated user JWT. Supabase RLS enforces `tenant_id = auth.uid()` for every personal application row. Next.js redirects improve navigation but are not the authorization boundary.

## Tests

Run `npm test` for a single Vitest run using jsdom and React Testing Library. Vitest only
collects `src/**/*.test.{ts,tsx}`; plain `node:test` suites (`src/**/*.test.mjs` and
`tests/**/*.test.mjs`) run with `npm run test:node`, and CI runs both.
Tests are colocated under `src/**/*.test.ts(x)`. Use `npm run test:watch` for
watch mode; CI runs the single-run test suite.
## Response headers and dependency audit

`next.config.ts` sends an enforced Content Security Policy, HSTS, frame, referrer,
permissions, and cross-origin isolation headers on every route. `connect-src`
allows only the origin in `NEXT_PUBLIC_SUPABASE_URL` at build time, so build with
the same Supabase environment the deployment will use. CI fails on
`npm audit --audit-level=high`. Rationale, receipts, and open gaps are in
[`documents/operations/SECURITY_REVIEW_2026-09.md`](../../documents/operations/SECURITY_REVIEW_2026-09.md).

## Production promotion

1. Create a migration with `supabase migration new <name>` and review it.
2. Run `supabase start` and `supabase test db --local supabase/tests`.
3. Run both Supabase security and performance advisors.
4. Run `supabase db push --linked --dry-run`, then `supabase db push --linked`.
5. Regenerate `src/types/database.ts` from the migration-replayed local schema;
   CI verifies this deterministic output. Use hosted generation only as a
   structural drift check because hosted and local PostgREST metadata can differ.
6. Run `npm run lint`, `npm test`, and `npm run build`.
7. Deploy a Vercel preview against a synthetic-data Supabase environment; promote the verified artifact to production.

Production and preview must not share Supabase credentials. The production
Vercel project currently receives only the public project URL and publishable
key; no secret or service-role key belongs in the web runtime.

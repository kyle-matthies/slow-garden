# Slow Garden web companion

Next.js App Router companion for secure desktop capture and review. The native SwiftUI application remains the primary mobile client.

## Local setup

1. Run `vercel env pull .env.local --environment=development` after the Vercel development environment has been connected to a non-production Supabase project, or copy `.env.example` to `.env.local` and use local Supabase values.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never use the production project for local or preview development.
3. Run `npm install` and `npm run dev`.

The login UI expects a six-digit email OTP. The repository includes the local
template at `supabase/templates/magic_link.html`. Deploy Auth URL, expiry, MFA,
and template changes with `supabase config push --project-ref <project-ref>`.

Only the Supabase publishable key belongs in this application. Never add a secret or service-role key to a `NEXT_PUBLIC_` variable.

## Authorization boundary

The browser and Server Components use the authenticated user JWT. Supabase RLS enforces `tenant_id = auth.uid()` for every personal application row. Next.js redirects improve navigation but are not the authorization boundary.

## Production promotion

1. Create a migration with `supabase migration new <name>` and review it.
2. Run `supabase start` and `supabase test db --local supabase/tests`.
3. Run both Supabase security and performance advisors.
4. Run `supabase db push --linked --dry-run`, then `supabase db push --linked`.
5. Regenerate `src/types/database.ts` from the migration-replayed local schema;
   CI verifies this deterministic output. Use hosted generation only as a
   structural drift check because hosted and local PostgREST metadata can differ.
6. Run `npm run lint` and `npm run build`.
7. Deploy a Vercel preview against a synthetic-data Supabase environment; promote the verified artifact to production.

Production and preview must not share Supabase credentials. The production
Vercel project currently receives only the public project URL and publishable
key; no secret or service-role key belongs in the web runtime.

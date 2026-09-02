# Slow Garden web companion

Next.js App Router companion for secure desktop capture and review. The native SwiftUI application remains the primary mobile client.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the linked Slow Garden Supabase project.
3. Run `npm install` and `npm run dev`.

The login UI expects a six-digit email OTP. The repository includes the local
template at `supabase/templates/magic_link.html`; copy that content into the
hosted project's **Authentication → Email Templates → Magic Link** template
before enabling production sign-in.

Only the Supabase publishable key belongs in this application. Never add a secret or service-role key to a `NEXT_PUBLIC_` variable.

## Authorization boundary

The browser and Server Components use the authenticated user JWT. Supabase RLS enforces `tenant_id = auth.uid()` for every personal application row. Next.js redirects improve navigation but are not the authorization boundary.

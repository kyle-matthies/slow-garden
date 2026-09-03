# Production bootstrap receipt

- Last verified: 2026-09-03
- Supabase project: `slow-garden` (`sskrghiigqimvxcileqb`)
- Region: `us-west-1`
- Vercel production: `https://slow-garden.vercel.app`

## Applied state

- `20260902064527_personal_tenant_core.sql`
- `20260903064547_add_covering_fk_indexes.sql`
- `20260903070437_provision_account_on_signup.sql`
- New Supabase Auth users are provisioned with a matching tenant account by a
  private, fixed-search-path trigger. The trigger does not copy user metadata.
- Auth Site URL points to the canonical Vercel origin.
- Email OTP uses six digits, expires after ten minutes, and is rate-limited to one request per minute.
- Email confirmation and TOTP enrollment/verification are enabled.
- Vercel Production contains only the Supabase URL and publishable key. Preview and Development do not share Production credentials.

## Verification evidence

- Hosted migration history exactly matches all repository migration versions.
- `supabase db push --linked --dry-run` reports the remote database is up to date.
- All four exposed application tables have RLS enabled.
- The hosted 14-assertion pgTAP suite reached its final passing assertion.
- The hosted suite now proves both synthetic Auth signups receive isolated
  tenant accounts automatically, closing the first-garden foreign-key gap.
- A second rollback-only two-user canary proved cross-tenant reads, impersonated inserts, cross-tenant graph links, and cross-tenant updates fail.
- The canary proved authenticated atomic seed creation succeeds and leaves no synthetic users or rows afterward.
- Supabase security advisor: no findings.
- Missing foreign-key index findings were remediated; remaining index notices are expected for an empty database.
- Web lint, TypeScript validation, and optimized production build pass against
  deterministic types generated from the migration-replayed schema.
- The project-scoped agent endpoint exposes database/debugging/development/docs
  features only, contains no credential in Git, and denies direct trigger
  execution to anonymous and authenticated application roles.

## Open production gate

Supabase's default email delivery is not the public launch mail service. Connect
a production SMTP provider and verify delivery, expiry, single use, sign-out,
and session revocation with an explicitly approved test address before inviting
external users or storing real journal material.

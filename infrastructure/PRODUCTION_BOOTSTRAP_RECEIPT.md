# Production bootstrap receipt

- Last verified: 2026-09-05
- Supabase project: `slow-garden` (`sskrghiigqimvxcileqb`)
- Region: `us-west-1`
- Vercel production: `https://slowgarden.app`

## Applied state

- `20260902064527_personal_tenant_core.sql`
- `20260903064547_add_covering_fk_indexes.sql`
- `20260903070437_provision_account_on_signup.sql`
- New Supabase Auth users are provisioned with a matching tenant account by a
  private, fixed-search-path trigger. The trigger does not copy user metadata.
- Auth Site URL points to the canonical Vercel origin.
- Email OTP uses six digits, expires after ten minutes, and is rate-limited to one request per minute.
- Email confirmation and TOTP enrollment/verification are enabled.
- Supabase Auth uses Brevo custom SMTP over port 587 with the sender
  `Slow Garden <no-reply@auth.slowgarden.app>`.
- `auth.slowgarden.app` is authenticated in Brevo with its required ownership,
  DKIM, and DMARC DNS records hosted by Vercel.
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
- The initial one-time SMTP credential was revoked after its generation view
  was captured by automation. A replacement credential was transferred directly
  into Supabase, is masked after save, and is not stored in Git or local files.
- The replacement key has an explicit September 5, 2027 expiry and Brevo also
  expires SMTP keys after 90 days without use; rotate it before either condition
  can interrupt authentication mail.
- A production Auth request returned HTTP 200. Brevo recorded the message as
  sent, delivered, first-opened, and opened from the authenticated sender to the
  explicitly approved owner address.
- Supabase recorded the associated `/auth/v1/otp` request and subsequent
  `/auth/v1/verify` redirect. The resulting Auth user is email-confirmed and has
  exactly one automatically provisioned tenant account.

## Production email gate

The registered `slowgarden.app` domain is attached to the production project,
Vercel reports ownership verified, its nameservers are correct, and the HTTPS
health endpoint returns `{"status":"ok"}`. Supabase's canonical Auth Site URL
has been pushed to `https://slowgarden.app`.

The production email-provider gate is complete: Brevo is configured directly,
without a Vercel Marketplace subscription, and Supabase no longer relies on its
default development-only mail service. The test proved real delivery and account
provisioning. OTP expiry and single-use behavior, sign-out, session revocation,
account deletion, and data-export behavior remain separate private-alpha gates
before inviting external users or storing real journal material.

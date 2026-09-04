# Infrastructure

Reviewed infrastructure-as-code, database migrations, environment configuration, and deployment policy live here.

No production credentials, private source data, unredacted logs, or manually copied cloud state belong here. Vendor selection and environment topology remain roadmap decisions.

## Current production topology

- Supabase project: `slow-garden` (`sskrghiigqimvxcileqb`, `us-west-1`)
- Vercel project: `slow-garden` (`applications/web`)
- Production URL: `https://slowgarden.app`
- Database authority: committed SQL under `supabase/migrations/`
- Tenant boundary: Supabase Auth user UUID plus PostgreSQL RLS

The Supabase CLI is linked locally through ignored state. Use MCP/SQL for
inspection, but keep every durable DDL change in a migration. Preview and local
development must use synthetic data and separate credentials; production data
must never be copied backward.

Follow the project-scoped agent and migration procedure in
[`SUPABASE_CHANGE_WORKFLOW.md`](SUPABASE_CHANGE_WORKFLOW.md).

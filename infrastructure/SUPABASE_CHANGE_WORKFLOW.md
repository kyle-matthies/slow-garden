# Supabase change workflow

Slow Garden has one hosted database authority: Supabase project
`sskrghiigqimvxcileqb`. The repository migration ledger is the durable source of
schema truth. Hosted table-editor or ad hoc SQL changes are not a second source
of truth.

## Agent access

The repository `.mcp.json` scopes compatible coding agents to this project and
enables only database, debugging, development, and documentation features. It
does not contain a token. Each operator authenticates through Supabase OAuth and
must keep tool-call approval enabled.

The connection is write-capable because schema and RLS work are part of the
approved build process. Use that capability only to apply a reviewed migration,
run rollback-only synthetic canaries, and inspect structural state. Production
queries are metadata, policy, migration-ledger, advisor, and aggregate-count
queries by default. Do not retrieve tenant source text, derived prose, account
email addresses, or other private content into an agent context without explicit
authorization for that exact diagnostic.

## Schema change sequence

1. Verify the resolved checkout with `workspace-guard`, Git top-level, common
   directory, origin, branch, and worktree status.
2. Refresh the Supabase changelog and relevant current documentation.
3. Run `supabase migration new <descriptive_name>`; edit the generated file and
   its pgTAP coverage together.
4. Start the local database-only stack and run:

   ```sh
   supabase db lint --local --schema public,private --level warning --fail-on error
   supabase test db --local supabase/tests
   supabase gen types typescript --local --schema public > /tmp/slow-garden-database.ts
   diff -u applications/web/src/types/database.ts /tmp/slow-garden-database.ts
   ```

5. Review the migration for tenant-keyed foreign keys, least-privilege grants,
   RLS `USING` and `WITH CHECK` predicates, safe function search paths, and
   default function execution privileges.
6. Apply the exact reviewed migration through the project-scoped Supabase
   connection. Do not paste a different SQL variant into production.
7. Run security and performance advisors, then a rollback-only two-user hosted
   canary. A canary must leave no synthetic Auth users or application rows.
8. Confirm `supabase migration list --linked` aligns local and remote versions
   and `supabase db push --linked --dry-run` reports the remote database is up to
   date.
9. Regenerate client types from the migration-replayed local `public` schema,
   then compare hosted generation structurally. Hosted and local PostgREST
   versions may emit different helper metadata or formatting even when the
   application schema matches. Run web lint/build, inspect the staged diff for
   secrets, commit, push, and require green GitHub CI plus a Ready Vercel
   deployment.

## Credentials and handoff

Local CLI linkage lives under ignored `supabase/.temp/`. Never commit a personal
access token, database password, secret/service-role key, SMTP credential, or
private data. A fresh operator can authenticate the project-scoped MCP endpoint
and verify its starting point with migration-list, catalog, and advisor reads;
they should not need another Supabase account or a copied credential.

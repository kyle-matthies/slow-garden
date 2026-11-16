# Hosted apply checklist: the six November 16 migrations

Status: prepared 2026-11-16. **Nothing here has been run against the hosted project.**
Source: the final pre-apply review of the first five migrations (verdict: safe to apply
with every switch at its default), updated for the sixth.
Owner: Kyle gives the go; the operator is Kyle or an agent on his go, using the
project-scoped Supabase connection with tool approval on.
Related: [SUPABASE_CHANGE_WORKFLOW](../../infrastructure/SUPABASE_CHANGE_WORKFLOW.md),
[AI activation runbook](AI_ACTIVATION_RUNBOOK.md) Phase 2,
[BROWSER_PATH_RULES](BROWSER_PATH_RULES_2026-11-16.md),
[TENDING_FOLLOWUPS](TENDING_FOLLOWUPS_2026-11-16.md),
[reversal order](ACTIVATION_PREREQUISITES_2026-11-16.md) §9.

Every query below returns counts, booleans, names or versions. None reads a note body,
a bloom, a title, an email address or any other content. Record each result with the
date and who observed it.

## The migrations, in order

| # | Version | What it does |
|---|---|---|
| 1 | `20261116010931_in_app_deletion` | Deletion RPCs; withdraws direct deletes; provider-orphan ledger |
| 2 | `20261116023935_ai_tenant_allowlist` | Owner-only allowlist for tending |
| 3 | `20261116023937_provider_transport` | Transport and reasoning-effort settings; dispatch ledger; cost rule; NULL-safe lease |
| 4 | `20261116023939_garden_scheduling` | `pg_cron`, `pg_net`, gated worker tick and nightly job, tick tokens |
| 5 | `20261116041903_browser_path_rules` | Database switch for deletion; archive, blank, length and date rules; committing nightly procedure |
| 6 | `20261116061751_tending_followups` | Three blooms per garden per night; lock order; nightly procedure robustness |

## Rules for the apply

- **Do not pause part-way.** Apply all six in one sitting. After migrations 1 to 4
  without 5, the deletion RPCs exist and are granted to signed-in accounts with no
  database switch in front of them; only the web flag would stand between a person and
  permanent erasure. If the sequence is interrupted after 1 and before 5, finish it or
  follow the reversal order before doing anything else.
- **Keep `GARDEN_DELETION_ENABLED` off** in the web deployment before, during and
  after. Deletion needs both that flag and `private.deployment_switches.deletion_enabled`,
  and turning either on is a separate owner decision.
- **Web first.** The deployed web application must be at or after commit `59de808`
  before the first migration is applied (it tolerates a database with or without the
  new functions; an older build's import fails at its date update once migration 5 is in).
- **Migrations 1 to 4 set no `lock_timeout`.** Migration 1 takes ACCESS EXCLUSIVE on
  `public.gardens` and `public.seeds` (it drops two policies and revokes a privilege).
  Behind a long-running transaction it would wait, and every read and write of those
  tables would wait behind it. Check for long transactions immediately before applying
  (PRE 4) and apply at a quiet moment. Migrations 5 and 6 set `lock_timeout='5s'` and
  `statement_timeout='120s'`; if one of them reports a lock timeout it has rolled back
  whole and changed nothing: wait and run it again.
- **A backup or point-in-time recovery point is confirmed** before the first migration
  (PRE 1), and its time is written down.
- Apply the exact committed files. Do not paste a variant.
- Leave every switch at its default afterwards: runtime off, allowlist empty, transport
  `batch`, nightly off, deletion off, no worker URL in Vault. Turning any of them on is
  the runbook's business, not this checklist's.

## PRE: before the first migration

| # | Check | Expected |
|---|---|---|
| 1a | `supabase migration list --linked` | The hosted ledger holds exactly the seven older versions: `20260902064527`, `20260903064547`, `20260903070437`, `20260907003913`, `20260907004656`, `20260907011849`, `20261010004736` |
| 1b | `supabase db push --linked --dry-run` | Lists exactly the six pending versions above, in that order, and nothing else |
| 1c | Supabase dashboard, Database, Backups | A backup or PITR point exists from today; record its time |
| 2a | `select enabled from private.ai_runtime;` | `false` |
| 2b | `select count(*) from public.garden_passes where status in('queued','processing');` | `0` |
| 2c | `select count(*) from vault.secrets where name='garden_worker_url';` | `0` |
| 3a | `select count(*) from pg_policies where policyname in('gardens_delete_own','seeds_delete_own');` | `2` (migration 1 drops them by name and fails if either is missing) |
| 3b | `select has_table_privilege('postgres','auth.users','DELETE'), has_table_privilege('postgres','auth.sessions','SELECT');` | `true, true` (account deletion needs both) |
| 4 | `select count(*) from pg_stat_activity where xact_start<now()-interval '1 minute';` | `0`. If not, wait; do not apply behind a long transaction |
| 5a | `select name from pg_available_extensions where name in('pg_cron','pg_net') order by 1;` | both listed |
| 5b | `select unnest(rolconfig) from pg_roles where rolname='authenticator';` and read the `pgrst.db_schemas` entry (or the dashboard's API settings, "Exposed schemas") | does not include `net`, `cron` or `private` |
| 6 | The "Hosted report" query in [BROWSER_PATH_RULES](BROWSER_PATH_RULES_2026-11-16.md) | Counts recorded. Informational: no count blocks the apply, and no row counted is changed |
| 7 | Web deployment commit; `GARDEN_DELETION_ENABLED` and `GARDEN_AI_ENABLED` in the Production environment | at or after `59de808`; deletion flag off; AI flag as it was |

## Apply

`supabase db push --linked` (or the six files one after another through the
project-scoped connection, in order, without pausing). Note the time each finished.

## POST: immediately after the sixth

| # | Check | Expected |
|---|---|---|
| 1 | `supabase migration list --linked`; `supabase db push --linked --dry-run` | Thirteen versions, local and remote aligned; "up to date" |
| 2 | `select count(*) from private.ai_tenants;` | `0` |
| 3 | `select deletion_enabled from private.deployment_switches;` | `false` |
| 4 | `select enabled, transport, reasoning_effort, nightly_enabled from private.ai_runtime;` | `false, batch, null, false` |
| 5 | `select jobname, schedule, command from cron.job order by jobname;` | Three jobs: `slow-garden-cron-prune`; `slow-garden-nightly` at `7 * * * *` with command `call private.run_nightly_enqueue()`; `slow-garden-worker` at `*/5 * * * *` with command `select private.tick_garden_worker()` |
| 6 | `select private.tick_garden_worker();` | null (runtime off, nothing owed, no worker URL) |
| 7 | `select count(*) from net.http_request_queue;` | `0` |
| 8 | `select conname, convalidated from pg_constraint where conname in('seed_revisions_body_rule','bloom_responses_correction_rule') order by 1;` | both present, both `convalidated=false`. Never validate them |
| 9 | `select count(*) from private.bloom_cycles; select count(*) from private.nightly_skips; select count(*) from private.worker_ticks; select count(*) from private.provider_orphans;` | `0, 0, 0, 0` |
| 10 | `select count(*) from pg_trigger where tgname in('passes_allowlist','passes_lock_inputs_first','pass_inputs_freeze_runtime','pass_inputs_keep_orphan','ai_tenants_removed') and not tgisinternal;` | `5` |
| 11 | `select has_function_privilege('authenticated','public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean)','execute'), has_function_privilege('authenticated','public.consume_worker_tick(text)','execute'), has_function_privilege('authenticated','public.mark_garden_dispatch(uuid,uuid,boolean,integer)','execute');` | `false, false, false` |
| 12 | Security and performance advisors (workflow step 7) | No new error-level finding. `pg_net`'s own grants are a known, recorded item (runbook 2.7) |
| 13 | Canary: run `scripts/hosted-canary.sql` | The statement before the rollback returns `hosted synthetic canary passed`; afterwards `select count(*) from auth.users where email like 'slow-garden-canary-%';` is `0` |
| 14 | After the next `:07`: `select status, count(*) from cron.job_run_details d join cron.job j using(jobid) where j.jobname='slow-garden-nightly' group by 1;` | only `succeeded`. With the gates closed the procedure commits once and returns; this is its first hosted commit and it touches nothing |
| 15 | Web: sign in, open the garden, save an entry, open Returns | Works as before; no deletion control is shown |
| 16 | Regenerate types from the migration-replayed local schema and compare with `applications/web/src/types/database.ts` (workflow step 9) | identical |

Do **not** run `scripts/hosted-nightly-canary.sql` here: it needs the runtime enabled
and belongs to runbook Phase 3 (3.12).

## If something is wrong

- A PRE check fails: do not apply. Nothing has changed.
- A migration fails: each runs in one transaction and rolls back whole. Read the error
  (SQLSTATE and message only), fix the cause, and continue from that migration without
  leaving the sequence between 1 and 5.
- A POST check fails: keep every switch off, keep `GARDEN_DELETION_ENABLED` off, and
  follow the reversal order (latest first) in
  [ACTIVATION_PREREQUISITES §9](ACTIVATION_PREREQUISITES_2026-11-16.md), as new reviewed
  migrations. Deleted data is restored only from the backup recorded in PRE 1c.

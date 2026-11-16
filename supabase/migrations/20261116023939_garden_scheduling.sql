-- Scheduling for the garden worker and nightly tending (ADR-008 "Scheduling",
-- runbook Phase 4b step 2, activation prerequisites 2026-11-16).
--
-- This is the only migration that installs pg_cron and pg_net. It is safe to
-- apply before anything is configured, and it is one file on purpose: the
-- two jobs are separated by their own gates rather than by holding a second
-- committed migration back, which would leave local and hosted migration
-- history out of step between Phase 3 and Phase 4b.
--
--   slow-garden-worker   every five minutes   private.tick_garden_worker()
--     Returns null, and makes no request, unless the worker URL and secret are
--     in Vault AND there is work: an active pass while the runtime is enabled,
--     or cleanup that is still owed (which must run even after the runtime is
--     switched off, so a late cancellation is never stranded).
--   slow-garden-nightly  hourly at :07        private.tick_nightly_enqueue()
--     Returns null, and enqueues nothing, unless the runtime is enabled AND
--     private.ai_runtime.nightly_enabled is true AND the worker is configured.
--     nightly_enabled defaults to false; only the operator sets it (Phase 4b).
--     Even then only allowlisted accounts are enqueued (private.ai_tenants).
--   slow-garden-cron-prune  daily              keeps a week of cron run history.
--
-- Vault secrets (stored by the owner, never in Git, never in this file):
--   garden_worker_url     the worker's https URL
--   garden_worker_secret  the same value as the function's GARDEN_WORKER_SECRET
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table private.ai_runtime add column nightly_enabled boolean not null default false;

-- The worker endpoint, or no row when it is not configured. Plain http is
-- refused so the secret is never sent in the clear.
create function private.garden_worker_endpoint(out url text,out secret text) returns setof record
language sql stable security definer set search_path='' as $$
  select u.decrypted_secret,s.decrypted_secret
    from vault.decrypted_secrets u, vault.decrypted_secrets s
    where u.name='garden_worker_url' and s.name='garden_worker_secret'
      and u.decrypted_secret ~ '^https://' and char_length(s.decrypted_secret)>=32;
$$;
revoke all on function private.garden_worker_endpoint() from public,anon,authenticated,service_role;

-- Returns the pg_net request id, or null when nothing was sent.
-- The timeout outlasts a synchronous provider call (the worker bounds its own
-- run well inside the Edge Function limit). The response pg_net keeps is the
-- worker's state JSON: states and counts, never text.
create function private.tick_garden_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare w record; v_enabled boolean;
begin
  select enabled into v_enabled from private.ai_runtime where singleton;
  if not (
    (v_enabled and exists(select 1 from public.garden_passes where status in('queued','processing')))
    or exists(select 1 from private.pass_inputs where cleanup_pending)
    or exists(select 1 from private.provider_orphans where attempts<20)
  ) then return null; end if;
  select * into w from private.garden_worker_endpoint();
  if w.url is null then return null; end if;
  return net.http_post(url:=w.url,body:='{}'::jsonb,
    headers:=jsonb_build_object('Authorization','Bearer '||w.secret,'Content-Type','application/json'),
    timeout_milliseconds:=140000);
end $$;
revoke all on function private.tick_garden_worker() from public,anon,authenticated,service_role;

-- Returns the number of passes enqueued, or null when the gates are closed.
create function private.tick_nightly_enqueue(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if not (select enabled and nightly_enabled from private.ai_runtime where singleton) then return null; end if;
  -- No worker, no queue: a pass nobody will process only expires and is charged.
  if not exists(select 1 from private.garden_worker_endpoint()) then return null; end if;
  return private.enqueue_nightly_passes(p_now);
end $$;
revoke all on function private.tick_nightly_enqueue(timestamptz) from public,anon,authenticated,service_role;

select cron.schedule('slow-garden-worker','*/5 * * * *','select private.tick_garden_worker()');
select cron.schedule('slow-garden-nightly','7 * * * *','select private.tick_nightly_enqueue()');
select cron.schedule('slow-garden-cron-prune','23 4 * * *',$$delete from cron.job_run_details where end_time<now()-interval '7 days'$$);

commit;

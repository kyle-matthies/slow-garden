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
--     Returns null, and makes no request, unless the worker URL is in Vault AND
--     there is work the worker could actually claim: an active pass while the
--     runtime is enabled, or cleanup owed by a finished pass or an orphan (which
--     must run even after the runtime is switched off, so a late cancellation is
--     never stranded). With the runtime off and nothing owed it is inert.
--   slow-garden-nightly  hourly at :07        private.tick_nightly_enqueue()
--     Returns null, and enqueues nothing, unless the runtime is enabled AND
--     private.ai_runtime.nightly_enabled is true AND the worker is configured.
--     nightly_enabled defaults to false; only the operator sets it (Phase 4b).
--     Even then only allowlisted accounts are enqueued (private.ai_tenants).
--   slow-garden-cron-prune  daily              keeps a week of cron run history.
--
-- No secret travels through pg_net. pg_net's queue and response tables, and
-- net.http_post itself, are granted to PUBLIC, anon and authenticated by the
-- extension and by the platform's own event trigger, as the extension owner
-- (supabase_admin). The role that runs migrations (postgres) is not that
-- owner, so a REVOKE here does nothing: verified locally on pg_net 0.20.4,
-- "no privileges could be revoked". pg_net has no way to reference a Vault
-- secret from a queued request. So the long-lived GARDEN_WORKER_SECRET is
-- never stored in the database or placed in a request. Each tick instead
-- issues a random single-use token that expires in two minutes, stores only
-- its SHA-256 in private.worker_ticks, and sends the token; the worker
-- redeems it through public.consume_worker_tick (service role only). A role
-- that could read the queue during the instant before pg_net sends the row
-- would see a token that is good for one tick, which does nothing a
-- scheduled tick would not have done, and returns only a state.
-- The response pg_net keeps is the worker's state JSON: fixed codes and
-- counts, never text (enforced by the runtime's report filter).
--
-- Vault (stored by the owner, never in Git, never in this file):
--   garden_worker_url     the worker's https URL. It is not a credential.
--
-- Reversal (no data is lost; run as the operator):
--   select cron.unschedule('slow-garden-worker');
--   select cron.unschedule('slow-garden-nightly');
--   select cron.unschedule('slow-garden-cron-prune');
--   drop function private.tick_nightly_enqueue(timestamptz), private.tick_garden_worker(),
--     private.garden_worker_url(), public.consume_worker_tick(text);
--   drop table private.worker_ticks;
--   alter table private.ai_runtime drop column nightly_enabled;
--   (leave pg_cron and pg_net installed unless nothing else uses them)
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table private.ai_runtime add column nightly_enabled boolean not null default false;

-- Single-use tick tokens. Hashes only.
create table private.worker_ticks (
  token_hash bytea primary key,
  expires_at timestamptz not null
);
alter table private.worker_ticks enable row level security;
create policy worker_ticks_backend_only on private.worker_ticks for all to service_role using(true) with check(true);
revoke all on private.worker_ticks from public,anon,authenticated;
grant select,delete on private.worker_ticks to service_role;

-- The worker redeems the token it was sent. True exactly once, within its lifetime.
create function public.consume_worker_tick(p_token text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  delete from private.worker_ticks
    where token_hash=sha256(convert_to(coalesce(p_token,''),'UTF8')) and expires_at>now();
  return found;
end $$;
revoke all on function public.consume_worker_tick(text) from public,anon,authenticated;
grant execute on function public.consume_worker_tick(text) to service_role;

-- The worker URL, or null when it is not configured. Plain http is refused.
create function private.garden_worker_url() returns text
language sql stable security definer set search_path='' as $$
  select u.decrypted_secret from vault.decrypted_secrets u
    where u.name='garden_worker_url' and u.decrypted_secret ~ '^https://' limit 1;
$$;
revoke all on function private.garden_worker_url() from public,anon,authenticated,service_role;

-- Returns the pg_net request id, or null when nothing was sent.
-- cleanup_pending counts only for finished passes: update_garden_job sets it on
-- every release, including for a pass that is still in flight, and the worker
-- cannot claim an in-flight pass while the runtime is off.
-- The timeout outlasts a synchronous provider call (the worker bounds its own
-- run well inside the Edge Function limit).
create function private.tick_garden_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare v_url text; v_enabled boolean; v_token text;
begin
  select enabled into v_enabled from private.ai_runtime where singleton;
  if not (
    (v_enabled and exists(select 1 from public.garden_passes gp where gp.status in('queued','processing')
        and exists(select 1 from private.ai_tenants t where t.tenant_id=gp.tenant_id)))
    or exists(select 1 from private.pass_inputs i join public.garden_passes gp on gp.id=i.pass_id
        where i.cleanup_pending and gp.status in('cancelled','withdrawn','failed','complete'))
    or exists(select 1 from private.provider_orphans where attempts<20)
  ) then return null; end if;
  v_url:=private.garden_worker_url();
  if v_url is null then return null; end if;
  delete from private.worker_ticks where expires_at<=now();
  v_token:='tick_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into private.worker_ticks(token_hash,expires_at) values(sha256(convert_to(v_token,'UTF8')),now()+interval '2 minutes');
  return net.http_post(url:=v_url,body:='{}'::jsonb,
    headers:=jsonb_build_object('Authorization','Bearer '||v_token,'Content-Type','application/json'),
    timeout_milliseconds:=140000);
end $$;
revoke all on function private.tick_garden_worker() from public,anon,authenticated,service_role;

-- Returns the number of passes enqueued, or null when the gates are closed.
create function private.tick_nightly_enqueue(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if not (select enabled and nightly_enabled from private.ai_runtime where singleton) then return null; end if;
  -- No worker, no queue: a pass nobody will process only expires.
  if private.garden_worker_url() is null then return null; end if;
  return private.enqueue_nightly_passes(p_now);
end $$;
revoke all on function private.tick_nightly_enqueue(timestamptz) from public,anon,authenticated,service_role;

select cron.schedule('slow-garden-worker','*/5 * * * *','select private.tick_garden_worker()');
select cron.schedule('slow-garden-nightly','7 * * * *','select private.tick_nightly_enqueue()');
select cron.schedule('slow-garden-cron-prune','23 4 * * *',$$delete from cron.job_run_details where end_time<now()-interval '7 days'$$);

commit;

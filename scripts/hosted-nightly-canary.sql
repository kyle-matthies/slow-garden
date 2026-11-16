-- Nightly canary (runbook 3.12). NOT rollback-only: private.run_nightly_enqueue()
-- commits after each account, so it can only be exercised for real, outside a
-- transaction. This is the first time that procedure commits on the hosted
-- project, and it must happen here, for a synthetic tenant, before the owner's
-- garden is ever enqueued.
--
-- Run it as the operator during Phase 3, each statement on its own (psql -f, or
-- one statement at a time; never wrapped in BEGIN). Synthetic text only; counts
-- and states only in every result. It refuses to start unless:
--   the runtime is enabled, the nightly switch is off, the worker URL is in
--   Vault, the allowlist is EMPTY (so no real account can be enqueued), and no
--   canary rows are left from an earlier run.
-- Every later step does nothing unless step 1 created the canary account, and
-- the nightly switch is forced off again whatever happens.
-- The canary's passes are deferred as soon as they exist so that a scheduled
-- tick does not send them to the provider; if a tick wins that race it sends
-- synthetic text only, which Phase 3 does anyway.

-- 1. Preconditions and the synthetic tenant: one garden, two tended topics.
do $$
declare t constant uuid:='97979797-9797-4979-8979-979797979791';
begin
  if not (select enabled from private.ai_runtime where singleton) then raise exception 'nightly canary: the runtime must be enabled (Phase 3)'; end if;
  if (select nightly_enabled from private.ai_runtime where singleton) then raise exception 'nightly canary: the nightly switch must be off before the canary'; end if;
  if private.garden_worker_url() is null then raise exception 'nightly canary: the worker URL must be in Vault'; end if;
  if (select count(*) from private.ai_tenants)<>0 then raise exception 'nightly canary: the allowlist must be empty'; end if;
  if exists(select 1 from auth.users where id=t) then raise exception 'nightly canary: rows from an earlier run are still present'; end if;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(t,'slow-garden-nightly-canary@example.test','{}','{}',now(),now());
  update public.accounts set tend_overnight=true,timezone='UTC' where id=t;
  insert into public.gardens(id,tenant_id,name) values('97979797-9797-4979-8979-979797979792',t,'Synthetic nightly garden');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) values
    ('97979797-9797-4979-8979-979797979793',t,'97979797-9797-4979-8979-979797979792','Synthetic topic one',true),
    ('97979797-9797-4979-8979-979797979794',t,'97979797-9797-4979-8979-979797979792','Synthetic topic two',true);
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values
    ('97979797-9797-4979-8979-979797979795',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979793','Synthetic thought one'),
    ('97979797-9797-4979-8979-979797979796',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979794','Synthetic thought two');
  insert into public.entries(id,tenant_id,garden_id,seed_id) values
    ('97979797-9797-4979-8979-979797979797',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979795'),
    ('97979797-9797-4979-8979-979797979798',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979796');
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) values
    ('97979797-9797-4979-8979-979797979799',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979795','97979797-9797-4979-8979-979797979797',1,'Synthetic nightly canary source one.',t),
    ('97979797-9797-4979-8979-97979797979a',t,'97979797-9797-4979-8979-979797979792','97979797-9797-4979-8979-979797979796','97979797-9797-4979-8979-979797979798',1,'Synthetic nightly canary source two.',t);
  insert into private.ai_tenants(tenant_id,note) values(t,'nightly canary');
end $$;

-- 2. Open the nightly switch, only if the canary account exists and is the only allowlisted one.
update private.ai_runtime set nightly_enabled=true
  where singleton and (select count(*) from private.ai_tenants)=1
    and exists(select 1 from private.ai_tenants where tenant_id='97979797-9797-4979-8979-979797979791');

-- 3. The committing run, for a moment in today's 02:00 hour UTC (the canary's time zone).
call private.run_nightly_enqueue(date_trunc('day',now() at time zone 'UTC')::timestamp at time zone 'UTC'+interval '2 hours 30 minutes');

-- 4. Close the switch again, unconditionally, and keep the canary's passes away from the worker.
update private.ai_runtime set nightly_enabled=false where singleton;
update private.pass_inputs set next_attempt_at=now()+interval '1 day'
  where pass_id in(select id from public.garden_passes where tenant_id='97979797-9797-4979-8979-979797979791');

-- 5. What happened. Expect: canary_passes 2, both queued and nightly, one cycle date,
--    shares 2 and 1, no other tenant enqueued, nothing noted as skipped, switch off.
select
  (select count(*) from public.garden_passes where tenant_id='97979797-9797-4979-8979-979797979791' and trigger='nightly' and status='queued') as canary_passes,
  (select count(distinct i.cycle_date) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id='97979797-9797-4979-8979-979797979791') as cycle_dates,
  (select coalesce(sum(i.bloom_allowance),0) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id='97979797-9797-4979-8979-979797979791') as blooms_allowed_for_the_garden,
  (select count(*) from public.garden_passes where trigger='nightly' and created_at>now()-interval '10 minutes' and tenant_id<>'97979797-9797-4979-8979-979797979791') as other_tenants_enqueued,
  (select count(*) from private.nightly_skips where noted_at>now()-interval '10 minutes') as skips_noted,
  (select nightly_enabled from private.ai_runtime where singleton) as nightly_switch,
  case when (select count(*) from public.garden_passes where tenant_id='97979797-9797-4979-8979-979797979791' and trigger='nightly' and status='queued')=2
    and (select coalesce(sum(i.bloom_allowance),0) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id='97979797-9797-4979-8979-979797979791')=3
    and (select count(*) from public.garden_passes where trigger='nightly' and created_at>now()-interval '10 minutes' and tenant_id<>'97979797-9797-4979-8979-979797979791')=0
    and not (select nightly_enabled from private.ai_runtime where singleton)
  then 'hosted nightly canary passed' else 'hosted nightly canary FAILED' end as result;

-- 6. Cleanup. Removing the tenant cancels its passes; deleting the account removes
--    everything else. Nothing was sent, so nothing is charged.
delete from private.ai_tenants where tenant_id='97979797-9797-4979-8979-979797979791';
delete from auth.users where id='97979797-9797-4979-8979-979797979791';

-- 7. What is left. Expect every count 0 and the switch off.
select
  (select count(*) from auth.users where id='97979797-9797-4979-8979-979797979791') as canary_users,
  (select count(*) from public.garden_passes where tenant_id='97979797-9797-4979-8979-979797979791') as canary_passes,
  (select count(*) from private.ai_tenants) as allowlisted,
  (select count(*) from private.provider_orphans) as provider_orphans,
  (select coalesce(sum(reserved_cents),0) from private.ai_months)-(select coalesce(sum(reserved_cents),0) from private.pass_inputs where actual_cents is null) as reservations_without_a_pass,
  (select nightly_enabled from private.ai_runtime where singleton) as nightly_switch;

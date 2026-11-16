-- Nightly canary (runbook 3.12). NOT rollback-only: private.run_nightly_enqueue()
-- commits after each account, so it can only be exercised for real, outside a
-- transaction, and its real run must first happen for a synthetic tenant.
--
-- RUN WITH psql ONLY, as the operator, during Phase 3:
--     psql "$DATABASE_URL" -f scripts/hosted-nightly-canary.sql
-- It uses psql meta-commands and will not run through a SQL editor or an agent's
-- execute-SQL tool; do not paste parts of it. Synthetic text only; every result
-- is counts and states.
--
-- Fail closed:
--   * ON_ERROR_STOP is on: the first error ends the run.
--   * Part A (preconditions, the synthetic tenant, opening the nightly switch,
--     and the proof that the synthetic tenant is the ONLY account nightly
--     enqueue could reach) is one transaction. If anything in it fails, nothing
--     has changed.
--   * It refuses unless: the runtime is enabled, the nightly switch is off, the
--     worker URL is in Vault, the allowlist is empty, no canary rows exist, and
--     no pass is queued or processing.
--   * It changes one setting, nightly_enabled, and puts back exactly the value
--     it found, as its very next statement after the committing call, whether
--     that call succeeded or not.
--   * It never deletes or updates a row it did not create.
-- What it cannot wrap: the committing call itself and the restore after it. If
-- the connection is lost between Part A's commit and the restore, the nightly
-- switch is left on with only the synthetic tenant allowlisted (nothing real can
-- be enqueued); run Part D by hand: restore the switch, then the two deletes.
\set ON_ERROR_STOP on
\set canary '97979797-9797-4979-8979-979797979791'
select set_config('canary.verdict','',false) as reset \gset
select nightly_enabled::text as prior_nightly from private.ai_runtime where singleton \gset
-- A moment in today's 02:00 hour UTC, the synthetic tenant's zone.
select (date_trunc('day',now() at time zone 'UTC')::timestamp at time zone 'UTC'+interval '2 hours 30 minutes')::text as canary_moment \gset

-- Part A: one transaction. Preconditions before any write.
begin;
do $$
declare t constant uuid:='97979797-9797-4979-8979-979797979791';
begin
  if not (select enabled from private.ai_runtime where singleton) then raise exception 'nightly canary refused: the runtime must be enabled (Phase 3)'; end if;
  if (select nightly_enabled from private.ai_runtime where singleton) then raise exception 'nightly canary refused: the nightly switch is already on; this script only runs with it off'; end if;
  if private.garden_worker_url() is null then raise exception 'nightly canary refused: the worker URL must be in Vault'; end if;
  if (select count(*) from private.ai_tenants)<>0 then raise exception 'nightly canary refused: the allowlist must be empty'; end if;
  if exists(select 1 from auth.users where id=t) then raise exception 'nightly canary refused: rows from an earlier run are still present'; end if;
  if exists(select 1 from public.garden_passes where status in('queued','processing')) then raise exception 'nightly canary refused: a pass is queued or processing'; end if;
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
  update private.ai_runtime set nightly_enabled=true where singleton;
end $$;
-- Still inside the transaction: with the switch on, the synthetic tenant must be
-- exactly the set of accounts the nightly run could enqueue, at the canary's
-- moment and at this very moment (the hourly job may fire while the switch is on).
select (private.nightly_accounts(:'canary_moment'::timestamptz)=array[:'canary'::uuid]
    and private.nightly_accounts(now()) <@ array[:'canary'::uuid]
    and (select count(*) from private.ai_tenants)=1
    and private.nightly_gates_open())::int as only_canary \gset
\if :only_canary
\else
  \echo 'nightly canary refused: another account could be enqueued, or the gates are not open. Rolling back; nothing changed.'
  rollback;
  select 1/0 as nightly_canary_refused;
\endif
commit;

-- Part B: the committing run. Errors here must not skip the restore below.
\set ON_ERROR_STOP off
call private.run_nightly_enqueue(:'canary_moment'::timestamptz);
-- Restore the one setting this script changed, to exactly the value it found.
update private.ai_runtime set nightly_enabled=:'prior_nightly'::boolean where singleton;
-- Keep the canary's passes away from the worker (rows this script's run created).
update private.pass_inputs set next_attempt_at=now()+interval '1 day'
  where pass_id in(select id from public.garden_passes where tenant_id=:'canary');

-- Part C: what happened. Expect 2 queued nightly passes, one cycle date, three
-- blooms allowed for the garden, no other tenant enqueued, switch as it was found.
select
  (select count(*) from public.garden_passes where tenant_id=:'canary' and trigger='nightly' and status='queued') as canary_passes,
  (select count(distinct i.cycle_date) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id=:'canary') as cycle_dates,
  (select coalesce(sum(i.bloom_allowance),0) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id=:'canary') as blooms_allowed_for_the_garden,
  (select count(*) from public.garden_passes where status in('queued','processing') and tenant_id<>:'canary') as other_tenants_enqueued,
  (select count(*) from private.nightly_skips where tenant_id=:'canary') as skips_noted,
  (select nightly_enabled from private.ai_runtime where singleton) as nightly_switch;
select set_config('canary.verdict',case when
    (select count(*) from public.garden_passes where tenant_id=:'canary' and trigger='nightly' and status='queued')=2
    and (select count(distinct i.cycle_date) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id=:'canary')=1
    and (select coalesce(sum(i.bloom_allowance),0) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id=:'canary')=3
    and (select count(*) from public.garden_passes where status in('queued','processing') and tenant_id<>:'canary')=0
    and (select count(*) from private.nightly_skips where tenant_id=:'canary')=0
    and (select nightly_enabled from private.ai_runtime where singleton)=:'prior_nightly'::boolean
  then 'passed' else 'failed' end,false) as nightly_canary;

-- Part D: cleanup, one transaction, only rows this script created. Removing the
-- tenant cancels its passes; deleting the account removes the rest. Nothing was
-- sent, so nothing is charged.
begin;
delete from private.ai_tenants where tenant_id=:'canary';
delete from auth.users where id=:'canary';
commit;

-- Part E: what is left, and the verdict. Expect every count 0.
select
  (select count(*) from auth.users where id=:'canary') as canary_users,
  (select count(*) from public.garden_passes where tenant_id=:'canary') as canary_passes,
  (select count(*) from private.ai_tenants) as allowlisted,
  (select coalesce(sum(reserved_cents),0) from private.ai_months)-(select coalesce(sum(reserved_cents),0) from private.pass_inputs where actual_cents is null) as reservations_without_a_pass,
  (select nightly_enabled from private.ai_runtime where singleton) as nightly_switch;
\set ON_ERROR_STOP on
do $$
begin
  if current_setting('canary.verdict',true) is distinct from 'passed' then raise exception 'hosted nightly canary FAILED: see the counts above'; end if;
  if exists(select 1 from auth.users where id='97979797-9797-4979-8979-979797979791') or exists(select 1 from private.ai_tenants) then
    raise exception 'hosted nightly canary: cleanup incomplete'; end if;
end $$;
select 'hosted nightly canary passed' as result;

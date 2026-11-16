#!/usr/bin/env bash
set -euo pipefail
# Proves 20261116080454_tending_lock_and_cycle_fixes.sql upgrades nightly cycles
# recorded by the previous migration (keyed by date) without reopening a night:
# a cycle keeps the moment it really started, its passes are linked to it, and a
# garden whose night's pass is deleted after the upgrade is not tended again
# twelve hours later.
# Destructive ONLY to the dedicated, synthetic Slow Garden test stack.
# Never accepts --linked, credentials, an arbitrary database, or another project name.
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if ! rg -q 'project_id = "slow-garden-web-thinking"' .local-runtime/supabase/config.toml; then
  echo 'Dedicated local test stack required.' >&2; exit 1
fi
cp supabase/migrations/*.sql .local-runtime/supabase/migrations/
supabase db reset --workdir .local-runtime --local --version 20261116061751 --yes > .local-runtime/upgrade-cycles-reset.log 2>&1
db() { docker exec -i supabase_db_slow-garden-web-thinking psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
db -q <<'SQL'
-- State as the previous migration leaves it: two gardens tended on one night
-- (today's date, UTC), each with three blooms published and a cycle row keyed
-- by date. Synthetic text only.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('c8888888-8888-4888-8888-888888888888','legacy-cycles@example.test','{}','{}',now(),now());
update public.accounts set tend_overnight=true,timezone='UTC' where id='c8888888-8888-4888-8888-888888888888';
insert into public.gardens(id,tenant_id,name) select ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,'c8888888-8888-4888-8888-888888888888','Legacy cycle garden '||n from generate_series(1,2) n;
insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) select ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,'c8888888-8888-4888-8888-888888888888',('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,'Legacy topic '||n,true from generate_series(1,2) n;
insert into public.seeds(id,tenant_id,garden_id,plot_id,title) select ('cccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,'c8888888-8888-4888-8888-888888888888',('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,'Legacy thought '||n from generate_series(1,2) n;
insert into public.entries(id,tenant_id,garden_id,seed_id) select ('cddddddd-dddd-4ddd-8ddd-ddddddddddd'||n)::uuid,'c8888888-8888-4888-8888-888888888888',('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,('cccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid from generate_series(1,2) n;
insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  select ('ceeeeeee-eeee-4eee-8eee-eeeeeeeeeee'||n)::uuid,'c8888888-8888-4888-8888-888888888888',('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,('cccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,('cddddddd-dddd-4ddd-8ddd-ddddddddddd'||n)::uuid,1,'Synthetic legacy cycle source '||n||'.','c8888888-8888-4888-8888-888888888888' from generate_series(1,2) n;
insert into private.ai_tenants(tenant_id) values('c8888888-8888-4888-8888-888888888888');
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-test',input_cents_per_million=200,output_cents_per_million=1000;
do $$
declare j jsonb; n integer:=0;
begin
  if private.enqueue_nightly_for('c8888888-8888-4888-8888-888888888888',date_trunc('day',now() at time zone 'UTC')::timestamp at time zone 'UTC'+interval '2 hours 30 minutes')<>2 then raise exception 'legacy night was not enqueued'; end if;
  set local role service_role;
  loop
    j:=public.claim_garden_pass();
    exit when j is null or j->>'status' not in('queued','processing');
    perform public.finish_garden_pass((j->>'id')::uuid,(j->>'token')::uuid,
      jsonb_build_object('blooms',(select jsonb_agg(jsonb_build_object('kind',k,'interpretation','A synthetic '||k||'.','evidence',jsonb_build_array(jsonb_build_object('revision_id',j#>>'{snapshot,0,revision_id}','excerpt','Synthetic legacy cycle source')))) from unnest(array['question','connection','tension']) k),'no_output_reason',null),100,40,false);
    n:=n+1;
  end loop;
  reset role;
  if n<>2 then raise exception 'legacy passes were not published'; end if;
end $$;
do $$begin
 if (select count(*) from private.bloom_cycles where published=3)<>2 then raise exception 'two legacy cycles with three blooms each expected'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='bloom_cycles' and column_name='started_at') then raise exception 'this must start from the previous schema'; end if;
end $$;
-- Garden 2's pass is deleted before the upgrade: its cycle row is all that is left of the night.
create schema upgrade_evidence;
create table upgrade_evidence.passes as select p.id,p.garden_id,p.created_at from public.garden_passes p where p.trigger='nightly';
delete from public.garden_passes where garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
SQL
supabase migration up --workdir .local-runtime --local > .local-runtime/upgrade-cycles-up.log 2>&1
db -q <<'SQL'
do $$
declare c1 private.bloom_cycles; c2 private.bloom_cycles; made timestamptz; later timestamptz; zone text;
begin
  select * into c1 from private.bloom_cycles where garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  select * into c2 from private.bloom_cycles where garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  select created_at into made from upgrade_evidence.passes where garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if (select count(*) from private.bloom_cycles)<>2 or c1.published<>3 or c2.published<>3 then raise exception 'cycle rows or their counts changed in the upgrade'; end if;
  -- A cycle whose pass is still there starts when that pass was created, not at UTC midnight.
  if c1.started_at is distinct from made then raise exception 'cycle did not keep the moment its pass was created'; end if;
  if (select i.cycle_id from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') is distinct from c1.id then raise exception 'legacy pass was not linked to its cycle'; end if;
  -- A cycle with no pass left starts as late as its date allows, never in the future, never at midnight.
  if c2.started_at>now() or c2.started_at<=c2.cycle_date::timestamp at time zone 'UTC' then raise exception 'orphan cycle start is not late-and-not-future'; end if;
  if c2.started_at is distinct from least(now(),(c2.cycle_date+1)::timestamp at time zone 'UTC'+interval '12 hours') and c2.started_at<now()-interval '1 minute' then raise exception 'orphan cycle start is not the latest plausible moment'; end if;

  -- New writing in both gardens, then the night's pass in garden 1 is deleted after the upgrade.
  insert into public.entries(id,tenant_id,garden_id,seed_id,created_at) select gen_random_uuid(),'c8888888-8888-4888-8888-888888888888',garden_id,id,now()+interval '1 minute' from public.seeds where tenant_id='c8888888-8888-4888-8888-888888888888';
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by,created_at)
    select gen_random_uuid(),e.tenant_id,e.garden_id,e.seed_id,e.id,2,'Synthetic later legacy cycle source.',e.tenant_id,now()+interval '1 minute' from public.entries e where e.tenant_id='c8888888-8888-4888-8888-888888888888' and e.created_at>now();
  delete from public.garden_passes where garden_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  -- Twelve hours after the legacy pass was created, in a zone where that moment is 02:00.
  later:=made+interval '12 hours';
  zone:='Etc/GMT'||case when (extract(hour from later at time zone 'UTC')::integer-2+24)%24<=12
      then '+'||((extract(hour from later at time zone 'UTC')::integer-2+24)%24)
      else '-'||(24-(extract(hour from later at time zone 'UTC')::integer-2+24)%24) end;
  update public.accounts set timezone=zone where id='c8888888-8888-4888-8888-888888888888';
  if not private.is_tending_hour(later,zone) then raise exception 'test zone is not in its tending hour'; end if;
  if private.enqueue_nightly_for('c8888888-8888-4888-8888-888888888888',later)<>0 then raise exception 'a night was reopened twelve hours after its legacy pass, once that pass was deleted'; end if;
  if (select count(*) from private.bloom_cycles)<>2 then raise exception 'a second cycle was opened'; end if;
  -- A day and a half later both gardens are tended again, each on a new cycle.
  later:=made+interval '36 hours';
  zone:='Etc/GMT'||case when (extract(hour from later at time zone 'UTC')::integer-2+24)%24<=12
      then '+'||((extract(hour from later at time zone 'UTC')::integer-2+24)%24)
      else '-'||(24-(extract(hour from later at time zone 'UTC')::integer-2+24)%24) end;
  update public.accounts set timezone=zone where id='c8888888-8888-4888-8888-888888888888';
  if private.enqueue_nightly_for('c8888888-8888-4888-8888-888888888888',later)<>2 then raise exception 'the next night was not tended in both gardens'; end if;
  if (select count(*) from private.bloom_cycles)<>4 then raise exception 'each garden should have opened one new cycle'; end if;
end $$;
drop schema upgrade_evidence cascade;
SQL
echo 'Nightly cycles upgrade in place: 2 legacy cycles kept their counts; the one with a pass kept its real start and its link; neither night could be reopened twelve hours later; the next night opened 2 new cycles.'

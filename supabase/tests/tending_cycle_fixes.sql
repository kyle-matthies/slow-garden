-- Nightly cycle fixes (20261116080454): a garden's night cannot be reopened by a
-- time-zone change, a deleted pass or an allowlist round trip. Synthetic data
-- only; every moment is given, nothing depends on when this file runs.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

-- Take away every privilege the API roles hold only by a platform default and
-- not from a migration. Which defaults exist depends on the Postgres image (the
-- image CI starts gives none of these; a newer one gives all of them), so after
-- this the file runs with exactly the migrations' grants on either image.
revoke select,insert,update,delete on public.accounts,public.entries,public.seed_revisions,public.seeds,public.current_entries,public.garden_themes from service_role;
revoke insert,update,delete on public.gardens,public.plots from service_role;
revoke insert,update,delete on public.current_entries,public.garden_themes from authenticated;
revoke execute on function public.create_seed(uuid,text,double precision,double precision),public.save_entry(uuid,uuid,uuid,text,uuid),
  public.import_thought(uuid,uuid,text,jsonb),public.export_garden_sources(),public.garden_capabilities(),public.deletion_preview(text,uuid),
  public.delete_entry(uuid),public.delete_seed(uuid),public.delete_plot(uuid,text),public.delete_garden(uuid,text),public.delete_account(text) from service_role;
select ok(not has_table_privilege('service_role','public.seeds','select') and not has_table_privilege('service_role','public.accounts','select')
  and not has_table_privilege('service_role','public.gardens','update') and not has_table_privilege('service_role','public.garden_themes','select')
  and not has_table_privilege('authenticated','public.current_entries','insert')
  and not has_function_privilege('service_role','public.save_entry(uuid,uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('service_role','public.delete_account(text)','execute'),'the API roles hold only what the migrations grant');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a1111111-1111-4111-8111-111111111111','cycle-alice@example.test','{}','{}',now(),now());
insert into public.gardens(id,tenant_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','a1111111-1111-4111-8111-111111111111','Cycle garden');
insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) values('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01','a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','Cycle topic',true);
insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values('accccccc-cccc-4ccc-8ccc-cccccccccc01','a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01','Cycle thought');
insert into private.ai_tenants(tenant_id) values('a1111111-1111-4111-8111-111111111111');
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-test',input_cents_per_million=200,output_cents_per_million=1000;

-- New writing, as the person would add it between nights. Its time is given, a
-- little after every pass so far, so it never depends on the clock.
create sequence pg_temp.writes;
create function pg_temp.write() returns void language plpgsql as $$
declare e uuid:=gen_random_uuid(); n bigint:=nextval('pg_temp.writes');
begin
  insert into public.entries(id,tenant_id,garden_id,seed_id,created_at) values(e,'a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','accccccc-cccc-4ccc-8ccc-cccccccccc01',now()+n*interval '1 second');
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by,created_at)
    values(gen_random_uuid(),'a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','accccccc-cccc-4ccc-8ccc-cccccccccc01',e,n,'Synthetic cycle source '||n||'.','a1111111-1111-4111-8111-111111111111',now()+n*interval '1 second');
end $$;
create function pg_temp.zone(z text) returns void language sql as $$
  update public.accounts set timezone=z,tend_overnight=true where id='a1111111-1111-4111-8111-111111111111';
$$;
create function pg_temp.three(job jsonb) returns jsonb language sql as $$
  select jsonb_build_object('blooms',(select jsonb_agg(jsonb_build_object('kind',k,'interpretation','A synthetic '||k||'.',
    'evidence',jsonb_build_array(jsonb_build_object('revision_id',job#>>'{snapshot,0,revision_id}','excerpt','Synthetic cycle source'))))
    from unnest(array['question','connection','tension']) k),'no_output_reason',null);
$$;
-- The worker: finish every active pass with three blooms; acknowledge cleanups.
create function pg_temp.finish_all() returns integer language plpgsql as $$
declare j jsonb; n integer:=0;
begin
  set local role service_role;
  loop
    j:=public.claim_garden_pass();
    exit when j is null;
    if j->>'status' not in('queued','processing') then
      if (j->>'settled')::boolean then perform public.update_garden_job((j->>'id')::uuid,(j->>'token')::uuid,null,null,null,true,true);
      else perform public.finish_garden_pass((j->>'id')::uuid,(j->>'token')::uuid,'{"blooms":[],"no_output_reason":null}',0,0,true); end if;
      continue;
    end if;
    perform public.finish_garden_pass((j->>'id')::uuid,(j->>'token')::uuid,pg_temp.three(j),100,40,false);
    n:=n+1;
  end loop;
  reset role;
  return n;
end $$;
create function pg_temp.blooms() returns bigint language sql as $$ select count(*) from public.blooms where garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' $$;
create function pg_temp.tick(t timestamptz) returns integer language sql as $$ select private.enqueue_nightly_for('a1111111-1111-4111-8111-111111111111',t) $$;

-- The reviewer's case: tended at 02:30 in Pago Pago, then the person moves to
-- Tarawa, where it is 02:30 on the next date one hour later.
select pg_temp.zone('Pacific/Pago_Pago');
select pg_temp.write();
select is(pg_temp.tick('2026-11-20 13:30:00+00'),1,'Pago Pago, 02:30 local: the garden is tended');
select is(pg_temp.finish_all(),1,'the pass publishes');
select is(pg_temp.blooms(),3::bigint,'three blooms');
select pg_temp.write();
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select lives_ok($$update public.accounts set timezone='Pacific/Tarawa' where id='a1111111-1111-4111-8111-111111111111'$$,'the person changes time zone across the date line');
reset role;
select ok(private.is_tending_hour('2026-11-20 14:30:00+00','Pacific/Tarawa'),'an hour later it is the tending hour of a new local date');
select is(pg_temp.tick('2026-11-20 14:30:00+00'),0,'but the garden was tended an hour ago: no second night');
select is(pg_temp.finish_all(),0,'nothing to publish');
select is(pg_temp.blooms(),3::bigint,'still three blooms in the garden, not six');
select is((select count(*) from private.bloom_cycles where garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),1::bigint,'one cycle');
select is(pg_temp.tick('2026-11-21 14:30:00+00'),1,'the next Tarawa night, a day later, is tended');
select is(pg_temp.finish_all(),1,'and publishes');
select is(pg_temp.blooms(),6::bigint,'three more, on a new night');

-- Backward across the date line: Tarawa, then Pago Pago 23 hours later (a new
-- night), but not a zone hop that lands inside twenty hours.
select pg_temp.write();
select pg_temp.zone('Pacific/Pago_Pago');
select is(pg_temp.tick('2026-11-22 13:30:00+00'),1,'Tarawa to Pago Pago: its 02:30 comes 23 hours after the last night and is tended');
select is(pg_temp.finish_all(),1,'published');
select pg_temp.write();
select pg_temp.zone('Asia/Kolkata');
select ok(private.is_tending_hour('2026-11-22 20:45:00+00','Asia/Kolkata'),'Kolkata''s tending hour, seven hours later, on the same local date as nothing before');
select is(pg_temp.tick('2026-11-22 20:45:00+00'),0,'a hop to a zone whose night starts seven hours later is not a new night');
select is(pg_temp.tick('2026-11-23 20:45:00+00'),1,'the following Kolkata night is');
select is(pg_temp.finish_all(),1,'published');
select is((select max(published) from private.bloom_cycles),3,'no cycle ever holds more than three');
select is(pg_temp.blooms(),(select 3*count(*) from private.bloom_cycles),'three blooms per cycle, one cycle per night');

-- The night the clocks repeat an hour (Berlin, 25 October 2026: 02:xx happens at 00:07Z and 01:07Z).
select pg_temp.zone('Europe/Berlin');
select pg_temp.write();
select ok(private.is_tending_hour('2026-10-25 00:07:00+00','Europe/Berlin') and private.is_tending_hour('2026-10-25 01:07:00+00','Europe/Berlin'),'Berlin has two 02:00 hours that night');
select is(pg_temp.tick('2026-10-25 00:07:00+00'),1,'the first is tended');
select is(pg_temp.finish_all(),1,'published');
select pg_temp.write();
select is(pg_temp.tick('2026-10-25 01:07:00+00'),0,'the second is the same night');
-- The night they skip one (Los Angeles, 14 March 2027: no 02:00 hour).
select pg_temp.zone('America/Los_Angeles');
select is(pg_temp.tick('2027-03-14 09:30:00+00'),0,'01:30 PST is not the tending hour');
select is(pg_temp.tick('2027-03-14 10:30:00+00'),1,'03:30 PDT stands in for the hour that did not exist');
select is(pg_temp.tick('2027-03-14 11:30:00+00'),0,'and only once');
select is(pg_temp.finish_all(),1,'published');

-- Deleting the night's pass does not reopen the night.
select pg_temp.write();
select count(*) as cycles_before from private.bloom_cycles \gset
delete from public.garden_passes where tenant_id='a1111111-1111-4111-8111-111111111111';
select is((select count(*) from public.garden_passes),0::bigint,'every pass of the garden is deleted');
select is((select count(*) from private.bloom_cycles),:cycles_before::bigint,'the garden''s cycles remain');
select is(pg_temp.tick('2027-03-14 10:45:00+00'),0,'the same night is not tended again after its pass was deleted');
select is(pg_temp.blooms(),0::bigint,'(the blooms went with the pass)');
select is((select published from private.bloom_cycles order by started_at desc limit 1),3,'and the night''s count is not given back');

-- Removing the account from the allowlist and adding it back does not reopen it.
delete from private.ai_tenants where tenant_id='a1111111-1111-4111-8111-111111111111';
insert into private.ai_tenants(tenant_id) values('a1111111-1111-4111-8111-111111111111');
select is(pg_temp.tick('2027-03-14 10:50:00+00'),0,'nor after an allowlist round trip');
select is(pg_temp.tick('2027-03-15 09:30:00+00'),1,'the next night is tended as usual');
select pg_temp.finish_all() as finished \gset

-- A nightly pass with no cycle on it (created by an operator) joins the garden's
-- cycle near its creation rather than opening a second one.
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('afffffff-ffff-4fff-8fff-ffffffffff01','a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01']::uuid[],'nightly');
update public.garden_passes set created_at='2027-03-15 12:00:00+00' where id='afffffff-ffff-4fff-8fff-ffffffffff01';
select count(*) as cycles_then from private.bloom_cycles \gset
select pg_temp.finish_all() as finished \gset
select is((select count(*) from public.blooms where pass_id='afffffff-ffff-4fff-8fff-ffffffffff01'),0::bigint,'a stray nightly pass on a night that had its three publishes none');
select is((select count(*) from private.bloom_cycles),:cycles_then::bigint,'and opens no second cycle');
select is((select cycle_id from private.pass_inputs where pass_id='afffffff-ffff-4fff-8fff-ffffffffff01'),(select id from private.bloom_cycles order by started_at desc limit 1),'it is recorded against the night it joined');
-- With no cycle near it, it opens one, and a real night within twenty hours is refused.
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('afffffff-ffff-4fff-8fff-ffffffffff02','a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01']::uuid[],'nightly');
update public.garden_passes set created_at='2027-04-01 12:00:00+00' where id='afffffff-ffff-4fff-8fff-ffffffffff02';
select pg_temp.finish_all() as finished \gset
select is((select count(*) from public.blooms where pass_id='afffffff-ffff-4fff-8fff-ffffffffff02'),3::bigint,'a stray nightly pass on an untended night publishes its three');
select is((select count(*) from private.bloom_cycles),:cycles_then::bigint+1,'and opens that night''s cycle');
select pg_temp.write();
select is(pg_temp.tick('2027-04-02 09:30:00+00'),0,'so the scheduled night within twenty hours of it is not a second one');

-- A garden with two tended topics, tended at the real present moment (as the
-- schedule does): both scopes are enqueued in the one run and share one cycle.
-- The account's zone is chosen so that "now" is its 02:00 hour, whenever this runs.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a2222222-2222-4222-8222-222222222222','cycle-bob@example.test','{}','{}',now(),now());
update public.accounts set tend_overnight=true,
  timezone='Etc/GMT'||case when (extract(hour from now() at time zone 'UTC')::integer-2+24)%24<=12
      then '+'||((extract(hour from now() at time zone 'UTC')::integer-2+24)%24)
      else '-'||(24-(extract(hour from now() at time zone 'UTC')::integer-2+24)%24) end
  where id='a2222222-2222-4222-8222-222222222222';
select ok(private.is_tending_hour(now(),(select timezone from public.accounts where id='a2222222-2222-4222-8222-222222222222')),'it is the tending hour now in the second account''s zone');
insert into public.gardens(id,tenant_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','a2222222-2222-4222-8222-222222222222','Two-topic garden');
insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) select ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb1'||n)::uuid,'a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','Topic '||n,true from generate_series(1,2) n;
insert into public.seeds(id,tenant_id,garden_id,plot_id,title) select ('accccccc-cccc-4ccc-8ccc-cccccccccc1'||n)::uuid,'a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb1'||n)::uuid,'Thought '||n from generate_series(1,2) n;
insert into public.entries(id,tenant_id,garden_id,seed_id) select ('addddddd-dddd-4ddd-8ddd-dddddddddd1'||n)::uuid,'a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',('accccccc-cccc-4ccc-8ccc-cccccccccc1'||n)::uuid from generate_series(1,2) n;
insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  select gen_random_uuid(),'a2222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',('accccccc-cccc-4ccc-8ccc-cccccccccc1'||n)::uuid,('addddddd-dddd-4ddd-8ddd-dddddddddd1'||n)::uuid,1,'Synthetic cycle source for topic '||n||'.','a2222222-2222-4222-8222-222222222222' from generate_series(1,2) n;
insert into private.ai_tenants(tenant_id) values('a2222222-2222-4222-8222-222222222222');
select is(private.enqueue_nightly_for('a2222222-2222-4222-8222-222222222222',now()),2,'both scopes of the garden are enqueued in the one run, at the present moment');
select is((select count(distinct i.cycle_id) from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02' and i.cycle_id is not null),1::bigint,'and share one cycle');
select is((select sum(i.bloom_allowance)::integer from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'),3,'whose three blooms they share');
select is(private.enqueue_nightly_for('a2222222-2222-4222-8222-222222222222',now()),0,'a second run in the same hour adds nothing');

-- The cycle and the counter do not depend on the date label.
select ok((select count(*) from private.bloom_cycles c where not exists(select 1 from private.bloom_cycles d where d.garden_id=c.garden_id and d.id<>c.id and abs(extract(epoch from d.started_at-c.started_at))<20*3600))=(select count(*) from private.bloom_cycles),'no two cycles of a garden start within twenty hours of each other');

-- A skip note goes with its garden.
insert into private.nightly_skips(tenant_id,garden_id,cycle_date,reason,topics) values('a1111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','2027-04-02','scope_over_20_topics',21);
delete from public.garden_passes where tenant_id='a1111111-1111-4111-8111-111111111111';
delete from public.seeds where tenant_id='a1111111-1111-4111-8111-111111111111';
delete from public.plots where tenant_id='a1111111-1111-4111-8111-111111111111';
delete from public.gardens where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
select is((select count(*) from private.nightly_skips where garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),0::bigint,'a deleted garden leaves no skip note');
select is((select count(*) from private.bloom_cycles where garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),0::bigint,'and no cycle');

-- The nightly procedure inside a transaction: Postgres's own refusal, before any work,
-- with the gates closed or open.
select throws_ok($$call private.run_nightly_enqueue()$$,'2D000','invalid transaction termination','the nightly procedure cannot run inside a transaction');
update private.ai_runtime set enabled=false;
select throws_ok($$call private.run_nightly_enqueue()$$,'2D000','invalid transaction termination','with the gates closed too');
select * from finish();
rollback;

-- Tending follow-ups (20261116061751): three blooms per garden per nightly cycle,
-- oversized scopes, and the committing procedure called inside a transaction.
-- Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('91111111-1111-4111-8111-111111111111','cap-alice@example.test','{}','{}',now(),now()),
 ('92222222-2222-4222-8222-222222222222','cap-bob@example.test','{}','{}',now(),now()),
 ('93333333-3333-4333-8333-333333333333','cap-carol@example.test','{}','{}',now(),now());

-- Alice: garden 1 has three tended topics, garden 2 has two, garden 3 has one.
-- Topic n has one thought; topic 4 has two entries, every other topic one.
set local role authenticated;
select set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) select ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||n)::uuid,'Cap garden '||n from generate_series(1,3) n;
insert into public.plots(id,garden_id,name,ai_enabled)
  select ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||case when n<=3 then 1 when n<=5 then 2 else 3 end)::uuid,'Cap topic '||n,true from generate_series(1,6) n;
insert into public.seeds(id,garden_id,plot_id,title)
  select ('9ccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'||case when n<=3 then 1 when n<=5 then 2 else 3 end)::uuid,('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,'Cap thought '||n from generate_series(1,6) n;
select public.save_entry(('9ccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,('9ddddddd-dddd-4ddd-8ddd-ddddddddddd'||n)::uuid,('9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee'||n)::uuid,'Synthetic cap source '||n||'.') from generate_series(1,6) n;
select public.save_entry('9ccccccc-cccc-4ccc-8ccc-ccccccccccc4','9ddddddd-dddd-4ddd-8ddd-ddddddddddd7','9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee7','Synthetic cap source seven.');
update public.accounts set tend_overnight=true where id='91111111-1111-4111-8111-111111111111';
reset role;
insert into private.ai_tenants(tenant_id) values('91111111-1111-4111-8111-111111111111');
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-test',input_cents_per_million=200,output_cents_per_million=1000;

-- The committing procedure refuses to run inside a transaction, before doing anything.
select throws_ok($$call private.run_nightly_enqueue()$$,'25001','run_nightly_enqueue commits after each account and must be called on its own, not inside a transaction','the nightly procedure refuses to run inside a transaction');
select is((select count(*) from public.garden_passes),0::bigint,'and leaves nothing behind');
update private.ai_runtime set enabled=false;
select throws_ok($$call private.run_nightly_enqueue()$$,'25001',null,'it refuses the same way with the gates closed');
update private.ai_runtime set enabled=true;

-- One night: six scopes, each garden's budget of three shared out when the passes are created.
select is(private.enqueue_nightly_passes('2026-11-20 02:30:00+00'),6,'six scopes are enqueued for the night');
select is((select count(distinct cycle_date) from private.pass_inputs),1::bigint,'every pass of the night carries one cycle date');
select is((select min(cycle_date) from private.pass_inputs),'2026-11-20'::date,'the cycle is the account''s local date of the night');
create function pg_temp.allowance(n integer) returns integer language sql as $$
  select i.bloom_allowance::integer from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.plot_ids=array[('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid];
$$;
select is(array[pg_temp.allowance(1),pg_temp.allowance(2),pg_temp.allowance(3)],array[1,1,1],'three topics in one garden: one bloom each');
select is(array[pg_temp.allowance(4),pg_temp.allowance(5)],array[2,1],'two topics in one garden: two for the topic with more new writing, one for the other');
select is(pg_temp.allowance(6),3,'one topic in a garden keeps all three');
select is((select sum(i.bloom_allowance)::integer from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id group by p.garden_id order by 1 desc limit 1),3,'no garden is allowed more than three');

-- The worker finishes every pass with three valid blooms.
create function pg_temp.three(job jsonb,kinds text[] default array['question','connection','tension']) returns jsonb language sql as $$
  select jsonb_build_object('blooms',(select jsonb_agg(jsonb_build_object('kind',k,'interpretation','A synthetic '||k||' '||o||'.',
    'evidence',jsonb_build_array(jsonb_build_object('revision_id',job#>>'{snapshot,0,revision_id}','excerpt','Synthetic cap source'))) order by o)
    from unnest(kinds) with ordinality t(k,o)),'no_output_reason',null);
$$;
create function pg_temp.finish_all() returns integer language plpgsql as $$
declare j jsonb; n integer:=0;
begin
  loop
    j:=public.claim_garden_pass();
    exit when j is null;
    -- A finished pass comes back once for cleanup; acknowledge it and carry on.
    if j->>'status' not in('queued','processing') then
      perform public.update_garden_job((j->>'id')::uuid,(j->>'token')::uuid,null,null,null,true,true);
      continue;
    end if;
    perform public.finish_garden_pass((j->>'id')::uuid,(j->>'token')::uuid,pg_temp.three(j),100,40,false);
    n:=n+1;
  end loop;
  return n;
end $$;
set local role service_role;
select is(pg_temp.finish_all(),6,'six passes finish, each offering three blooms');
reset role;
select is((select max(c) from (select count(*) c from public.blooms group by garden_id) x),3::bigint,'no garden publishes more than three blooms in one night');
select is((select count(*) from public.blooms where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),3::bigint,'three topics in one garden: three blooms, not nine');
select is((select count(*) from public.blooms where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),3::bigint,'two topics in one garden: three blooms, not six');
select is((select count(*) from public.blooms where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),3::bigint,'one topic: three blooms');
select is((select count(*) from public.garden_passes where status='complete'),6::bigint,'every pass still completes');
-- Which bloom is kept is a fixed rule, not the model's order: tension before connection before question.
select is((select array_agg(b.kind order by b.ordinal) from public.blooms b join public.garden_passes p on p.id=b.pass_id where p.plot_ids=array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid]),array['tension'],'with one allowed, the kept bloom is chosen by kind, not by position');
select is((select array_agg(b.kind order by b.ordinal) from public.blooms b join public.garden_passes p on p.id=b.pass_id where p.plot_ids=array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'::uuid]),array['tension','connection'],'with two allowed, the two highest-ranked kinds, renumbered from zero');
select is((select array_agg(b.kind order by b.ordinal) from public.blooms b join public.garden_passes p on p.id=b.pass_id where p.plot_ids=array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6'::uuid]),array['question','connection','tension'],'with nothing withheld the order is untouched');
-- What was withheld is recorded as counts only.
select is((select i.blooms_withheld from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.plot_ids=array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid]),2,'the pass records two withheld');
select is((select published||'/'||withheld from private.bloom_cycles where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'3/6','the garden''s cycle records three published and six withheld');
select is((select published||'/'||withheld from private.bloom_cycles where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),'3/0','and nothing withheld where nothing was');
select ok(not has_table_privilege('authenticated','private.bloom_cycles','select') and not has_table_privilege('anon','private.bloom_cycles','select')
  and not has_table_privilege('authenticated','private.nightly_skips','select'),'the cycle and skip ledgers are closed to API roles');

-- The garden's counter is the backstop: a nightly pass with no allowance recorded
-- (created by an operator) in the same cycle publishes nothing more.
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('9fffffff-ffff-4fff-8fff-fffffffffff1','91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[],'nightly');
update private.pass_inputs set cycle_date='2026-11-20',next_attempt_at=now()-interval '1 hour' where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff1';
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id<>'9fffffff-ffff-4fff-8fff-fffffffffff1';
set local role service_role;
select public.claim_garden_pass() as extra \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'extra'::jsonb->>'id',:'extra'::jsonb->>'token',pg_temp.three(:'extra'::jsonb)),'a fourth nightly pass for a garden that has had its three still completes');
reset role;
select is((select count(*) from public.blooms where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff1'),0::bigint,'and publishes nothing');
select is((select no_output_reason from public.garden_passes where id='9fffffff-ffff-4fff-8fff-fffffffffff1'),'No new reflection this time. Your thoughts can rest.','with the quiet no-return message');
select is((select count(*) from public.blooms where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),3::bigint,'the garden still shows three');

-- Ties inside one kind: more distinct cited revisions first, then the earlier position.
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('9fffffff-ffff-4fff-8fff-fffffffffff2','91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4']::uuid[],'nightly');
update private.pass_inputs set cycle_date='2026-11-21',bloom_allowance=2,next_attempt_at=now()-interval '2 hours' where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff2';
set local role service_role;
select public.claim_garden_pass() as tie \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'tie'::jsonb->>'id',:'tie'::jsonb->>'token',
  '{"blooms":[{"kind":"connection","interpretation":"First, one source.","evidence":[{"revision_id":"9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","excerpt":"Synthetic cap source 4"}]},
    {"kind":"connection","interpretation":"Second, one source.","evidence":[{"revision_id":"9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee7","excerpt":"seven"}]},
    {"kind":"connection","interpretation":"Third, two sources.","evidence":[{"revision_id":"9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","excerpt":"Synthetic"},{"revision_id":"9eeeeeee-eeee-4eee-8eee-eeeeeeeeeee7","excerpt":"Synthetic"}]}],"no_output_reason":null}'),'three blooms of one kind, two allowed');
reset role;
select is((select array_agg(interpretation order by ordinal) from public.blooms where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff2'),array['Third, two sources.','First, one source.'],'the bloom citing more revisions comes first, then the earlier of the rest');

-- An invited pass is its own cycle: up to three, whatever the night published.
set local role authenticated;
select set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
insert into public.garden_passes(id,garden_id,plot_ids) values('9fffffff-ffff-4fff-8fff-fffffffffff3','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3']::uuid[]);
reset role;
update private.pass_inputs set next_attempt_at=now()-interval '3 hours' where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff3';
set local role service_role;
select public.claim_garden_pass() as invited \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'invited'::jsonb->>'id',:'invited'::jsonb->>'token',pg_temp.three(:'invited'::jsonb)),'an invited pass finishes');
reset role;
select is((select count(*) from public.blooms where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff3'),3::bigint,'and publishes up to three of its own');
select is((select bloom_allowance from private.pass_inputs where pass_id='9fffffff-ffff-4fff-8fff-fffffffffff3'),null,'it carries no nightly allowance');
select is((select published from private.bloom_cycles where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and cycle_date='2026-11-20'),3,'and does not draw on the night''s budget');
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,1,1,false)','9fffffff-ffff-4fff-8fff-fffffffffff3',gen_random_uuid(),'{"blooms":[]}'),'P0001','lease lost','the lease check is still in force');

-- A scope with more than twenty cross-pollinating topics is skipped with a note;
-- the rest of that account, and later accounts, are still tended.
set local role authenticated;
select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
insert into public.gardens(id,name) values('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1','Wide garden'),('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2','Narrow garden');
insert into public.plots(id,garden_id,name,ai_enabled,cross_pollinate) select gen_random_uuid(),'9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1','Wide topic '||n,true,true from generate_series(1,21) n;
insert into public.plots(id,garden_id,name,ai_enabled) values('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2','Narrow topic',true);
insert into public.seeds(id,garden_id,plot_id,title) select gen_random_uuid(),garden_id,id,'Wide thought' from public.plots where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1' limit 1;
insert into public.seeds(id,garden_id,plot_id,title) values('9ccccccc-cccc-4ccc-8ccc-cccccccccdd1','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1','Narrow thought');
select public.save_entry(id,gen_random_uuid(),gen_random_uuid(),'Synthetic wide source.') from public.seeds where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1';
select public.save_entry('9ccccccc-cccc-4ccc-8ccc-cccccccccdd1',gen_random_uuid(),gen_random_uuid(),'Synthetic narrow source.');
update public.accounts set tend_overnight=true where id='92222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claim.sub','93333333-3333-4333-8333-333333333333',true);
insert into public.gardens(id,name) values('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1','Later garden');
insert into public.plots(id,garden_id,name,ai_enabled) values('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbd1','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1','Later topic',true);
insert into public.seeds(id,garden_id,plot_id,title) values('9ccccccc-cccc-4ccc-8ccc-ccccccccccd1','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbd1','Later thought');
select public.save_entry('9ccccccc-cccc-4ccc-8ccc-ccccccccccd1',gen_random_uuid(),gen_random_uuid(),'Synthetic later source.');
update public.accounts set tend_overnight=true where id='93333333-3333-4333-8333-333333333333';
reset role;
insert into private.ai_tenants(tenant_id) values('92222222-2222-4222-8222-222222222222'),('93333333-3333-4333-8333-333333333333');
update public.accounts set tend_overnight=false where id='91111111-1111-4111-8111-111111111111';
select lives_ok($$select private.enqueue_nightly_passes('2026-11-22 02:30:00+00')$$,'a scope of twenty-one topics does not stop the night');
select is((select count(*) from public.garden_passes where tenant_id='92222222-2222-4222-8222-222222222222' and trigger='nightly'),1::bigint,'the same account''s other garden is still tended');
select is((select count(*) from public.garden_passes where tenant_id='93333333-3333-4333-8333-333333333333' and trigger='nightly'),1::bigint,'and so is the next account');
select is((select reason||':'||topics from private.nightly_skips where tenant_id='92222222-2222-4222-8222-222222222222'),'scope_over_20_topics:21','the skipped scope is noted with a reason and a count, nothing else');
select is((select count(*) from private.nightly_skips where cycle_date='2026-11-22' and garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1'),1::bigint,'against its garden and night');
select * from finish();
rollback;

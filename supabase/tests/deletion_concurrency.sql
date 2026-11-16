-- In-app deletion under concurrency (D-024). Synthetic data only.
-- Two real sessions are needed, so fixtures are committed through dblink and
-- removed again at the end (and at the start, in case an earlier run stopped
-- midway). Local stack only; never run against a hosted project.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.hits(needle text) returns bigint language plpgsql as $$
declare t record; n bigint; total bigint:=0;
begin
  for t in select schemaname,tablename from pg_catalog.pg_tables where schemaname in('public','private') loop
    execute format('select count(*) from %I.%I x where position(%L in x::text)>0',t.schemaname,t.tablename,needle) into n;
    total:=total+n;
  end loop;
  return total;
end $$;
create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$
    delete from auth.users where id='77777777-7777-4777-8777-777777777777';
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_runtime set enabled=false,model=null,approved_at=null,workflow_version='connect-v2-unapproved';
    update private.deployment_switches set deletion_enabled=false;
  $q$);
$$;

-- The server's own network address: loopback is trust-authenticated, which dblink refuses.
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('writer'),('eraser'),('worker')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('77777777-7777-4777-8777-777777777777','delete-race@example.test','{}','{}',now(),now());
  update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-unapproved';
  insert into private.ai_tenants(tenant_id) values('77777777-7777-4777-8777-777777777777');
  update private.deployment_switches set deletion_enabled=true;
  insert into public.gardens(id,tenant_id,name) values('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','77777777-7777-4777-8777-777777777777','Race garden');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) values('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race topic',true);
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values('7ccccccc-cccc-4ccc-8ccc-ccccccccccc1','77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Race thought');
  insert into public.entries(id,tenant_id,garden_id,seed_id) select e::uuid,'77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','7ccccccc-cccc-4ccc-8ccc-ccccccccccc1'
    from unnest(array['7ddddddd-dddd-4ddd-8ddd-ddddddddddd1','7ddddddd-dddd-4ddd-8ddd-ddddddddddd2','7ddddddd-dddd-4ddd-8ddd-ddddddddddd3']) e;
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) values
    ('7eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','7ccccccc-cccc-4ccc-8ccc-ccccccccccc1','7ddddddd-dddd-4ddd-8ddd-ddddddddddd1',1,'RACECANARY-ONE is erased while a pass is being prepared.','77777777-7777-4777-8777-777777777777'),
    ('7eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','7ccccccc-cccc-4ccc-8ccc-ccccccccccc1','7ddddddd-dddd-4ddd-8ddd-ddddddddddd2',2,'RACECANARY-TWO is erased just before a pass is prepared.','77777777-7777-4777-8777-777777777777'),
    ('7eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','77777777-7777-4777-8777-777777777777','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','7ccccccc-cccc-4ccc-8ccc-ccccccccccc1','7ddddddd-dddd-4ddd-8ddd-ddddddddddd3',3,'RACEKEEP stays in the garden.','77777777-7777-4777-8777-777777777777');
$q$);
-- Both sessions act as the same signed-in owner.
select dblink_exec(c,$q$set role authenticated; set "request.jwt.claims" to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}'; set lock_timeout to '20s'$q$) from (values('writer'),('eraser')) v(c);
select dblink_exec('worker',$q$set role service_role; set lock_timeout to '5s'$q$);

-- 1. A pass is being prepared (its transaction is still open) when the owner deletes an entry it froze.
select dblink_exec('writer','begin');
select dblink_exec('writer',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('7fffffff-ffff-4fff-8fff-fffffffffff1','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$q$);
select is(dblink_send_query('eraser',$q$select public.delete_entry('7ddddddd-dddd-4ddd-8ddd-ddddddddddd1')$q$),1,'the deletion is sent while the pass is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('eraser'),1,'the deletion waits for the pass being prepared');
select dblink_exec('writer','commit');
select is((select r->>'deleted' from dblink_get_result('eraser') as t(r jsonb)),'true','then deletes the entry');
select count(*) as drained from dblink_get_result('eraser') as t(r jsonb) \gset
select is((select status from public.garden_passes where id='7fffffff-ffff-4fff-8fff-fffffffffff1'),'cancelled','the pass that froze the entry is cancelled');
select is((select snapshot from private.pass_inputs where pass_id='7fffffff-ffff-4fff-8fff-fffffffffff1'),'[]'::jsonb,'and its frozen copy is emptied');
select is(pg_temp.hits('RACECANARY-ONE'),0::bigint,'no table keeps the text deleted during pass preparation');

-- 2. The owner is deleting an entry (transaction still open) when a pass is requested.
select dblink_exec('eraser','begin');
select is((select r->>'deleted' from dblink('eraser',$q$select public.delete_entry('7ddddddd-dddd-4ddd-8ddd-ddddddddddd2')$q$) as t(r jsonb)),'true','the second entry is deleted in an open transaction');
select is(dblink_send_query('writer',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('7fffffff-ffff-4fff-8fff-fffffffffff2','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$q$),1,'a pass is requested while the deletion is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'pass preparation waits for the deletion');
select dblink_exec('eraser','commit');
select is((select s from dblink_get_result('writer') as t(s text)),'INSERT 0 1','then the pass is prepared');
select count(*) as drained from dblink_get_result('writer') as t(s text) \gset
select is((select jsonb_array_length(snapshot) from private.pass_inputs where pass_id='7fffffff-ffff-4fff-8fff-fffffffffff2'),1,'its snapshot holds only the writing that remains');
select is(pg_temp.hits('RACECANARY-TWO'),0::bigint,'no table keeps the text deleted just before pass preparation');
select is(pg_temp.hits('RACEKEEP'),2::bigint,'the remaining entry is in its revision and the new snapshot');

-- 3. The worker holds a pass's input row (as finish_garden_pass does first) while the garden is deleted.
select dblink_exec('worker','begin');
select count(*) as held from dblink('worker',$q$select 1 from private.pass_inputs where pass_id='7fffffff-ffff-4fff-8fff-fffffffffff2' for update$q$) as t(x integer) \gset
select is(dblink_send_query('eraser',$q$select public.delete_garden('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race garden')$q$),1,'the garden deletion is sent while the worker holds the pass input');
select pg_sleep(1);
select is(dblink_is_busy('eraser'),1,'the garden deletion waits for the worker');
select lives_ok($t$select * from dblink('worker',$q$select 1 from public.garden_passes where id='7fffffff-ffff-4fff-8fff-fffffffffff2' for update$q$) as t(x integer)$t$,'the worker takes the pass row next without a deadlock');
select dblink_exec('worker','commit');
select is((select r->>'deleted' from dblink_get_result('eraser') as t(r jsonb)),'true','then the garden is deleted');
select count(*) as drained from dblink_get_result('eraser') as t(r jsonb) \gset
select is(pg_temp.hits('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),0::bigint,'nothing of the garden remains');
select is(pg_temp.hits('RACE'),0::bigint,'and none of its text');
select is((select coalesce(sum(reserved_cents),0) from private.ai_months),0::numeric,'no budget reservation is stranded');

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='77777777-7777-4777-8777-777777777777'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('writer'),('eraser'),('worker')) v(c);
select * from finish();
rollback;

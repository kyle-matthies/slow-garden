-- Allowlist removal racing pass creation. Two real sessions (dblink), committed
-- fixtures removed at the end. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$
    delete from auth.users where id='66666666-6666-4666-8666-666666666666';
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_runtime set enabled=false,model=null,approved_at=null,workflow_version='connect-v2-unapproved';
  $q$);
$$;
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('writer'),('operator')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('66666666-6666-4666-8666-666666666666','allow-race@example.test','{}','{}',now(),now());
  update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-unapproved';
  insert into private.ai_tenants(tenant_id) values('66666666-6666-4666-8666-666666666666');
  insert into public.gardens(id,tenant_id,name) values('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','66666666-6666-4666-8666-666666666666','Race garden');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) values
    ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race topic one',true),
    ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race topic two',true);
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values
    ('6ccccccc-cccc-4ccc-8ccc-ccccccccccc1','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Race thought one'),
    ('6ccccccc-cccc-4ccc-8ccc-ccccccccccc2','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Race thought two');
  insert into public.entries(id,tenant_id,garden_id,seed_id) values
    ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd1','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6ccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
    ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd2','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6ccccccc-cccc-4ccc-8ccc-ccccccccccc2');
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) values
    ('6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6ccccccc-cccc-4ccc-8ccc-ccccccccccc1','6ddddddd-dddd-4ddd-8ddd-ddddddddddd1',1,'Synthetic allowlist race source one.','66666666-6666-4666-8666-666666666666'),
    ('6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6ccccccc-cccc-4ccc-8ccc-ccccccccccc2','6ddddddd-dddd-4ddd-8ddd-ddddddddddd2',1,'Synthetic allowlist race source two.','66666666-6666-4666-8666-666666666666');
$q$);
select dblink_exec('writer',$q$set role authenticated; set "request.jwt.claims" to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}'; set lock_timeout to '20s'$q$);
select dblink_exec('operator',$q$set lock_timeout to '20s'$q$);

-- 1. A pass is being created (transaction open) when the operator removes the tenant.
select dblink_exec('writer','begin');
select dblink_exec('writer',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('6fffffff-ffff-4fff-8fff-fffffffffff1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$q$);
select is(dblink_send_query('operator',$q$delete from private.ai_tenants where tenant_id='66666666-6666-4666-8666-666666666666'$q$),1,'the removal is sent while the pass is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('operator'),1,'the removal waits for the pass being created');
select dblink_exec('writer','commit');
select is((select s from dblink_get_result('operator') as t(s text)),'DELETE 1','then removes the tenant');
select count(*) as drained from dblink_get_result('operator') as t(s text) \gset
select is((select status from public.garden_passes where id='6fffffff-ffff-4fff-8fff-fffffffffff1'),'cancelled','and cancels the pass that committed just before it: nothing is stranded');
select ok((select cleanup_pending from private.pass_inputs where pass_id='6fffffff-ffff-4fff-8fff-fffffffffff1'),'which is queued for cleanup');

-- 2. The operator is removing the tenant (transaction open) when a pass is requested.
select dblink_exec('setup',$q$insert into private.ai_tenants(tenant_id) values('66666666-6666-4666-8666-666666666666')$q$);
select dblink_exec('operator','begin');
select dblink_exec('operator',$q$delete from private.ai_tenants where tenant_id='66666666-6666-4666-8666-666666666666'$q$);
select is(dblink_send_query('writer',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('6fffffff-ffff-4fff-8fff-fffffffffff2','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$q$),1,'a pass is requested while the removal is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'pass creation waits for the removal');
select dblink_exec('operator','commit');
select count(*) as outcome from dblink_get_result('writer',false) as t(s text) \gset
select matches(dblink_error_message('writer')::text,'tending is not available for this account yet'::text,'then is refused');
select count(*) as drained from dblink_get_result('writer',false) as t(s text) \gset
select is((select count(*) from public.garden_passes where id='6fffffff-ffff-4fff-8fff-fffffffffff2'),0::bigint,'no pass exists for the removed tenant');
select is((select count(*) from public.garden_passes where tenant_id='66666666-6666-4666-8666-666666666666' and status in('queued','processing')),0::bigint,'and none is left active');
select is((select coalesce(sum(reserved_cents),0) from private.ai_months)-(select coalesce(sum(reserved_cents),0) from private.pass_inputs where actual_cents is null),0::numeric,'no reservation exists without a pass that owns it');

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='66666666-6666-4666-8666-666666666666'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('writer'),('operator')) v(c);
select * from finish();
rollback;

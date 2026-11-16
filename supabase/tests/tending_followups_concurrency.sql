-- Tending follow-ups under concurrency: real sessions (dblink), committed
-- fixtures removed at the end. Synthetic data only.
--   1. two nightly passes for one garden finishing at once never publish four blooms;
--   2. the worker takes a thought before the pass inputs (deleting a thought does too);
--   3. a person cancelling a pass takes the pass inputs before the pass row (the worker's claim does too);
--   4. deleting an account against allowlist removal no longer deadlocks.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$
    delete from auth.users where id='96666666-6666-4666-8666-666666666666';
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_months set reserved_cents=0,spent_cents=0 where not exists(select 1 from private.pass_inputs);
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_runtime set enabled=false,model=null,approved_at=null,workflow_version='connect-v2-unapproved';
    update private.deployment_switches set deletion_enabled=false;
  $q$);
$$;
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('w1'),('w2'),('person'),('holder'),('operator'),('probe')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('96666666-6666-4666-8666-666666666666','followup-race@example.test','{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values('96666666-6666-4666-8666-66666666aaaa','96666666-6666-4666-8666-666666666666',now(),now());
  update public.accounts set tend_overnight=true where id='96666666-6666-4666-8666-666666666666';
  update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-test';
  update private.deployment_switches set deletion_enabled=true;
  insert into private.ai_tenants(tenant_id) values('96666666-6666-4666-8666-666666666666');
  insert into public.gardens(id,tenant_id,name) values('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1','96666666-6666-4666-8666-666666666666','Race garden');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) select ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe'||n)::uuid,'96666666-6666-4666-8666-666666666666','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1','Race topic '||n,n<=2 from generate_series(1,4) n;
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) select ('9ccccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid,'96666666-6666-4666-8666-666666666666','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe'||n)::uuid,'Race thought '||n from generate_series(1,4) n;
  insert into public.entries(id,tenant_id,garden_id,seed_id) select ('9ddddddd-dddd-4ddd-8ddd-ddddddddddf'||n)::uuid,'96666666-6666-4666-8666-666666666666','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('9ccccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid from generate_series(1,4) n;
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
    select ('9eeeeeee-eeee-4eee-8eee-eeeeeeeeeef'||n)::uuid,'96666666-6666-4666-8666-666666666666','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('9ccccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid,('9ddddddd-dddd-4ddd-8ddd-ddddddddddf'||n)::uuid,1,'Synthetic race source '||n||'.','96666666-6666-4666-8666-666666666666' from generate_series(1,4) n;
$q$);
select dblink_exec(c,$q$set role service_role; set lock_timeout to '20s'$q$) from (values('w1'),('w2')) v(c);
select dblink_exec('person',$q$set role authenticated; set "request.jwt.claims" to '{"sub":"96666666-6666-4666-8666-666666666666","email":"followup-race@example.test","role":"authenticated","session_id":"96666666-6666-4666-8666-66666666aaaa"}'; set lock_timeout to '20s'$q$);
select dblink_exec(c,$q$set lock_timeout to '20s'$q$) from (values('holder'),('operator')) v(c);

create function pg_temp.three(job jsonb) returns jsonb language sql as $$
  select jsonb_build_object('blooms',(select jsonb_agg(jsonb_build_object('kind',k,'interpretation','A synthetic '||k||'.',
    'evidence',jsonb_build_array(jsonb_build_object('revision_id',job#>>'{snapshot,0,revision_id}','excerpt','Synthetic race source'))))
    from unnest(array['question','connection','tension']) k),'no_output_reason',null);
$$;
create function pg_temp.unlocked(tbl text,col text,id text) returns bigint language sql as $$
  select n from dblink('probe',format('select count(*) from (select 1 from %s where %I=%L for update skip locked) x',tbl,col,id)) as t(n bigint);
$$;

-- 1. One night, two tended topics in one garden. Their shares are overridden to
--    three each, so only the garden's counter stands between them and six.
select is((select n from dblink('setup',$q$select private.enqueue_nightly_passes(date_trunc('day',now())+interval '2 hours 30 minutes')$q$) as t(n integer)),2,'two nightly passes are enqueued for one garden');
select dblink_exec('setup',$q$update private.pass_inputs set bloom_allowance=3$q$);
select dblink_exec('w1','begin');
select j as job1 from dblink('w1','select public.claim_garden_pass()') as t(j jsonb) \gset
select is((select s from dblink('w1',format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)::text',:'job1'::jsonb->>'id',:'job1'::jsonb->>'token',pg_temp.three(:'job1'::jsonb))) as t(s text)),'','the first worker publishes, transaction still open');
select j as job2 from dblink('w2','select public.claim_garden_pass()') as t(j jsonb) \gset
select isnt(:'job2'::jsonb->>'id',:'job1'::jsonb->>'id','the second worker is handed the other pass');
select is(dblink_send_query('w2',format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)::text',:'job2'::jsonb->>'id',:'job2'::jsonb->>'token',pg_temp.three(:'job2'::jsonb))),1,'the second worker finishes at the same moment');
select pg_sleep(1);
select is(dblink_is_busy('w2'),1,'and waits for the garden''s cycle count');
select dblink_exec('w1','commit');
select is((select s from dblink_get_result('w2') as t(s text)),'','then finishes');
select count(*) as drained from dblink_get_result('w2') as t(s text) \gset
select is((select count(*) from public.blooms where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1'),3::bigint,'two passes finishing at once publish three blooms, not six');
select is((select count(*) from public.blooms where pass_id=(:'job2'::jsonb->>'id')::uuid),0::bigint,'the pass that came second publishes none');
select is((select blooms_withheld from private.pass_inputs where pass_id=(:'job2'::jsonb->>'id')::uuid),3,'and records three withheld');
select is((select published||'/'||withheld from private.bloom_cycles where garden_id='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1'),'3/3','the cycle shows three published, three withheld');
select is((select count(*) from public.garden_passes where status='complete' and tenant_id='96666666-6666-4666-8666-666666666666'),2::bigint,'both passes complete');
select dblink_exec('setup',$q$update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'$q$);

-- 2. The worker publishes a mark for a thought while that thought is held (as
--    delete_seed holds it): the worker waits for the thought first and has not
--    taken the pass inputs, so the two cannot hold what the other needs.
select dblink_exec('setup',$q$update private.ai_runtime set workflow_version='tend-connect-v3-test'; update public.plots set ai_enabled=true where id='9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe3'$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('9fffffff-ffff-4fff-8fff-ffffffffffe3','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe3']::uuid[])$q$);
select j as job3 from dblink('w1','select public.claim_garden_pass()') as t(j jsonb) \gset
select is(:'job3'::jsonb->>'id','9fffffff-ffff-4fff-8fff-ffffffffffe3','the worker claims the pass with marks to publish');
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from public.seeds where id='9ccccccc-cccc-4ccc-8ccc-cccccccccce3' for update$q$) as t(x integer) \gset
select is(dblink_send_query('w1',format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)::text',:'job3'::jsonb->>'id',:'job3'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"9ccccccc-cccc-4ccc-8ccc-cccccccccce3","kind":"theme","label":"race","evidence":[{"revision_id":"9eeeeeee-eeee-4eee-8eee-eeeeeeeeeef3","excerpt":"Synthetic race source"}]}],"no_output_reason":null}')),1,'the worker publishes a mark while the thought is held');
select pg_sleep(1);
select is(dblink_is_busy('w1'),1,'the worker waits for the thought');
select is(pg_temp.unlocked('private.pass_inputs','pass_id','9fffffff-ffff-4fff-8fff-ffffffffffe3'),1::bigint,'without holding the pass inputs the deletion would need next');
select dblink_exec('holder','commit');
select is((select s from dblink_get_result('w1') as t(s text)),'','then publishes');
select count(*) as drained from dblink_get_result('w1') as t(s text) \gset
select is((select count(*) from public.tending_marks where pass_id='9fffffff-ffff-4fff-8fff-ffffffffffe3'),1::bigint,'and the mark is stored');
select dblink_exec('setup',$q$update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'; update private.ai_runtime set workflow_version='connect-v2-test'; update public.plots set ai_enabled=true where id='9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe4'$q$);

-- 3. A person cancels a pass while its inputs are held (as the worker's claim
--    holds them first): the cancel waits for the inputs and has not taken the
--    pass row the claim would need next.
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('9fffffff-ffff-4fff-8fff-ffffffffffe4','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe4']::uuid[])$q$);
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from private.pass_inputs where pass_id='9fffffff-ffff-4fff-8fff-ffffffffffe4' for update$q$) as t(x integer) \gset
select is(dblink_send_query('person',$q$update public.garden_passes set status='cancelled' where id='9fffffff-ffff-4fff-8fff-ffffffffffe4'$q$),1,'the person cancels while the pass inputs are held');
select pg_sleep(1);
select is(dblink_is_busy('person'),1,'the cancel waits for the pass inputs');
select is(pg_temp.unlocked('public.garden_passes','id','9fffffff-ffff-4fff-8fff-ffffffffffe4'),1::bigint,'without holding the pass row the claim would need next');
select dblink_exec('holder','commit');
select is((select s from dblink_get_result('person') as t(s text)),'UPDATE 1','then cancels');
select count(*) as drained from dblink_get_result('person') as t(s text) \gset
select is((select status from public.garden_passes where id='9fffffff-ffff-4fff-8fff-ffffffffffe4'),'cancelled','and the pass is cancelled, not lost');

-- 4. Account deletion against allowlist removal, with a queued pass. Both are
--    made to wait on the pass inputs, the deletion first, then released
--    together: the interleaving that used to end in a deadlock (40P01).
select dblink_exec('setup',$q$update public.plots set ai_enabled=true where id='9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1'$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('9fffffff-ffff-4fff-8fff-ffffffffffe5','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1']::uuid[])$q$);
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from private.pass_inputs where pass_id='9fffffff-ffff-4fff-8fff-ffffffffffe5' for update$q$) as t(x integer) \gset
select is(dblink_send_query('person',$q$select public.delete_account('followup-race@example.test')->>'deleted'$q$),1,'the person deletes the account');
select pg_sleep(1);
select is(dblink_is_busy('person'),1,'the deletion waits for the pass inputs');
select is(dblink_send_query('operator',$q$delete from private.ai_tenants where tenant_id='96666666-6666-4666-8666-666666666666'$q$),1,'the operator removes the tenant at the same moment');
select pg_sleep(1);
select is(dblink_is_busy('operator'),1,'the removal waits too');
select dblink_exec('holder','commit');
select pg_sleep(2);
select count(*) as person_rows from dblink_get_result('person',false) as t(s text) where s='true' \gset
select is(:person_rows,1,'the account is deleted');
select is(dblink_error_message('person')::text,'OK','with no deadlock on the deletion');
select count(*) as drained from dblink_get_result('person',false) as t(s text) \gset
select count(*) as operator_rows from dblink_get_result('operator',false) as t(s text) where s='DELETE 0' \gset
select is(:operator_rows,1,'the removal finds the row already gone');
select is(dblink_error_message('operator')::text,'OK','with no deadlock on the removal');
select count(*) as drained from dblink_get_result('operator',false) as t(s text) \gset
select is((select count(*) from public.accounts where id='96666666-6666-4666-8666-666666666666'),0::bigint,'nothing of the account remains');
select is((select count(*) from public.garden_passes where tenant_id='96666666-6666-4666-8666-666666666666'),0::bigint,'nor any pass');
select is((select coalesce(sum(reserved_cents),0) from private.ai_months),0::numeric,'and no reservation is stranded');

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='96666666-6666-4666-8666-666666666666'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('w1'),('w2'),('person'),('holder'),('operator'),('probe')) v(c);
select * from finish();
rollback;

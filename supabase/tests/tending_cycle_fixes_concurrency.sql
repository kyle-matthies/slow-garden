-- Lock-order fixes (20261116080454) under real sessions (dblink). Committed
-- fixtures are removed at the end. Synthetic data only.
--   1. archiving a thought against switching a topic's tending off, two active passes: no deadlock;
--   2. a save, and an import, never wait on the worker's ingestion (measured);
--   2b. a deletion against a person cancelling every pass: no deadlock;
--   2c. a save into a topic never waits on a topic change queued behind the worker (measured);
--   3. archiving a thought waits for a deletion at the account's row, before it holds the thought.
-- Every session that must not wait has lock_timeout set, so a regression fails instead of hanging.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$
    delete from auth.users where id='a6666666-6666-4666-8666-666666666666';
    update private.ai_months set reserved_cents=0,spent_cents=0 where not exists(select 1 from private.pass_inputs);
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_runtime set enabled=false,model=null,approved_at=null,workflow_version='connect-v2-unapproved';
    update private.deployment_switches set deletion_enabled=false;
  $q$);
$$;
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('worker'),('person'),('person2'),('holder'),('probe')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('a6666666-6666-4666-8666-666666666666','cycle-race@example.test','{}','{}',now(),now());
  update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';
  update private.deployment_switches set deletion_enabled=true;
  insert into private.ai_tenants(tenant_id) values('a6666666-6666-4666-8666-666666666666');
  insert into public.gardens(id,tenant_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1','a6666666-6666-4666-8666-666666666666','Race garden');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) select ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe'||n)::uuid,'a6666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1','Race topic '||n,true from generate_series(1,2) n;
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) select ('accccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid,'a6666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe'||least(n,2))::uuid,'Race thought '||n from generate_series(1,3) n;
  insert into public.entries(id,tenant_id,garden_id,seed_id) select ('addddddd-dddd-4ddd-8ddd-ddddddddddf'||n)::uuid,'a6666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('accccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid from generate_series(1,3) n;
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
    select ('aeeeeeee-eeee-4eee-8eee-eeeeeeeeeef'||n)::uuid,'a6666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',('accccccc-cccc-4ccc-8ccc-cccccccccce'||n)::uuid,('addddddd-dddd-4ddd-8ddd-ddddddddddf'||n)::uuid,1,'Synthetic race source '||n||'.','a6666666-6666-4666-8666-666666666666' from generate_series(1,3) n;
$q$);
select dblink_exec('worker',$q$set role service_role; set lock_timeout to '20s'$q$);
select dblink_exec(c,$q$set role authenticated; set "request.jwt.claims" to '{"sub":"a6666666-6666-4666-8666-666666666666","role":"authenticated"}'; set lock_timeout to '20s'$q$) from (values('person'),('person2')) v(c);
select dblink_exec('holder',$q$set lock_timeout to '20s'$q$);
create function pg_temp.unlocked(tbl text,col text,id text) returns bigint language sql as $$
  select n from dblink('probe',format('select count(*) from (select 1 from %s where %I=%L for update skip locked) x',tbl,col,id)) as t(n bigint);
$$;
-- Thoughts 1 is in topic 1; thoughts 2 and 3 are in topic 2. One active pass per topic.
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1']::uuid[])$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2']::uuid[])$q$);

-- 1. Topic 1's tending is switched off while a thought in topic 2 is archived,
--    with the inputs of topic 2's pass held so that both are in flight at once.
--    They used to take each other's pass inputs and deadlock. Now each takes the
--    account's row first, so the second simply queues behind the first.
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from private.pass_inputs where pass_id='afffffff-ffff-4fff-8fff-ffffffffffe2' for update$q$) as t(x integer) \gset
select is(dblink_send_query('person2',$q$update public.seeds set status='archived',archived_at=now() where id='accccccc-cccc-4ccc-8ccc-cccccccccce2'$q$),1,'a thought in topic 2 is archived while its pass''s inputs are held');
select pg_sleep(0.5);
select is(dblink_is_busy('person2'),1,'the archive waits for its own pass''s inputs');
select is(dblink_send_query('person',$q$update public.plots set ai_enabled=false where id='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1'$q$),1,'topic 1''s tending is switched off at the same moment');
select pg_sleep(0.5);
select is(dblink_is_busy('person'),1,'the topic change queues behind the archive');
select is(pg_temp.unlocked('public.plots','id','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1')+pg_temp.unlocked('private.pass_inputs','pass_id','afffffff-ffff-4fff-8fff-ffffffffffe1'),2::bigint,'holding neither the topic nor any pass input while it waits');
select dblink_exec('holder','commit');
select pg_sleep(1.5);
select count(*) as archive_rows from dblink_get_result('person2',false) as t(s text) where s='UPDATE 1' \gset
select is(:archive_rows,1,'the archive completes');
select is(dblink_error_message('person2')::text,'OK','with no deadlock');
select count(*) as drained from dblink_get_result('person2',false) as t(s text) \gset
select count(*) as toggle_rows from dblink_get_result('person',false) as t(s text) where s='UPDATE 1' \gset
select is(:toggle_rows,1,'then the topic change completes');
select is(dblink_error_message('person')::text,'OK','with no deadlock either');
select count(*) as drained from dblink_get_result('person',false) as t(s text) \gset
select is((select array_agg(status order by id) from public.garden_passes where tenant_id='a6666666-6666-4666-8666-666666666666'),array['cancelled','cancelled'],'both passes are cancelled, each by its own change');
select dblink_exec('setup',$q$update public.seeds set status='active',archived_at=null where id='accccccc-cccc-4ccc-8ccc-cccccccccce2'; update public.plots set ai_enabled=true where id='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1'; update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'$q$);

-- 2. The worker is publishing a mark for thought 3 and is queued behind a holder
--    of the pass inputs; it already holds its lock on the thought. A save to that
--    thought, and an import into it, must go straight through.
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2']::uuid[])$q$);
select j as job from dblink('worker','select public.claim_garden_pass()') as t(j jsonb) \gset
select is(:'job'::jsonb->>'id','afffffff-ffff-4fff-8fff-ffffffffffe3','the worker claims the pass');
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from private.pass_inputs where pass_id='afffffff-ffff-4fff-8fff-ffffffffffe3' for update$q$) as t(x integer) \gset
select is(dblink_send_query('worker',format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)::text',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"accccccc-cccc-4ccc-8ccc-cccccccccce3","kind":"theme","label":"race","evidence":[{"revision_id":"aeeeeeee-eeee-4eee-8eee-eeeeeeeeeef3","excerpt":"Synthetic race source"}]}],"no_output_reason":null}')),1,'the worker starts publishing a mark for thought 3');
select pg_sleep(0.5);
select is(dblink_is_busy('worker'),1,'and is queued behind the pass inputs, holding its lock on the thought');
select is(pg_temp.unlocked('public.seeds','id','accccccc-cccc-4ccc-8ccc-cccccccccce3'),0::bigint,'(the thought is key-share locked by the worker)');
select dblink_exec('person',$q$set lock_timeout to '300ms'$q$);
select clock_timestamp() as t0 \gset
select is((select s from dblink('person',$q$select public.save_entry('accccccc-cccc-4ccc-8ccc-cccccccccce3','addddddd-dddd-4ddd-8ddd-ddddddddddf9','aeeeeeee-eeee-4eee-8eee-eeeeeeeeeef9','Synthetic save under a held ingestion.')::text$q$) as t(s text)),'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeef9','a save to that thought completes while the worker is still queued');
select round(extract(epoch from clock_timestamp()-:'t0'::timestamptz)*1000) as save_ms \gset
select ok(:save_ms<300,'in under 300 ms (measured: '||:save_ms||' ms)');
select clock_timestamp() as t1 \gset
select is((select s from dblink('person',$q$select public.import_thought('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2','accccccc-cccc-4ccc-8ccc-cccccccccce3','Race thought 3','[{"entry_id":"addddddd-dddd-4ddd-8ddd-ddddddddddfa","revision_id":"aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefa","body":"Synthetic import under a held ingestion."}]'::jsonb)->>'created'$q$) as t(s text)),'1','an import into that thought completes too');
select round(extract(epoch from clock_timestamp()-:'t1'::timestamptz)*1000) as import_ms \gset
select ok(:import_ms<300,'in under 300 ms (measured: '||:import_ms||' ms)');
select diag('save under a held ingestion: '||:save_ms||' ms; import: '||:import_ms||' ms (bound 300 ms)');
select is(dblink_is_busy('worker'),1,'the worker is still waiting: the save did not wait for it');
select dblink_exec('person',$q$set lock_timeout to '20s'$q$);
select dblink_exec('holder','commit');
select is((select s from dblink_get_result('worker') as t(s text)),'','then the worker publishes');
select count(*) as drained from dblink_get_result('worker') as t(s text) \gset
select is((select count(*) from public.tending_marks where pass_id='afffffff-ffff-4fff-8fff-ffffffffffe3'),1::bigint,'and its mark is stored');
-- Two saves to one thought still take turns.
select dblink_exec('person','begin');
select count(*) as n from dblink('person',$q$select public.save_entry('accccccc-cccc-4ccc-8ccc-cccccccccce3','addddddd-dddd-4ddd-8ddd-ddddddddddfb','aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefb','Synthetic first of two saves.')::text$q$) as t(s text) \gset
select is(dblink_send_query('person2',$q$select public.save_entry('accccccc-cccc-4ccc-8ccc-cccccccccce3','addddddd-dddd-4ddd-8ddd-ddddddddddfc','aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefc','Synthetic second of two saves.')::text$q$),1,'a second save to the same thought is sent');
select pg_sleep(0.5);
select is(dblink_is_busy('person2'),1,'and waits for the first, as before');
select dblink_exec('person','commit');
select is((select s from dblink_get_result('person2') as t(s text)),'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefc','then saves');
select count(*) as drained from dblink_get_result('person2') as t(s text) \gset
select is((select count(distinct revision_number) from public.seed_revisions where seed_id='accccccc-cccc-4ccc-8ccc-cccccccccce3'),(select count(*) from public.seed_revisions where seed_id='accccccc-cccc-4ccc-8ccc-cccccccccce3'),'revision numbers are still unique');

-- 2b. A deletion against a person cancelling every pass. Two active passes; the
--     deletion's pass row is held for a moment, so the deletion is stopped after it
--     has taken its pass inputs. It must already hold every pass input it will
--     touch (it used to take only some, reach for the rest later, and deadlock
--     with a cancel that had taken them in between).
select dblink_exec('setup',$q$update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1']::uuid[])$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2']::uuid[])$q$);
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from public.garden_passes where id='afffffff-ffff-4fff-8fff-ffffffffffe5' for update$q$) as t(x integer) \gset
select is(dblink_send_query('person',$q$select public.delete_entry('addddddd-dddd-4ddd-8ddd-ddddddddddfa')->>'deleted'$q$),1,'an entry that topic 2''s pass froze is deleted');
select pg_sleep(0.5);
select is(dblink_is_busy('person'),1,'the deletion is stopped at the pass row, after taking pass inputs');
select is(pg_temp.unlocked('private.pass_inputs','pass_id','afffffff-ffff-4fff-8fff-ffffffffffe4'),0::bigint,'it already holds the inputs of the other pass, which it will touch later');
select is(dblink_send_query('person2',$q$update public.garden_passes set status='cancelled' where status in('queued','processing')$q$),1,'the person cancels every pass at the same moment');
select pg_sleep(0.5);
select dblink_exec('holder','commit');
select pg_sleep(1.5);
select count(*) as deleted_rows from dblink_get_result('person',false) as t(s text) where s='true' \gset
select is(:deleted_rows,1,'the deletion completes');
select is(dblink_error_message('person')::text,'OK','with no deadlock');
select count(*) as drained from dblink_get_result('person',false) as t(s text) \gset
select count(*) as cancel_rows from dblink_get_result('person2',false) as t(s text) where s like 'UPDATE %' \gset
select is(:cancel_rows,1,'the cancel completes');
select is(dblink_error_message('person2')::text,'OK','with no deadlock either');
select count(*) as drained from dblink_get_result('person2',false) as t(s text) \gset
select is((select count(*) from public.garden_passes where tenant_id='a6666666-6666-4666-8666-666666666666' and status in('queued','processing')),0::bigint,'no pass is left active');

-- 2c. The worker's ingestion is uncommitted (it holds the pass inputs) and a
--     person's change to that topic's tending is queued behind it. The queued
--     change must not yet hold the topic, so a save and an import into the topic
--     go straight through.
select dblink_exec('setup',$q$update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'$q$);
select dblink_exec('person',$q$insert into public.garden_passes(id,garden_id,plot_ids) values('afffffff-ffff-4fff-8fff-ffffffffffe6','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1',array['abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2']::uuid[])$q$);
select j as job6 from dblink('worker','select public.claim_garden_pass()') as t(j jsonb) \gset
select is(:'job6'::jsonb->>'id','afffffff-ffff-4fff-8fff-ffffffffffe6','the worker claims a pass on topic 2');
select dblink_exec('worker','begin');
select is((select s from dblink('worker',format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)::text',:'job6'::jsonb->>'id',:'job6'::jsonb->>'token','{"blooms":[],"marks":[],"no_output_reason":null}')) as t(s text)),'','the worker''s ingestion has run, transaction still open');
select is(dblink_send_query('person2',$q$update public.plots set ai_enabled=false where id='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2'$q$),1,'the person switches topic 2''s tending off');
select pg_sleep(0.5);
select is(dblink_is_busy('person2'),1,'the change is queued behind the worker');
select is(pg_temp.unlocked('public.plots','id','abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2'),1::bigint,'and does not hold the topic while it waits');
select dblink_exec('person',$q$set lock_timeout to '300ms'$q$);
select clock_timestamp() as t2 \gset
select is((select s from dblink('person',$q$select public.save_entry('accccccc-cccc-4ccc-8ccc-cccccccccce3','addddddd-dddd-4ddd-8ddd-ddddddddddfd','aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefd','Synthetic save behind a queued topic change.')::text$q$) as t(s text)),'aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefd','a save into that topic completes');
select round(extract(epoch from clock_timestamp()-:'t2'::timestamptz)*1000) as save2_ms \gset
select ok(:save2_ms<300,'in under 300 ms (measured: '||:save2_ms||' ms)');
select clock_timestamp() as t3 \gset
select is((select s from dblink('person',$q$select public.import_thought('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2','accccccc-cccc-4ccc-8ccc-cccccccccce3','Race thought 3','[{"entry_id":"addddddd-dddd-4ddd-8ddd-ddddddddddfe","revision_id":"aeeeeeee-eeee-4eee-8eee-eeeeeeeeeefe","body":"Synthetic import behind a queued topic change."}]'::jsonb)->>'created'$q$) as t(s text)),'1','an import into that topic completes');
select round(extract(epoch from clock_timestamp()-:'t3'::timestamptz)*1000) as import2_ms \gset
select ok(:import2_ms<300,'in under 300 ms (measured: '||:import2_ms||' ms)');
select diag('save behind a held ingestion and a queued topic change: '||:save2_ms||' ms; import: '||:import2_ms||' ms (bound 300 ms)');
select dblink_exec('person',$q$set lock_timeout to '20s'$q$);
select dblink_exec('worker','commit');
select is((select s from dblink_get_result('person2') as t(s text)),'UPDATE 1','then the topic change completes');
select count(*) as drained from dblink_get_result('person2') as t(s text) \gset
select is((select status from public.garden_passes where id='afffffff-ffff-4fff-8fff-ffffffffffe6'),'withdrawn','and withdraws the pass that had just completed');
select dblink_exec('setup',$q$update public.plots set ai_enabled=true where id='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe2'; update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour'$q$);

-- 3. An entry is being deleted (transaction open) when a thought is archived:
--    the archive waits at the account's row, the first lock of every deletion,
--    and has not yet taken the thought.
select dblink_exec('person','begin');
select is((select s from dblink('person',$q$select public.delete_entry('addddddd-dddd-4ddd-8ddd-ddddddddddf1')->>'deleted'$q$) as t(s text)),'true','an entry is deleted, transaction still open');
select is(dblink_send_query('person2',$q$update public.seeds set status='archived',archived_at=now() where id='accccccc-cccc-4ccc-8ccc-cccccccccce2'$q$),1,'a thought is archived at the same moment');
select pg_sleep(0.5);
select is(dblink_is_busy('person2'),1,'the archive waits for the deletion');
select is(pg_temp.unlocked('public.seeds','id','accccccc-cccc-4ccc-8ccc-cccccccccce2'),1::bigint,'without holding the thought: it is waiting at the account''s row');
select dblink_exec('person','commit');
select is((select s from dblink_get_result('person2') as t(s text)),'UPDATE 1','then archives');
select count(*) as drained from dblink_get_result('person2') as t(s text) \gset
-- The same for restoring, and for archiving an entry.
select dblink_exec('person','begin');
select is((select s from dblink('person',$q$select public.delete_seed('accccccc-cccc-4ccc-8ccc-cccccccccce1')->>'deleted'$q$) as t(s text)),'true','a thought is deleted, transaction still open');
select is(dblink_send_query('person2',$q$update public.seeds set status='active',archived_at=null where id='accccccc-cccc-4ccc-8ccc-cccccccccce2'$q$),1,'another thought is restored at the same moment');
select pg_sleep(0.5);
select is(dblink_is_busy('person2')+pg_temp.unlocked('public.seeds','id','accccccc-cccc-4ccc-8ccc-cccccccccce2'),2::bigint,'the restore waits at the account''s row too');
select dblink_exec('person','commit');
select is((select s from dblink_get_result('person2') as t(s text)),'UPDATE 1','then restores');
select count(*) as drained from dblink_get_result('person2') as t(s text) \gset
select dblink_exec('person','begin');
select is((select s from dblink('person',$q$select public.delete_entry('addddddd-dddd-4ddd-8ddd-ddddddddddf9')->>'deleted'$q$) as t(s text)),'true','an entry is deleted, transaction still open');
select is(dblink_send_query('person2',$q$update public.entries set archived_at=now() where id='addddddd-dddd-4ddd-8ddd-ddddddddddf2'$q$),1,'another entry is archived at the same moment');
select pg_sleep(0.5);
select is(dblink_is_busy('person2')+pg_temp.unlocked('public.entries','id','addddddd-dddd-4ddd-8ddd-ddddddddddf2'),2::bigint,'archiving an entry waits at the account''s row');
select dblink_exec('person','commit');
select is((select s from dblink_get_result('person2') as t(s text)),'UPDATE 1','then archives');
select count(*) as drained from dblink_get_result('person2') as t(s text) \gset
-- Renaming a thought does not take the account's row.
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from public.accounts where id='a6666666-6666-4666-8666-666666666666' for update$q$) as t(x integer) \gset
select dblink_exec('person',$q$set lock_timeout to '300ms'$q$);
select is((select s from dblink('person',$q$update public.seeds set title='Race thought renamed',position_x=10 where id='accccccc-cccc-4ccc-8ccc-cccccccccce2' returning 'done'$q$) as t(s text)),'done','renaming and moving a thought on the canvas never waits for the account''s row');
select dblink_exec('holder','commit');

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='a6666666-6666-4666-8666-666666666666'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('worker'),('person'),('person2'),('holder'),('probe')) v(c);
select * from finish();
rollback;

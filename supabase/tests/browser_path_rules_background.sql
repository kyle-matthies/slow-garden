-- A person's save never waits on background processing, and background locks
-- are short and ordered (20261116041903_browser_path_rules.sql, second review).
-- Synthetic data only. Real sessions are needed, so fixtures are committed
-- through dblink and removed again at the end (and at the start, in case an
-- earlier run stopped midway). Local stack only; never run against a hosted project.
-- Every session that must not wait has lock_timeout set, so a regression fails
-- here instead of hanging.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$
    delete from auth.users where id in('6d111111-1111-4111-8111-111111111111','6d222222-2222-4222-8222-222222222222');
    delete from vault.secrets where name='garden_worker_url' and description='browser_path_rules_background test';
    delete from private.ai_months where reserved_cents=0 and spent_cents=0 and not exists(select 1 from private.pass_inputs i where i.budget_month=month);
    update private.ai_runtime set enabled=false,nightly_enabled=false,model=null,approved_at=null,workflow_version='connect-v2-unapproved';
    update private.deployment_switches set deletion_enabled=false;
  $q$);
$$;
-- A night hour three days ahead, so passes created now are outside its 20-hour window.
create function pg_temp.night() returns text language sql as $$
  select to_char(date_trunc('day',now() at time zone 'UTC')+interval '3 days 2 hours 30 minutes','YYYY-MM-DD HH24:MI:SS')||'+00';
$$;

-- The server's own network address: loopback is trust-authenticated, which dblink refuses.
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('background'),('person'),('holder'),('probe'),('runner')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    ('6d111111-1111-4111-8111-111111111111','background-one@example.test','{}','{}',now(),now()),
    ('6d222222-2222-4222-8222-222222222222','background-two@example.test','{}','{}',now(),now());
  update private.ai_runtime set enabled=true,nightly_enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='connect-v2-unapproved';
  insert into private.ai_tenants(tenant_id) values('6d111111-1111-4111-8111-111111111111'),('6d222222-2222-4222-8222-222222222222');
  update private.deployment_switches set deletion_enabled=true;
  update public.accounts set tend_overnight=true,timezone='UTC' where id in('6d111111-1111-4111-8111-111111111111','6d222222-2222-4222-8222-222222222222');
  insert into public.gardens(id,tenant_id,name) values
    ('6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6d111111-1111-4111-8111-111111111111','Background garden one'),
    ('6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6d222222-2222-4222-8222-222222222222','Background garden two');
  insert into public.plots(id,tenant_id,garden_id,name,ai_enabled) values
    ('6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Tended topic one',true),
    ('6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','6d222222-2222-4222-8222-222222222222','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Tended topic two',true);
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values
    ('6dcccccc-cccc-4ccc-8ccc-ccccccccccc1','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Thought one'),
    ('6dcccccc-cccc-4ccc-8ccc-ccccccccccc3','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Thought to erase'),
    ('6dcccccc-cccc-4ccc-8ccc-ccccccccccc2','6d222222-2222-4222-8222-222222222222','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Thought two');
  insert into public.entries(id,tenant_id,garden_id,seed_id) values
    ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd1','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6dcccccc-cccc-4ccc-8ccc-ccccccccccc1'),
    ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd2','6d222222-2222-4222-8222-222222222222','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6dcccccc-cccc-4ccc-8ccc-ccccccccccc2');
  insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) values
    ('6deeeeee-eeee-4eee-8eee-eeeeeeeeeee1','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6dcccccc-cccc-4ccc-8ccc-ccccccccccc1','6ddddddd-dddd-4ddd-8ddd-ddddddddddd1',1,'Synthetic background source one.','6d111111-1111-4111-8111-111111111111'),
    ('6deeeeee-eeee-4eee-8eee-eeeeeeeeeee2','6d222222-2222-4222-8222-222222222222','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6dcccccc-cccc-4ccc-8ccc-ccccccccccc2','6ddddddd-dddd-4ddd-8ddd-ddddddddddd2',1,'Synthetic background source two.','6d222222-2222-4222-8222-222222222222');
$q$);
select count(*) as secret from dblink('setup',$q$select vault.create_secret('https://worker.invalid/functions/v1/garden-worker','garden_worker_url','browser_path_rules_background test')$q$) as t(r uuid) \gset
-- The person: signed in as account one, and unwilling to wait.
select dblink_exec('person',$q$set role authenticated; set "request.jwt.claims" to '{"sub":"6d111111-1111-4111-8111-111111111111","role":"authenticated"}'; set lock_timeout to '300ms'$q$);
select dblink_exec('probe',$q$set lock_timeout to '300ms'$q$);

-- 1. A pass is being prepared in a transaction that stays open (as nightly enqueue does).
select dblink_exec('background','begin');
select dblink_exec('background',$q$insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('6dffffff-ffff-4fff-8fff-fffffffffff1','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[],'nightly')$q$);
select lives_ok($t$select * from dblink('person',$q$select public.save_entry('6dcccccc-cccc-4ccc-8ccc-ccccccccccc1','6ddddddd-dddd-4ddd-8ddd-ddddddddddd1','6deeeeee-eeee-4eee-8eee-eeeeeeeeee11','Synthetic save during pass preparation.','6deeeeee-eeee-4eee-8eee-eeeeeeeeeee1')$q$) as t(r uuid)$t$,
  'a save in the topic being prepared completes without waiting');
select lives_ok($t$select * from dblink('person',$q$select public.save_entry('6dcccccc-cccc-4ccc-8ccc-ccccccccccc1','6ddddddd-dddd-4ddd-8ddd-dddddddddd12','6deeeeee-eeee-4eee-8eee-eeeeeeeeee12','Synthetic new entry during pass preparation.')$q$) as t(r uuid)$t$,
  'so does a new entry');
select lives_ok($t$select dblink_exec('person',$q$insert into public.seeds(id,garden_id,plot_id,title) values('6dcccccc-cccc-4ccc-8ccc-cccccccccc14','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Thought during pass preparation')$q$)$t$,
  'and a new thought');
select lives_ok($t$select * from dblink('person',$q$select public.create_seed('6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Synthetic create_seed during pass preparation.')$q$) as t(r uuid)$t$,
  'and the original create_seed API');
-- The preparation still excludes what would change its meaning.
select throws_like($t$select dblink_exec('person',$q$update public.plots set archived_at=now() where id='6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$)$t$,'%lock timeout%',
  'archiving the topic waits for the preparation');
select throws_like($t$select dblink_exec('person',$q$update public.plots set ai_enabled=false where id='6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$)$t$,'%lock timeout%',
  'and so does withdrawing its tending permission');
select dblink_exec('background','commit');
select is((select status from public.garden_passes where id='6dffffff-ffff-4fff-8fff-fffffffffff1'),'queued','the pass was prepared');
select is((select jsonb_array_length(snapshot) from private.pass_inputs where pass_id='6dffffff-ffff-4fff-8fff-fffffffffff1'),1,'from the writing committed before it began');

-- 2. The reverse: a save in progress does not make pass preparation fail.
select dblink_exec('setup',$q$update public.garden_passes set status='cancelled',finished_at=now() where id='6dffffff-ffff-4fff-8fff-fffffffffff1'$q$);
select dblink_exec('person','begin');
select count(*) as saved from dblink('person',$q$select public.save_entry('6dcccccc-cccc-4ccc-8ccc-ccccccccccc1','6ddddddd-dddd-4ddd-8ddd-dddddddddd13','6deeeeee-eeee-4eee-8eee-eeeeeeeeee13','Synthetic save held open.')$q$) as t(r uuid) \gset
select dblink_exec('background',$q$set lock_timeout to '300ms'$q$);
select lives_ok($t$select dblink_exec('background',$q$insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('6dffffff-ffff-4fff-8fff-fffffffffff2','6d111111-1111-4111-8111-111111111111','6daaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[],'nightly')$q$)$t$,
  'a pass is prepared while a save on the same topic is uncommitted');
select dblink_exec('person','commit');
select dblink_exec('background',$q$reset lock_timeout$q$);
select dblink_exec('setup',$q$update public.garden_passes set status='cancelled',finished_at=now() where id='6dffffff-ffff-4fff-8fff-fffffffffff2'$q$);

-- 3. The scheduled enqueue commits after each account: one account's locks do
--    not outlive its own work. Account two's work is held up; account one is
--    already done, visible and unlocked.
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from public.accounts where id='6d222222-2222-4222-8222-222222222222' for update$q$) as t(r integer) \gset
select is(dblink_send_query('runner',format('call private.run_nightly_enqueue(%L)',pg_temp.night())),1,'the nightly enqueue starts');
select pg_sleep(1.5);
select is(dblink_is_busy('runner'),1,'it is still working on account two');
select is((select count(*) from public.garden_passes where tenant_id='6d111111-1111-4111-8111-111111111111' and trigger='nightly' and status='queued'),1::bigint,
  'account one''s pass is already committed');
select lives_ok($t$select dblink_exec('person',$q$update public.plots set cross_pollinate=true where id='6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$)$t$,
  'account one can change its topic settings while the enqueue is still running');
select lives_ok($t$select * from dblink('person',$q$select public.delete_entry('6ddddddd-dddd-4ddd-8ddd-dddddddddd12')$q$) as t(r jsonb)$t$,
  'and delete an entry: its account lock was released');
select dblink_exec('holder','commit');
select pg_sleep(1.5);
select is(dblink_is_busy('runner'),0,'the enqueue finishes once account two is free');
select count(*) as drained from dblink_get_result('runner',false) as t(r text) \gset
select is(dblink_error_message('runner'),'OK','without error');
select count(*) as drained from dblink_get_result('runner',false) as t(r text) \gset
select is((select count(*) from public.garden_passes where tenant_id='6d222222-2222-4222-8222-222222222222' and trigger='nightly'),1::bigint,'and account two''s pass is enqueued');
select is((select command from cron.job where jobname='slow-garden-nightly'),'call private.run_nightly_enqueue()','the schedule calls the procedure that commits per account');

-- 4. Invalidation takes a pass's input lock before the pass row, like every other path.
select dblink_exec('holder','begin');
select count(*) as held from dblink('holder',$q$select 1 from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id where p.tenant_id='6d222222-2222-4222-8222-222222222222' for update of i$q$) as t(r integer) \gset
select dblink_exec('runner',$q$set role authenticated; set "request.jwt.claims" to '{"sub":"6d222222-2222-4222-8222-222222222222","role":"authenticated"}'$q$);
select is(dblink_send_query('runner',$q$update public.plots set ai_enabled=false where id='6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$q$),1,'a tending permission is withdrawn while the pass inputs are locked elsewhere');
select pg_sleep(1);
select is(dblink_is_busy('runner'),1,'it waits');
select lives_ok($t$select * from dblink('probe',$q$select 1 from public.garden_passes where tenant_id='6d222222-2222-4222-8222-222222222222' for update$q$) as t(r integer)$t$,
  'without already holding the pass row: inputs first, then the pass');
select dblink_exec('holder','commit');
select pg_sleep(1);
select count(*) as drained from dblink_get_result('runner',false) as t(r text) \gset
select is(dblink_error_message('runner'),'OK','and completes when the inputs are free');
select count(*) as drained from dblink_get_result('runner',false) as t(r text) \gset
select is((select count(*) from public.garden_passes where tenant_id='6d222222-2222-4222-8222-222222222222' and status='cancelled'),1::bigint,'the pass is cancelled');

-- 5. Deleting a thought takes the garden and topic before the thought.
select dblink_exec('runner',$q$set "request.jwt.claims" to '{"sub":"6d111111-1111-4111-8111-111111111111","role":"authenticated"}'$q$);
select dblink_exec('holder',$q$set role authenticated; set "request.jwt.claims" to '{"sub":"6d111111-1111-4111-8111-111111111111","role":"authenticated"}'$q$);
select dblink_exec('holder','begin');
select dblink_exec('holder',$q$update public.plots set name='Topic being renamed' where id='6dbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$);
select is(dblink_send_query('runner',$q$select public.delete_seed('6dcccccc-cccc-4ccc-8ccc-ccccccccccc3')$q$),1,'a thought is deleted while its topic is being changed');
select pg_sleep(1);
select is(dblink_is_busy('runner'),1,'the deletion waits for the topic');
select lives_ok($t$select * from dblink('probe',$q$select 1 from public.seeds where id='6dcccccc-cccc-4ccc-8ccc-ccccccccccc3' for update$q$) as t(r integer)$t$,
  'without already holding the thought: topic first, then thought');
select dblink_exec('holder','commit');
select pg_sleep(1);
select is((select r->>'deleted' from dblink_get_result('runner') as t(r jsonb)),'true','then deletes it');
select count(*) as drained from dblink_get_result('runner') as t(r jsonb) \gset

select pg_temp.cleanup();
select is((select count(*) from auth.users where id in('6d111111-1111-4111-8111-111111111111','6d222222-2222-4222-8222-222222222222')),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('background'),('person'),('holder'),('probe'),('runner')) v(c);
select * from finish();
rollback;

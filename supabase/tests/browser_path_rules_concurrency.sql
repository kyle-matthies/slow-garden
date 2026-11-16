-- Archived places under concurrency (20261116041903_browser_path_rules.sql).
-- Synthetic data only. Two real sessions are needed, so fixtures are committed
-- through dblink and removed again at the end (and at the start, in case an
-- earlier run stopped midway). Local stack only; never run against a hosted project.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.cleanup() returns text language sql as $$
  select dblink_exec('setup',$q$delete from auth.users where id='66666666-6666-4666-8666-666666666666'$q$);
$$;

-- The server's own network address: loopback is trust-authenticated, which dblink refuses.
select dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',host(inet_server_addr()),inet_server_port(),current_database()))
  from (values('setup'),('archiver'),('writer')) v(c);
select pg_temp.cleanup();
select dblink_exec('setup',$q$
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('66666666-6666-4666-8666-666666666666','archive-race@example.test','{}','{}',now(),now());
  insert into public.gardens(id,tenant_id,name) values('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','66666666-6666-4666-8666-666666666666','Race garden');
  insert into public.plots(id,tenant_id,garden_id,name) values
    ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race topic one'),
    ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race topic two');
$q$);
-- Both sessions act as the same signed-in owner.
select dblink_exec(c,$q$set role authenticated; set "request.jwt.claims" to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}'; set lock_timeout to '20s'$q$) from (values('archiver'),('writer')) v(c);

-- 1. A topic is being archived (uncommitted) when a new thought is sent to it.
select dblink_exec('archiver','begin');
select dblink_exec('archiver',$q$update public.plots set archived_at=now() where id='6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$q$);
select is(dblink_send_query('writer',$q$insert into public.seeds(id,garden_id,plot_id,title) values('6ccccccc-cccc-4ccc-8ccc-ccccccccccc1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Racing thought')$q$),1,'the new thought is sent while the archive is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'the new thought waits for the archive');
select dblink_exec('archiver','commit');
select pg_sleep(1);
select is(dblink_is_busy('writer'),0,'and is answered once the archive commits');
select count(*) as answered from dblink_get_result('writer',false) as t(r text) \gset
select ok(dblink_error_message('writer') like 'ERROR:  this topic is archived; restore it to write here%','with the archived-topic refusal');
select count(*) as drained from dblink_get_result('writer',false) as t(r text) \gset
select is((select count(*) from public.seeds where id='6ccccccc-cccc-4ccc-8ccc-ccccccccccc1'),0::bigint,'no thought landed in the archived topic');

-- 2. The same for a garden being archived, through the import RPC.
select dblink_exec('archiver','begin');
select dblink_exec('archiver',$q$update public.gardens set status='archived',archived_at=now() where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$);
select is(dblink_send_query('writer',$q$select public.import_thought('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','6ccccccc-cccc-4ccc-8ccc-ccccccccccc2','Racing import',
  '[{"entry_id":"6ddddddd-dddd-4ddd-8ddd-ddddddddddd1","revision_id":"6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","body":"Synthetic racing import.","date":"2020-02-02"}]')$q$),1,'an import is sent while the garden archive is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'the import waits for the archive');
select dblink_exec('archiver','commit');
select pg_sleep(1);
select is(dblink_is_busy('writer'),0,'and is answered once the archive commits');
select count(*) as answered from dblink_get_result('writer',false) as t(r text) \gset
select ok(dblink_error_message('writer') like 'ERROR:  choose an active topic%','with the same refusal');
select count(*) as drained from dblink_get_result('writer',false) as t(r text) \gset
select is((select count(*) from public.seeds where garden_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),0::bigint,'nothing landed in the archived garden');
select is((select count(*) from public.entries where garden_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),0::bigint,'and no entry');

-- 3. An existing thought, a garden archive in flight, and new writing (review finding 4).
select dblink_exec('setup',$q$
  update public.gardens set status='active',archived_at=null where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3','66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Existing thought');
$q$);
select dblink_exec('archiver','begin');
select dblink_exec('archiver',$q$update public.gardens set status='archived',archived_at=now() where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$);
select is(dblink_send_query('writer',$q$select public.save_entry('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3','6ddddddd-dddd-4ddd-8ddd-ddddddddddd3','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','Synthetic writing during an archive.')$q$),1,'a save on an existing thought is sent while its garden''s archive is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'the save waits for the archive instead of reading the garden as active');
select dblink_exec('archiver','commit');
select pg_sleep(1);
select is(dblink_is_busy('writer'),0,'and is answered once the archive commits');
select count(*) as answered from dblink_get_result('writer',false) as t(r text) \gset
select ok(dblink_error_message('writer') like 'ERROR:  this garden is archived; restore it to write here%','with the archived-garden refusal');
select count(*) as drained from dblink_get_result('writer',false) as t(r text) \gset
select is((select count(*) from public.seed_revisions where seed_id='6ccccccc-cccc-4ccc-8ccc-ccccccccccc3'),0::bigint,'no writing landed in the archived garden');

-- 4. The same through a direct revision insert, which does not go through save_entry.
select dblink_exec('setup',$q$update public.gardens set status='active',archived_at=null where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$);
select dblink_exec('archiver','begin');
select dblink_exec('archiver',$q$update public.plots set archived_at=now() where id='6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$q$);
select is(dblink_send_query('writer',$q$insert into public.seed_revisions(tenant_id,garden_id,seed_id,revision_number,body,created_by)
  values('66666666-6666-4666-8666-666666666666','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6ccccccc-cccc-4ccc-8ccc-ccccccccccc3',1,'Synthetic direct insert during an archive.','66666666-6666-4666-8666-666666666666')$q$),1,'a direct revision insert is sent while its topic''s archive is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('writer'),1,'it waits for the archive');
select dblink_exec('archiver','commit');
select pg_sleep(1);
select count(*) as answered from dblink_get_result('writer',false) as t(r text) \gset
select ok(dblink_error_message('writer') like 'ERROR:  this topic is archived; restore it to write here%','and is refused once the archive commits');
select count(*) as drained from dblink_get_result('writer',false) as t(r text) \gset

-- 5. The other way round: writing in flight, then an archive. Both finish; the archive waited.
select dblink_exec('setup',$q$update public.plots set archived_at=null where id='6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'$q$);
select dblink_exec('writer','begin');
select count(*) as saved from dblink('writer',$q$select public.save_entry('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3','6ddddddd-dddd-4ddd-8ddd-ddddddddddd5','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5','Synthetic writing before an archive.')$q$) as t(r uuid) \gset
select is(dblink_send_query('archiver',$q$update public.gardens set status='archived',archived_at=now() where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$q$),1,'an archive is sent while a save is uncommitted');
select pg_sleep(1);
select is(dblink_is_busy('archiver'),1,'the archive waits for the save');
select dblink_exec('writer','commit');
select pg_sleep(1);
select is(dblink_is_busy('archiver'),0,'and completes after it: neither deadlocks');
select count(*) as drained from dblink_get_result('archiver',false) as t(r text) \gset
select is(dblink_error_message('archiver'),'OK','without error');
select count(*) as drained from dblink_get_result('archiver',false) as t(r text) \gset
select is((select count(*) from public.seed_revisions where id='6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'),1::bigint,'the save that came first is kept');
select is((select status::text from public.gardens where id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'archived','and the garden is archived');

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='66666666-6666-4666-8666-666666666666'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('archiver'),('writer')) v(c);
select * from finish();
rollback;

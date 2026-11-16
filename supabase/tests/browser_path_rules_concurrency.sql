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
select ok(dblink_error_message('writer') like 'ERROR:  choose an active topic%','with the archived-topic refusal');
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

select pg_temp.cleanup();
select is((select count(*) from auth.users where id='66666666-6666-4666-8666-666666666666'),0::bigint,'the committed fixtures are removed');
select dblink_disconnect(c) from (values('setup'),('archiver'),('writer')) v(c);
select * from finish();
rollback;

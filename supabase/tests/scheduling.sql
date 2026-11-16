-- Scheduling (worker tick and nightly enqueue). Synthetic data only.
-- Nothing leaves the database: every request this test queues is rolled back
-- before pg_net's background worker can see it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

-- What the migration installed.
select is((select schedule from cron.job where jobname='slow-garden-worker'),'*/5 * * * *','the worker tick is scheduled every five minutes');
select is((select command from cron.job where jobname='slow-garden-worker'),'select private.tick_garden_worker()','and calls the tick function');
select is((select schedule from cron.job where jobname='slow-garden-nightly'),'7 * * * *','the nightly enqueue is scheduled hourly');
select is((select command from cron.job where jobname='slow-garden-nightly'),'select private.tick_nightly_enqueue()','and calls the gated wrapper, not the enqueue function');
select is((select count(*) from cron.job where command like '%enqueue_nightly_passes%'),0::bigint,'no job calls the ungated enqueue function');
select is((select nightly_enabled from private.ai_runtime),false,'nightly tending is off by default');
select ok(not has_function_privilege(r,'private.tick_garden_worker()','execute')
  and not has_function_privilege(r,'private.tick_nightly_enqueue(timestamptz)','execute')
  and not has_function_privilege(r,'private.garden_worker_url()','execute'),r||' cannot run the scheduling functions')
  from unnest(array['anon','authenticated','service_role']) r;

-- An armed, allowlisted synthetic account with a queued pass.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('51111111-1111-4111-8111-111111111111','tick-alice@example.test','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) values('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Tick garden');
insert into public.plots(id,garden_id,name,ai_enabled) values
  ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Tick topic',true),
  ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Night topic',true);
insert into public.seeds(id,garden_id,plot_id,title) values
  ('5ccccccc-cccc-4ccc-8ccc-ccccccccccc1','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Tick thought'),
  ('5ccccccc-cccc-4ccc-8ccc-ccccccccccc2','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Night thought');
select public.save_entry('5ccccccc-cccc-4ccc-8ccc-ccccccccccc1','5ddddddd-dddd-4ddd-8ddd-ddddddddddd1','5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Synthetic scheduling source one.');
select public.save_entry('5ccccccc-cccc-4ccc-8ccc-ccccccccccc2','5ddddddd-dddd-4ddd-8ddd-ddddddddddd2','5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Synthetic scheduling source two.');
update public.accounts set tend_overnight=true where id='51111111-1111-4111-8111-111111111111';
reset role;
insert into private.ai_tenants(tenant_id) values('51111111-1111-4111-8111-111111111111');

-- Disabled and unconfigured: both functions return null and nothing is queued.
select is(private.tick_garden_worker(),null,'tick: runtime disabled and unconfigured returns null');
select is(private.tick_nightly_enqueue('2026-11-16 02:30:00+00'),null,'enqueue: runtime disabled returns null');

-- Enabled, with work, but no Vault secrets: still null.
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';
set local role authenticated;
insert into public.garden_passes(id,garden_id,plot_ids) values('5fffffff-ffff-4fff-8fff-fffffffffff1','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[]);
reset role;
select is(private.tick_garden_worker(),null,'tick: enabled with work but no Vault secrets returns null');
update private.ai_runtime set nightly_enabled=true;
select is(private.tick_nightly_enqueue('2026-11-16 02:30:00+00'),null,'enqueue: nightly on but no worker configured returns null');
update private.ai_runtime set nightly_enabled=false;

-- Half configured, or configured unsafely: null.
-- Configured unsafely: null.
select vault.create_secret('http://worker.example.test/functions/v1/garden-worker','garden_worker_url') as url_secret \gset
select is(private.tick_garden_worker(),null,'tick: a plain http URL is refused');
select vault.update_secret(:'url_secret'::uuid,'https://worker.example.test/functions/v1/garden-worker');
select is((select count(*) from net.http_request_queue),0::bigint,'no request was queued by any refused tick');
select is((select count(*) from private.worker_ticks),0::bigint,'and no tick token was issued');

-- pg_net's own grants (made by the platform's extension owner; a migration cannot
-- revoke them) let every role read its queue. So the long-lived worker secret is
-- never placed there: a tick carries a single-use token that expires in two minutes.
select is((select count(*) from vault.decrypted_secrets where name='garden_worker_secret'),0::bigint,'the worker secret is not stored in the database at all');

-- Configured, enabled, with work: exactly one request, correctly formed.
select isnt(private.tick_garden_worker(),null,'tick: configured and enabled with work queues a request');
select is((select count(*) from net.http_request_queue),1::bigint,'exactly one request is queued');
select is((select url from net.http_request_queue),'https://worker.example.test/functions/v1/garden-worker','to the configured worker URL');
select headers->>'Authorization' as sent_auth from net.http_request_queue \gset
select matches(:'sent_auth'::text,'^Bearer tick_[0-9a-f]{64}$'::text,'carrying a single-use tick token, never a stored secret');
select is((select count(*) from private.worker_ticks where expires_at between now()+interval '1 minute' and now()+interval '2 minutes'),1::bigint,'the token is recorded once and expires within two minutes');
select is((select count(*) from private.worker_ticks where encode(token_hash,'hex')=substr(:'sent_auth',13)),0::bigint,'only its hash is stored');
select ok(not has_function_privilege(r,'public.consume_worker_tick(text)','execute') and not has_table_privilege(r,'private.worker_ticks','select'),r||' cannot read or consume tick tokens') from unnest(array['anon','authenticated']) r;
set local role service_role;
select is(public.consume_worker_tick('tick_'||repeat('0',64)),false,'a made-up token is refused');
select is(public.consume_worker_tick(substr(:'sent_auth',8)),true,'the worker can consume the token it was sent');
select is(public.consume_worker_tick(substr(:'sent_auth',8)),false,'exactly once');
reset role;
select private.tick_garden_worker() is not null as again \gset
update private.worker_ticks set expires_at=now()-interval '1 second';
select headers->>'Authorization' as late_auth from net.http_request_queue order by id desc limit 1 \gset
set local role service_role;
select is(public.consume_worker_tick(substr(:'late_auth',8)),false,'an expired token is refused');
reset role;
delete from net.http_request_queue where id=(select max(id) from net.http_request_queue);
select is((select method::text from net.http_request_queue),'POST','as a POST');
select is((select convert_from(body,'utf8') from net.http_request_queue),'{}','with an empty body: no content ever travels with a tick');
select is((select timeout_milliseconds from net.http_request_queue),140000,'and a timeout that outlasts a synchronous provider call');
delete from net.http_request_queue;

-- Nightly: its own switch.
select is(private.tick_nightly_enqueue('2026-11-16 02:30:00+00'),null,'enqueue: runtime on but nightly switch off returns null');
select is((select count(*) from public.garden_passes where trigger='nightly'),0::bigint,'and enqueues nothing');
update private.ai_runtime set nightly_enabled=true;
select is(private.tick_nightly_enqueue('2026-11-16 12:30:00+00'),0,'enqueue: gates open, outside the night hour enqueues nothing');
select is(private.tick_nightly_enqueue('2026-11-16 02:30:00+00'),1,'enqueue: gates open, in the night hour enqueues the scope with new writing');

-- Enabled but nothing to do: no request.
update public.garden_passes set status='cancelled';
update private.pass_inputs set cleanup_pending=false;
select is(private.tick_garden_worker(),null,'tick: configured and enabled with no work returns null');

-- Disabled with cleanup still owed: the tick keeps running so nothing is stranded.
update private.ai_runtime set enabled=false;
select is(private.tick_garden_worker(),null,'tick: disabled with no work returns null');
update private.pass_inputs set cleanup_pending=true where pass_id='5fffffff-ffff-4fff-8fff-fffffffffff1';
select isnt(private.tick_garden_worker(),null,'tick: disabled but cleanup is owed still reaches the worker');
update private.pass_inputs set cleanup_pending=false;
delete from net.http_request_queue;
-- A released, non-terminal pass (a sync call that timed out) carries cleanup_pending,
-- but nothing can be claimed for it while the runtime is off: the tick stays silent.
set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
reset role;
update private.ai_runtime set enabled=true;
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values('5fffffff-ffff-4fff-8fff-fffffffffff7','51111111-1111-4111-8111-111111111111','5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[],'nightly');
update private.ai_runtime set enabled=false;
update public.garden_passes set status='processing' where id='5fffffff-ffff-4fff-8fff-fffffffffff7';
update private.pass_inputs set cleanup_pending=true where pass_id='5fffffff-ffff-4fff-8fff-fffffffffff7';
select is(private.tick_garden_worker(),null,'tick: disabled with only a released in-flight pass sends nothing');
set local role service_role;
select is(public.claim_garden_pass(),null,'(the worker could not have claimed it)');
reset role;
select is((select count(*) from net.http_request_queue),0::bigint,'and queues nothing');
insert into private.provider_orphans(provider_id) values('batch_synthetic');
select isnt(private.tick_garden_worker(),null,'tick: disabled but an orphan is queued still reaches the worker');
select is(private.tick_nightly_enqueue('2026-11-17 02:30:00+00'),null,'enqueue: disabled returns null even with the nightly switch on');

-- The soft cap pauses automatic passes; a person can still invite one up to the hard cap.
update private.ai_runtime set enabled=true;
update public.garden_passes set status='cancelled' where status in('queued','processing');
set local role authenticated;
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
select public.save_entry('5ccccccc-cccc-4ccc-8ccc-ccccccccccc2','5ddddddd-dddd-4ddd-8ddd-ddddddddddd9','5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee9','Synthetic scheduling source three.');
reset role;
insert into private.ai_months(month) values(date_trunc('month',now() at time zone 'UTC')::date) on conflict do nothing;
update private.ai_months set spent_cents=(select soft_cap_cents from private.ai_runtime);
select is(private.enqueue_nightly_passes('2026-11-18 02:30:00+00'),0,'at the soft cap nightly tending enqueues nothing');
update private.ai_months set spent_cents=0;
select is(private.enqueue_nightly_passes('2026-11-18 02:30:00+00'),2,'below it both scopes with unseen writing are enqueued');
select * from finish();
rollback;

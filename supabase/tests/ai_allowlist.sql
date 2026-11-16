-- Owner-only allowlist for AI tending (private.ai_tenants). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('31111111-1111-4111-8111-111111111111','allow-alice@example.test','{}','{}',now(),now()),
('32222222-2222-4222-8222-222222222222','allow-bob@example.test','{}','{}',now(),now());

-- Two armed accounts: tending on for a topic, overnight preference on, writing present.
set local role authenticated;
select set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) values('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Alice garden');
insert into public.plots(id,garden_id,name,ai_enabled) values('3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Alice topic',true);
insert into public.seeds(id,garden_id,plot_id,title) values('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Alice thought');
select public.save_entry('3ccccccc-cccc-4ccc-8ccc-ccccccccccc1','3ddddddd-dddd-4ddd-8ddd-ddddddddddd1','3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Synthetic allowlist source one.');
update public.accounts set tend_overnight=true where id='31111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claim.sub','32222222-2222-4222-8222-222222222222',true);
insert into public.gardens(id,name) values('3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Bob garden');
insert into public.plots(id,garden_id,name,ai_enabled) values('3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Bob topic',true);
insert into public.seeds(id,garden_id,plot_id,title) values('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Bob thought');
select public.save_entry('3ccccccc-cccc-4ccc-8ccc-ccccccccccc2','3ddddddd-dddd-4ddd-8ddd-ddddddddddd2','3eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Synthetic allowlist source two.');
update public.accounts set tend_overnight=true where id='32222222-2222-4222-8222-222222222222';

-- The allowlist is private: no API role can read or change it.
select throws_ok($$select count(*) from private.ai_tenants$$,'42501',null,'a signed-in account cannot read the allowlist');
select throws_ok($$insert into private.ai_tenants(tenant_id) values('32222222-2222-4222-8222-222222222222')$$,'42501',null,'a signed-in account cannot allowlist itself');
reset role;
select is((select count(*) from private.ai_tenants),0::bigint,'the allowlist starts empty');
select ok(not has_table_privilege('anon','private.ai_tenants','select') and not has_table_privilege('authenticated','private.ai_tenants','select,insert,update,delete'),'no API role holds a privilege on the allowlist');
select ok((select relrowsecurity from pg_class where oid='private.ai_tenants'::regclass),'row level security is on');

-- Runtime disabled: the original refusal is unchanged.
set local role authenticated;
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('3fffffff-ffff-4fff-8fff-fffffffffff1','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'55000','AI evaluation gate has not been activated','with the runtime off the gate message is unchanged');
reset role;

-- Runtime enabled, allowlist empty: nothing runs for anyone.
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';
set local role authenticated;
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('3fffffff-ffff-4fff-8fff-fffffffffff1','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'55000','tending is not available for this account yet','an account that is not allowlisted cannot create a pass through the data API');
reset role;
select is(private.enqueue_nightly_passes('2026-11-16 02:30:00+00'),0,'nightly enqueue does nothing while the allowlist is empty');
select is((select count(*) from public.garden_passes),0::bigint,'no pass exists');
select is((select count(*) from private.ai_months where reserved_cents>0),0::bigint,'and no budget was reserved');

-- Only the operator or the service role changes the allowlist.
set local role service_role;
select lives_ok($$insert into private.ai_tenants(tenant_id,note) values('31111111-1111-4111-8111-111111111111','synthetic owner')$$,'the service role can allowlist an account');
reset role;

-- Allowlisted account runs; the other still does not.
select is(private.enqueue_nightly_passes('2026-11-16 02:30:00+00'),1,'nightly enqueue serves only the allowlisted account');
select is((select count(*) from public.garden_passes where tenant_id='32222222-2222-4222-8222-222222222222'),0::bigint,'the other armed account is not enqueued');
set local role authenticated;
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('3fffffff-ffff-4fff-8fff-fffffffffff1','3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'55000','tending is not available for this account yet','the other account is still refused');
reset role;

-- Claim: an active pass whose tenant is not allowlisted is never handed out.
-- (The removal trigger normally cancels it; it is switched off here to prove the claim gate on its own.)
alter table private.ai_tenants disable trigger ai_tenants_removed;
delete from private.ai_tenants where tenant_id='31111111-1111-4111-8111-111111111111';
set local role service_role;
select is(public.claim_garden_pass(),null,'the worker does not claim a queued pass of a tenant that is not allowlisted');
reset role;
insert into private.ai_tenants(tenant_id) values('31111111-1111-4111-8111-111111111111');
set local role service_role;
select public.claim_garden_pass() as job \gset
select isnt(:'job'::jsonb->>'id',null,'the worker claims the allowlisted tenant''s pass');
select is(public.check_garden_pass((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),true,'a leased pass may publish while its tenant is allowlisted');
reset role;
delete from private.ai_tenants where tenant_id='31111111-1111-4111-8111-111111111111';
set local role service_role;
select is(public.check_garden_pass((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),false,'and may not once the tenant has left the allowlist');
reset role;
insert into private.ai_tenants(tenant_id) values('31111111-1111-4111-8111-111111111111');
alter table private.ai_tenants enable trigger ai_tenants_removed;

-- Removal drains: the tenant's active pass is cancelled and still cleaned up.
delete from private.ai_tenants where tenant_id='31111111-1111-4111-8111-111111111111';
select is((select status from public.garden_passes where id=(:'job'::jsonb->>'id')::uuid),'cancelled','removing a tenant cancels its in-flight pass');
select ok((select cleanup_pending from private.pass_inputs where pass_id=(:'job'::jsonb->>'id')::uuid),'and queues it for cleanup');
update private.pass_inputs set lease_until=now()-interval '1 second' where pass_id=(:'job'::jsonb->>'id')::uuid;
set local role service_role;
select is(public.claim_garden_pass()->>'status','cancelled','cleanup is still claimed for a tenant that is no longer allowlisted');
reset role;

-- The allowlist row goes with the account.
insert into private.ai_tenants(tenant_id) values('32222222-2222-4222-8222-222222222222');
delete from auth.users where id='32222222-2222-4222-8222-222222222222';
select is((select count(*) from private.ai_tenants),0::bigint,'deleting an account removes its allowlist row');
select * from finish();
rollback;

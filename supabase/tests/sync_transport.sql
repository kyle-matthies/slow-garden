-- Provider transport and the synchronous dispatch ledger. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('41111111-1111-4111-8111-111111111111','sync-alice@example.test','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Sync garden');
insert into public.plots(id,garden_id,name,ai_enabled) select ('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,'4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Topic '||n,true from generate_series(1,5) n;
insert into public.seeds(id,garden_id,plot_id,title) select ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,'4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid,'Thought '||n from generate_series(1,5) n;
select public.save_entry(('4ccccccc-cccc-4ccc-8ccc-ccccccccccc'||n)::uuid,('4ddddddd-dddd-4ddd-8ddd-ddddddddddd'||n)::uuid,('4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee'||n)::uuid,'Synthetic transport source '||n||'.') from generate_series(1,5) n;
reset role;
insert into private.ai_tenants(tenant_id) values('41111111-1111-4111-8111-111111111111');

-- Defaults: nothing changes until the operator chooses.
select is((select transport from private.ai_runtime),'batch','the runtime transport defaults to batch');
select is((select reasoning_effort from private.ai_runtime),null,'no reasoning effort is pinned by default');
select throws_ok($$update private.ai_runtime set transport='stream'$$,'23514',null,'only batch and sync are accepted');
select throws_ok($$update private.ai_runtime set reasoning_effort='Very High!'$$,'23514',null,'reasoning effort is a short lower-case word');
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';

create function pg_temp.request(n integer) returns void language sql as $$
  insert into public.garden_passes(id,garden_id,plot_ids) values(('4fffffff-ffff-4fff-8fff-fffffffffff'||n)::uuid,'4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array[('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb'||n)::uuid]);
$$;
create function pg_temp.only(n integer) returns void language sql as $$
  update private.pass_inputs set next_attempt_at=case when pass_id=('4fffffff-ffff-4fff-8fff-fffffffffff'||n)::uuid then now()-interval '1 minute' else now()+interval '1 hour' end;
$$;

-- A batch pass: frozen as batch, and the dispatch ledger refuses it.
set local role authenticated;
select pg_temp.request(1);
reset role;
select is((select transport from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff1'),'batch','a pass freezes the batch transport');
update private.ai_runtime set transport='sync',reasoning_effort='low';
select is((select transport from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff1'),'batch','changing the runtime does not change a pass already prepared');
set local role service_role;
select public.claim_garden_pass() as batch_job \gset
select is(:'batch_job'::jsonb->>'transport','batch','the worker is told the pass is batch');
select throws_ok(format('select public.mark_garden_dispatch(%L,%L)',:'batch_job'::jsonb->>'id',:'batch_job'::jsonb->>'token'),'P0001','not a synchronous pass','a batch pass cannot be dispatched synchronously');
reset role;

-- A sync pass: transport and effort frozen, handed to the worker.
set local role authenticated;
select pg_temp.request(2);
select throws_ok(format('select public.mark_garden_dispatch(%L,%L)','4fffffff-ffff-4fff-8fff-fffffffffff2','4fffffff-ffff-4fff-8fff-fffffffffff2'),'42501',null,'a signed-in account cannot record a dispatch');
reset role;
select is((select transport||'/'||reasoning_effort from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),'sync/low','a new pass freezes sync and the pinned effort');
select pg_temp.only(2);
select reserved_cents as reserved from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2' \gset
select spent_cents as spent0 from private.ai_months \gset
set local role service_role;
select public.claim_garden_pass() as job \gset
select is(:'job'::jsonb->>'transport','sync','the worker is told the pass is sync');
select is(:'job'::jsonb->>'reasoning_effort','low','and its reasoning effort');
select is(:'job'::jsonb->>'dispatches','0','and that nothing has been dispatched');
select is(public.claim_garden_pass(),null,'a duplicate invocation is not handed a pass that is under lease');
select throws_ok(format('select public.mark_garden_dispatch(%L,%L)',:'job'::jsonb->>'id',gen_random_uuid()),'P0001','lease lost','a dispatch needs the current lease');

-- First dispatch: recorded, lease extended, nothing charged.
select is(public.mark_garden_dispatch((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),'ok','the first dispatch is recorded');
reset role;
select is((select dispatches from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),1,'one dispatch');
select ok((select dispatch_open from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),'left open until it reports back');
select ok((select lease_until>now()+interval '100 seconds' from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),'the lease runs 120 seconds from the dispatch');
set local role service_role;
select is(public.claim_garden_pass(),null,'nor while the provider call is in flight');
reset role;
select is((select spent_cents from private.ai_months),:spent0::numeric,'nothing is charged for a first dispatch');

-- The provider refused outright: closed without a charge, and the retry is free.
set local role service_role;
select is(public.mark_garden_dispatch((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid,true),'closed','a refused dispatch is closed');
select is(public.mark_garden_dispatch((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),'ok','and may be retried');
reset role;
select is((select spent_cents from private.ai_months),:spent0::numeric,'a refused dispatch costs nothing');
select is((select dispatches from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),2,'two dispatches');

-- The second dispatch never reported back (timeout, crash, lost lease): its
-- usage is unknown, so the third dispatch books a full reservation as spend.
set local role service_role;
select is(public.mark_garden_dispatch((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),'ok','a dispatch after a lost one is allowed');
reset role;
select is((select spent_cents from private.ai_months),:spent0::numeric+:reserved::numeric,'the lost dispatch is booked at the full reservation');
select is((select lost_cents from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),:reserved::numeric,'and recorded on the pass');
set local role service_role;
select is(public.mark_garden_dispatch((:'job'::jsonb->>'id')::uuid,(:'job'::jsonb->>'token')::uuid),'limit','a fourth dispatch is refused');
-- The answer arrives: actual usage replaces the reservation.
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,1000,200,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token','{"blooms":[],"marks":[],"no_output_reason":null}'),'the pass settles on real usage');
reset role;
select is((select status from public.garden_passes where id='4fffffff-ffff-4fff-8fff-fffffffffff2'),'complete','and completes');
select is((select actual_cents from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff2'),(1000*1000+200*5000)::numeric/1000000,'at the pinned rates');

-- Budget stop at dispatch: a lost dispatch that would cross the hard cap is refused.
set local role authenticated;
select pg_temp.request(3);
reset role;
select pg_temp.only(3);
set local role service_role;
select public.claim_garden_pass() as capped \gset
select is(public.mark_garden_dispatch((:'capped'::jsonb->>'id')::uuid,(:'capped'::jsonb->>'token')::uuid),'ok','first dispatch under the cap');
reset role;
select spent_cents as spent1 from private.ai_months \gset
update private.ai_runtime set soft_cap_cents=1,hard_cap_cents=(select ceil(reserved_cents+spent_cents)::integer from private.ai_months);
set local role service_role;
select is(public.mark_garden_dispatch((:'capped'::jsonb->>'id')::uuid,(:'capped'::jsonb->>'token')::uuid),'budget','a redispatch that would cross the hard cap is refused');
reset role;
select is((select spent_cents from private.ai_months),:spent1::numeric,'and nothing more is booked');
select is((select dispatches from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff3'),1,'nor dispatched');
update private.ai_runtime set soft_cap_cents=1000,hard_cap_cents=1500;

-- Cancelled while in flight: no further dispatch.
update public.garden_passes set status='cancelled' where id='4fffffff-ffff-4fff-8fff-fffffffffff3';
set local role service_role;
select is(public.mark_garden_dispatch((:'capped'::jsonb->>'id')::uuid,(:'capped'::jsonb->>'token')::uuid),'inactive','a cancelled pass is not dispatched again');
reset role;

-- Deleting a pass that was dispatched but never settled keeps its reservation as spend.
set local role authenticated;
select pg_temp.request(4);
select pg_temp.request(5);
reset role;
select pg_temp.only(4);
set local role service_role;
select public.claim_garden_pass() as gone \gset
select is(public.mark_garden_dispatch((:'gone'::jsonb->>'id')::uuid,(:'gone'::jsonb->>'token')::uuid),'ok','a pass is dispatched and then deleted before it settles');
reset role;
select spent_cents as spent2,reserved_cents as reserved2 from private.ai_months \gset
select reserved_cents as r4 from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff4' \gset
select reserved_cents as r5 from private.pass_inputs where pass_id='4fffffff-ffff-4fff-8fff-fffffffffff5' \gset
delete from public.garden_passes where id='4fffffff-ffff-4fff-8fff-fffffffffff4';
select is((select spent_cents from private.ai_months),:spent2::numeric+:r4::numeric,'a dispatched sync pass that is deleted is charged its reservation');
delete from public.garden_passes where id='4fffffff-ffff-4fff-8fff-fffffffffff5';
select is((select spent_cents from private.ai_months),:spent2::numeric+:r4::numeric,'a sync pass that never left is not charged');
select is((select reserved_cents from private.ai_months),:reserved2::numeric-:r4::numeric-:r5::numeric,'and both reservations are released');
select is((select count(*) from private.provider_orphans),0::bigint,'a sync pass leaves no provider files to clean');
select * from finish();
rollback;

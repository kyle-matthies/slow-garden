begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','garden-alice@example.test','{}','{}',now(),now()),
('22222222-2222-4222-8222-222222222222','garden-bob@example.test','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test garden');
insert into public.plots(id,garden_id,name) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Work'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Home');
insert into public.seeds(id,garden_id,plot_id,title) values
('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','An ongoing question');
select is((select ai_enabled from public.plots limit 1),false,'AI defaults off');
select is((select cross_pollinate from public.plots limit 1),false,'cross-pollination defaults off');
select lives_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','First entry')$$,'create dated entry');
select lives_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','First entry')$$,'retry identical save');
select is((select count(*) from public.seed_revisions),1::bigint,'retry does not duplicate');
select throws_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Changed replay')$$,'22023','request identifier already used','mismatched replay rejected');
select lives_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Revised entry','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1')$$,'edit appends immutable revision');
select throws_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','Stale edit','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1')$$,'40001','entry changed; review latest version before saving','stale edit rejected');
select is((select body from public.current_entries),'Revised entry','latest revision wins');
select lives_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd2','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4','Another dated entry')$$,'new entry is separate from edit');
select is((select count(*) from public.current_entries),2::bigint,'two entries remain visible');
select is((select body from public.seed_revisions where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'),'First entry','original text preserved');
select throws_ok($$select public.claim_garden_pass()$$,'42501',null,'users cannot claim worker jobs');
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'55000','AI evaluation gate has not been activated','AI activation is closed by default');
reset role;
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model';
set local role authenticated;
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'42501','plot permission denied','AI-off excluded at database boundary');
update public.plots set ai_enabled=true where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'AI-on cross-off can request within plot');
select throws_ok($$update public.garden_passes set status='complete' where id='ffffffff-ffff-4fff-8fff-fffffffffff1'$$,'42501','only active passes can be cancelled','users cannot forge completion');
update public.garden_passes set status='cancelled' where id='ffffffff-ffff-4fff-8fff-fffffffffff1';
select is((select status from public.garden_passes),'cancelled','manual cancellation works');
update public.plots set ai_enabled=true where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'42501','plot permission denied','cross-plot denied if either side opts out');
update public.plots set cross_pollinate=true;
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'mutual cross-pollination accepted');
update public.plots set cross_pollinate=false where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'cancelled','permission revocation cancels queued work');
reset role;
select ok((select bool_and(cleanup_pending) from private.pass_inputs),'cancelled jobs are queued for cleanup');
select ok((select reserved_cents>0 from private.ai_months),'budget reserved atomically');
set local role service_role;
select public.claim_garden_pass() as first_job \gset
select is((:'first_job'::jsonb->>'status'),'cancelled','service claims cancelled work for cleanup');
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,0,0,true)', :'first_job'::jsonb->>'id', :'first_job'::jsonb->>'token','{"blooms":[],"no_output_reason":null}'),'cancelled job settles budget');
reset role;
select ok((select spent_cents>0 from private.ai_months),'unknown usage retains conservative reservation');
set local role authenticated;
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'new isolated pass after cancellation');
reset role;
-- Defer old cleanup to exercise the newly requested pass in isolation.
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id<>'ffffffff-ffff-4fff-8fff-fffffffffff3';
set local role service_role;
select public.claim_garden_pass() as active_job \gset
select is((:'active_job'::jsonb->>'id'),'ffffffff-ffff-4fff-8fff-fffffffffff3','worker claims queued pass');
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,20,false)', :'active_job'::jsonb->>'id', :'active_job'::jsonb->>'token','{"blooms":[],"no_output_reason":"No connection"}'),'valid zero-bloom result completes');
reset role;
set local role authenticated;
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff3'),'complete','zero output is complete, not failed');
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'request sourced reflection');
reset role;
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id<>'ffffffff-ffff-4fff-8fff-fffffffffff4';
set local role service_role;
select public.claim_garden_pass() as sourced_job \gset
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,20,false)', :'sourced_job'::jsonb->>'id', :'sourced_job'::jsonb->>'token','{"blooms":[{"kind":"question","interpretation":"A possible question","evidence":[{"revision_id":"outside","excerpt":"Invented"}]}],"no_output_reason":null}'),'P0001','invalid source evidence','ingestion rejects evidence outside the snapshot');
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,20,false)', :'sourced_job'::jsonb->>'id', :'sourced_job'::jsonb->>'token','{"blooms":[{"kind":"question","interpretation":"What changed between these entries?","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2","excerpt":"Revised entry"}]}],"no_output_reason":null}'),'validated source-linked return persists');
reset role;
set local role authenticated;
select is((select count(*) from public.blooms),1::bigint,'owner can inspect the completed bloom');
update public.plots set ai_enabled=false where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
select is((select count(*) from public.blooms),0::bigint,'revocation withdraws previously completed output');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.plots),0::bigint,'second tenant cannot read plots');
select is((select count(*) from public.current_entries),0::bigint,'second tenant cannot read current entry view');
select is((select count(*) from public.garden_passes),0::bigint,'second tenant cannot read passes');
select throws_ok($$select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd2','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5','Impersonation')$$,'42501','seed unavailable','second tenant cannot write first tenant seed');
select * from finish();
rollback;

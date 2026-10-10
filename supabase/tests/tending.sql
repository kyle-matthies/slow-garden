-- Tending tiers and nightly tending (ADR-008). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','tend-alice@example.test','{}','{}',now(),now()),
('22222222-2222-4222-8222-222222222222','tend-bob@example.test','{}','{}',now(),now());

-- Accounts: nightly tending is opt-in, with a validated time zone.
select is((select tend_overnight from public.accounts where id='11111111-1111-4111-8111-111111111111'),false,'nightly tending is off by default');
select is((select timezone from public.accounts where id='11111111-1111-4111-8111-111111111111'),'UTC','time zone defaults to UTC');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$update public.accounts set timezone='Mars/Olympus_Mons' where id='11111111-1111-4111-8111-111111111111'$$,'22023','unknown time zone','unknown time zones are rejected');
select lives_ok($$update public.accounts set timezone='America/Los_Angeles',tend_overnight=true where id='11111111-1111-4111-8111-111111111111'$$,'the owner opts in with a time zone');

-- A garden with two AI-on topics that do not cross-pollinate.
insert into public.gardens(id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tended garden');
insert into public.plots(id,garden_id,name,ai_enabled) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mornings',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Studio',true);
insert into public.seeds(id,garden_id,plot_id,title) values
('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Leaving room'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Slow walks'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Studio light');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Leaving room before naming the solution keeps the garden open.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd2','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Is the room before naming really empty, or just quiet?');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','dddddddd-dddd-4ddd-8ddd-ddddddddddd3','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','A slow walk made room for the question I keep avoiding.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','dddddddd-dddd-4ddd-8ddd-ddddddddddd4','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4','The heron again, standing still by the water.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','dddddddd-dddd-4ddd-8ddd-ddddddddddd5','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5','Walking without a plan, I noticed the');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd6','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6','Naming came easier once there was room.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','dddddddd-dddd-4ddd-8ddd-ddddddddddd7','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7','Morning light in the studio is kinder to unfinished work.');
reset role;
-- Spread the history over months (test-only date edits around the immutability trigger).
alter table public.seed_revisions disable trigger seed_revisions_reject_update;
update public.entries e set created_at=now()-(d.days||' days')::interval from (values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1',90),('dddddddd-dddd-4ddd-8ddd-ddddddddddd2',62),('dddddddd-dddd-4ddd-8ddd-ddddddddddd3',33),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4',15),('dddddddd-dddd-4ddd-8ddd-ddddddddddd5',8),('dddddddd-dddd-4ddd-8ddd-ddddddddddd6',1),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd7',2)) d(id,days) where e.id=d.id::uuid;
update public.seed_revisions r set created_at=e.created_at from public.entries e where e.id=r.entry_id;
alter table public.seed_revisions enable trigger seed_revisions_reject_update;
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';

-- First tend-connect-v3 pass: everything is new; tiers unlock from evidence.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'request a tend-connect-v3 pass');
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff9','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'55000','a reflection is already in progress','one active pass per permission scope');
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[])$$,'another scope may run alongside');
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids,trigger) values('ffffffff-ffff-4fff-8fff-fffffffffff8','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[],'nightly')$$,'42501',null,'users cannot mark a pass as nightly');
reset role;
select is((select trigger from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'manual','a requested pass is manual');
select is((select scope_key from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','scope key names the topic');
select is((select jsonb_array_length(snapshot) from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),6,'first pass freezes all six entries in scope');
select ok((select bool_and(s->>'role'='changed' and s ? 'title') from private.pass_inputs i,jsonb_array_elements(i.snapshot) s where i.pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'all are new writing, with titles');
select is((select context#>>'{tiers,notice}' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'true','six entries over three weeks unlock noticing');
select is((select context#>>'{tiers,resurface}' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'true','writing months apart unlocks resurfacing');
select is((select context#>>'{tiers,notice}' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'false','one entry does not unlock noticing');
select is((select context#>>'{tiers,resurface}' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'false','one entry does not unlock resurfacing');

-- Ingestion validates marks and v3 brevity against the frozen snapshot.
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2';
set local role service_role;
select public.claim_garden_pass() as job \gset
select is(:'job'::jsonb->>'id','ffffffff-ffff-4fff-8fff-fffffffffff1','worker claims the first pass');
select is(:'job'::jsonb#>>'{context,tiers,catalog}','true','worker receives the tier context');
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,10,10,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  jsonb_build_object('blooms',jsonb_build_array(jsonb_build_object('kind','connection','interpretation',repeat('long ',60),'evidence',jsonb_build_array(jsonb_build_object('revision_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','excerpt','Leaving room'))))))::text,
  'P0001','interpretation too long','v3 blooms are one short sentence');
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,10,10,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc3","kind":"theme","label":"light","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7","excerpt":"Morning light"}]}]}'),
  'P0001','mark outside the snapshot','marks cannot describe another scope');
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,10,10,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"walks","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3","excerpt":"A slow walk"}]}]}'),
  'P0001','invalid source evidence','a mark cites its own thought');
select throws_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,10,10,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"room","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"room"}]},{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"naming","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"naming"}]},{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"garden","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"garden"}]}]}'),
  'P0001','too many marks for one thought','at most two theme labels per thought');
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[{"kind":"echo","interpretation":"A spring note about leaving room sits beside this week''s easier naming.","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"Leaving room before naming"},{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6","excerpt":"once there was room"}]}],
    "marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"Room","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"Leaving room"}]},
      {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","kind":"theme","label":"room","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3","excerpt":"made room"}]},
      {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"open_question","label":"","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2","excerpt":"Is the room before naming really empty, or just quiet?"}]},
      {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","kind":"unfinished","label":"","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5","excerpt":"I noticed the"}]}],
    "no_output_reason":null}'),
  'a validated catalogue and echo land');
reset role;
-- Treat the pass as finished a minute ago, so later writing in this test is new.
update public.garden_passes set finished_at=now()-interval '1 minute' where id='ffffffff-ffff-4fff-8fff-fffffffffff1';

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tending_marks),4::bigint,'the owner sees marks from a completed pass');
select is((select kind from public.blooms),'echo','the echo bloom is stored');
select is((select count(*) from public.garden_themes where label='room'),1::bigint,'one label on two thoughts becomes a theme');
select is((select days from public.garden_themes where label='room'),2::bigint,'theme days come from the cited writing');
select lives_ok($$insert into public.tending_mark_responses(id,mark_id,response) select '99999999-9999-4999-8999-999999999991',id,'prune' from public.tending_marks where seed_id='cccccccc-cccc-4ccc-8ccc-ccccccccccc2' and kind='theme'$$,'the owner prunes a label');
select is((select count(*) from public.garden_themes where label='room'),0::bigint,'a pruned label leaves the theme');
select throws_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'22023','nothing new to tend since the last return','unchanged writing is not tended again');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd8','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8','Room again today, and the naming waited for it.');
select lives_ok($$insert into public.garden_passes(id,garden_id,plot_ids) values('ffffffff-ffff-4fff-8fff-fffffffffff3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[])$$,'new writing can be tended');
reset role;
select is((select count(*) from private.pass_inputs i,jsonb_array_elements(i.snapshot) s where i.pass_id='ffffffff-ffff-4fff-8fff-fffffffffff3' and s->>'role'='changed'),1::bigint,'only the new entry is changed');
select ok((select count(*) from private.pass_inputs i,jsonb_array_elements(i.snapshot) s where i.pass_id='ffffffff-ffff-4fff-8fff-fffffffffff3' and s->>'role'='candidate')>=2,'related older writing joins as candidates');
select ok((select bool_and(to_tsvector('simple',s->>'body') @@ 'room | again | today | naming | waited'::tsquery) from private.pass_inputs i,jsonb_array_elements(i.snapshot) s where i.pass_id='ffffffff-ffff-4fff-8fff-fffffffffff3' and s->>'role'='candidate'),'candidates share words with the new writing');
select ok((select corrections::text like '%"pruned": "theme"%' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff3'),'pruned labels are remembered as corrections');

-- Isolation: another tenant sees and changes none of it.
select id as alice_mark from public.tending_marks where kind='open_question' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.tending_marks),0::bigint,'second tenant cannot read marks');
select is((select count(*) from public.garden_themes),0::bigint,'second tenant cannot read themes');
select throws_ok(format('insert into public.tending_mark_responses(id,mark_id,response) values(%L,%L,%L)','99999999-9999-4999-8999-999999999992',:'alice_mark','keep'),'42501',null,'second tenant cannot respond to another tenant''s mark');
reset role;
select throws_ok($$insert into public.tending_mark_responses(id,tenant_id,mark_id,response) select '99999999-9999-4999-8999-999999999993','22222222-2222-4222-8222-222222222222',id,'keep' from public.tending_marks limit 1$$,'23503',null,'a response cannot cross tenants');

-- Nightly enqueue: opted-in accounts, 02:00 local time, scopes with new writing.
update public.garden_passes set status='cancelled' where id in('ffffffff-ffff-4fff-8fff-fffffffffff2','ffffffff-ffff-4fff-8fff-fffffffffff3');
select is(private.enqueue_nightly_passes('2026-10-10 12:00:00+00'),0,'nothing is enqueued outside the night hour');
select is(private.enqueue_nightly_passes('2026-10-10 09:30:00+00'),2,'two scopes with new writing are enqueued at 02:30 Los Angeles time');
select is((select count(*) from public.garden_passes where trigger='nightly'),2::bigint,'enqueued passes are nightly');
select is(private.enqueue_nightly_passes('2026-10-10 09:45:00+00'),0,'a night is tended at most once');
update private.ai_runtime set enabled=false;
select is(private.enqueue_nightly_passes('2026-10-11 09:30:00+00'),0,'nothing is enqueued while the runtime gate is closed');
update private.ai_runtime set enabled=true;

-- Deleting writing removes tending that quoted it.
delete from public.entries where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
select is((select count(*) from public.tending_marks where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),0::bigint,'marks quoting deleted writing are removed');
select is((select count(*) from public.blooms where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),0::bigint,'blooms quoting deleted writing are removed');
select * from finish();
rollback;

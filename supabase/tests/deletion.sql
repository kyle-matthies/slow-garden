-- In-app deletion (D-024). Synthetic data only; canary strings prove no copy of text survives.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

-- Counts rows, in every table of the application schemas, whose text form contains a needle.
create function pg_temp.hits(needle text) returns bigint language plpgsql as $$
declare t record; n bigint; total bigint:=0;
begin
  for t in select schemaname,tablename from pg_catalog.pg_tables where schemaname in('public','private') loop
    execute format('select count(*) from %I.%I x where position(%L in x::text)>0',t.schemaname,t.tablename,needle) into n;
    total:=total+n;
  end loop;
  return total;
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','delete-alice@example.test','{}','{}',now(),now()),
('22222222-2222-4222-8222-222222222222','delete-bob@example.test','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values
('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111',now()-interval '2 minutes',now()),
('99999999-9999-4999-8999-999999999998','11111111-1111-4111-8111-111111111111',now()-interval '30 days',now()),
('99999999-9999-4999-8999-999999999997','22222222-2222-4222-8222-222222222222',now(),now());
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';
-- Tending runs only for allowlisted accounts (private.ai_tenants).
insert into private.ai_tenants(tenant_id) select id from public.accounts;

-- Privileges and function hygiene.
select ok(not has_function_privilege('anon','public.delete_entry(uuid)','execute')
  and not has_function_privilege('anon','public.delete_seed(uuid)','execute')
  and not has_function_privilege('anon','public.delete_plot(uuid,text)','execute')
  and not has_function_privilege('anon','public.delete_garden(uuid,text)','execute')
  and not has_function_privilege('anon','public.delete_account(text)','execute')
  and not has_function_privilege('anon','public.deletion_preview(text,uuid)','execute'),'anonymous visitors cannot call any deletion RPC');
select ok(has_function_privilege('authenticated','public.delete_entry(uuid)','execute')
  and has_function_privilege('authenticated','public.delete_account(text)','execute'),'signed-in owners can call deletion RPCs');
select ok(not has_function_privilege('authenticated','public.claim_provider_orphan()','execute')
  and not has_function_privilege('authenticated','public.resolve_provider_orphan(uuid,uuid,boolean)','execute')
  and not has_function_privilege('anon','public.claim_provider_orphan()','execute'),'only the backend can drain provider orphans');
select ok(not has_schema_privilege('authenticated','private','usage'),'the private schema stays closed to users');
select is((select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('delete_entry','delete_seed','delete_plot','delete_garden','delete_account','deletion_preview')
    and p.prosecdef and p.proconfig @> array['search_path=""']),6::bigint,'every deletion RPC is security definer with an empty search path');
select ok(has_table_privilege('postgres','auth.users','DELETE'),'the function owner can remove a sign-in identity');
select is((select string_agg(column_name::text,',' order by column_name::text) from information_schema.columns where table_schema='private' and table_name='provider_orphans'),
  'attempts,id,input_file_id,lease_token,lease_until,next_attempt_at,output_file_id,provider_id,queued_at','provider orphans hold identifiers and scheduling only');

-- Bob's own writing must survive everything Alice does.
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
insert into public.gardens(id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','Bob garden');
insert into public.plots(id,garden_id,name) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','Bob topic');
insert into public.seeds(id,garden_id,plot_id,title) values('cccccccc-cccc-4ccc-8ccc-ccccccccccc0','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','Bob thought');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc0','dddddddd-dddd-4ddd-8ddd-ddddddddddd0','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0','BOB-CANARY stays where it is.');

-- Alice: two gardens. Garden one has two AI-on topics; garden two has one.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999999"}',true);
insert into public.gardens(id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Keep garden'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Second garden');
insert into public.plots(id,garden_id,name,ai_enabled) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Mornings',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Studio',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Elsewhere',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Orchard',true);
insert into public.seeds(id,garden_id,plot_id,title) values
('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Leaving room'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','CANARY-TITLE-TWO walks'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Studio light'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','Far field'),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','Old trees');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','CANARY-ALPHA first wording about herons.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea','CANARY-ALPHA revised wording about herons.','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','dddddddd-dddd-4ddd-8ddd-ddddddddddd2','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','CANARY-BETA a second entry that stays.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','dddddddd-dddd-4ddd-8ddd-ddddddddddd3','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','CANARY-GAMMA a slow walk by the water.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','dddddddd-dddd-4ddd-8ddd-ddddddddddd4','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4','CANARY-STUDIO light on unfinished work.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc4','dddddddd-dddd-4ddd-8ddd-ddddddddddd5','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5','CANARY-GARDENTWO a field far away.');
select public.save_entry('cccccccc-cccc-4ccc-8ccc-ccccccccccc5','dddddddd-dddd-4ddd-8ddd-ddddddddddd7','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7','CANARY-ORCHARD old trees by the wall.');

-- Pass one reads Mornings; pass two reads Studio; passes four and six read the second garden's two topics.
insert into public.garden_passes(id,garden_id,plot_ids) values
('ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[]);
insert into public.garden_passes(id,garden_id,plot_ids) values
('ffffffff-ffff-4fff-8fff-fffffffffff2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[]);
insert into public.garden_passes(id,garden_id,plot_ids) values
('ffffffff-ffff-4fff-8fff-fffffffffff4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3']::uuid[]);
insert into public.garden_passes(id,garden_id,plot_ids) values
('ffffffff-ffff-4fff-8fff-fffffffffff6','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4']::uuid[]);
reset role;
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id<>'ffffffff-ffff-4fff-8fff-fffffffffff1';
set local role service_role;
select public.claim_garden_pass() as job \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'job'::jsonb->>'id',:'job'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","kind":"theme","label":"Canary-Label","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea","excerpt":"CANARY-ALPHA revised"}]},
    {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","kind":"theme","label":"walks","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3","excerpt":"a slow walk"}]}],"no_output_reason":null}'),
  'pass one lands marks that quote the writing');
reset role;
-- A bloom that quotes the entry about to be deleted (inserted directly; ingestion is covered in tending.sql).
insert into public.blooms(id,pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence) values
('abababab-abab-4bab-8bab-abababababa1','ffffffff-ffff-4fff-8fff-fffffffffff1','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',0,'connection','CANARY-BLOOM herons keep returning.',
  '[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea","excerpt":"CANARY-ALPHA revised"}]');
-- Pass two is dispatched to the provider and still in flight.
update private.pass_inputs set next_attempt_at=now()+interval '1 hour';
update private.pass_inputs set next_attempt_at=now() where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2';
set local role service_role;
select public.claim_garden_pass() as flight \gset
select lives_ok(format('select public.update_garden_job(%L::uuid,%L::uuid,%L,%L,null,true)',:'flight'::jsonb->>'id',:'flight'::jsonb->>'token','batch-two','file-two'),'pass two records its provider batch and file');
reset role;
-- Pass two never read Mornings, but carries copies: a remembered correction with quoted evidence,
-- a pruned interpretation, a pruned label, and titles in its orientation index.
update private.pass_inputs set
  corrections='[{"correction":"CANARY-CORRECTION not herons","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea","excerpt":"CANARY-ALPHA revised"}]},
    {"pruned":"connection","interpretation":"CANARY-BLOOM herons keep returning."},
    {"pruned":"theme","label":"Canary-Label"},
    {"correction":"keep me","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","excerpt":"light"}]}]',
  context='{"tiers":{"catalog":true},"index":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","title":"Leaving room","labels":["Canary-Label"]},
    {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","title":"CANARY-TITLE-TWO walks","labels":[]},
    {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc3","title":"Studio light","labels":[]}]}'
  where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2';
-- Pass four completes with a bloom in the second garden.
update private.pass_inputs set next_attempt_at=now()+interval '1 hour';
update private.pass_inputs set next_attempt_at=now() where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4';
set local role service_role;
select public.claim_garden_pass() as far \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,50,10,false)',:'far'::jsonb->>'id',:'far'::jsonb->>'token','{"blooms":[],"no_output_reason":null}'),'pass four completes');
reset role;
insert into public.blooms(id,pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence) values
('abababab-abab-4bab-8bab-abababababa4','ffffffff-ffff-4fff-8fff-fffffffffff4','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',0,'question','CANARY-FARBLOOM what is far away?',
  '[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5","excerpt":"a field far away"}]');
-- Pass six completes with a bloom of its own.
update private.pass_inputs set next_attempt_at=now()+interval '1 hour';
update private.pass_inputs set next_attempt_at=now() where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff6';
set local role service_role;
select public.claim_garden_pass() as orchard \gset
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,50,10,false)',:'orchard'::jsonb->>'id',:'orchard'::jsonb->>'token','{"blooms":[],"no_output_reason":null}'),'pass six completes');
reset role;
insert into public.blooms(id,pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence) values
('abababab-abab-4bab-8bab-abababababa6','ffffffff-ffff-4fff-8fff-fffffffffff6','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',0,'question','CANARY-ORCHBLOOM what do the old trees hold?',
  '[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7","excerpt":"old trees by the wall"}]');
-- Completed passes that never read Mornings can carry copies too.
-- Pass four: only its orientation index (titles and labels; never evidence).
update private.pass_inputs set context='{"tiers":{"catalog":true},"index":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","title":"Leaving room","labels":["Canary-Label"]},
    {"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","title":"CANARY-TITLE-TWO walks","labels":["Walks","keepme"]}]}'
  where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4';
-- Pass six: a remembered correction that quotes the second thought's entry, so the model read that text.
update private.pass_inputs set corrections='[{"correction":"not about walking","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3","excerpt":"a slow walk"}]}]'
  where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff6';
update private.pass_inputs set next_attempt_at=now()+interval '1 hour';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.bloom_responses(id,bloom_id,response,correction) values('acacacac-acac-4cac-8cac-acacacacaca1','abababab-abab-4bab-8bab-abababababa1','correct','CANARY-CORRECTION not herons');
insert into public.tending_mark_responses(id,mark_id,response) select 'adadadad-adad-4dad-8dad-adadadadada1',id,'keep' from public.tending_marks where seed_id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
select is((select count(*) from public.blooms),3::bigint,'the owner sees all three blooms before deleting anything');

-- Another tenant can delete nothing, and learns nothing.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","email":"delete-bob@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999997"}',true);
select is(public.deletion_preview('entry','dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),null::jsonb,'another tenant cannot preview an entry');
select is(public.deletion_preview('garden','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),null::jsonb,'another tenant cannot preview a garden');
select is(public.delete_entry('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')->>'deleted','false','another tenant cannot delete an entry');
select is(public.delete_seed('cccccccc-cccc-4ccc-8ccc-ccccccccccc1')->>'deleted','false','another tenant cannot delete a thought');
select is(public.delete_plot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Mornings')->>'deleted','false','another tenant cannot delete a topic');
select is(public.delete_garden('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Keep garden')->>'deleted','false','another tenant cannot delete a garden');
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'22023','confirmation does not match','another tenant cannot confirm with someone else''s address');
reset role;
select is((select count(*) from public.gardens where tenant_id='11111111-1111-4111-8111-111111111111'),2::bigint,'the first tenant''s gardens are untouched');
select is((select count(*) from public.seed_revisions where tenant_id='11111111-1111-4111-8111-111111111111'),7::bigint,'the first tenant''s revisions are untouched');
select is((select count(*) from public.blooms),3::bigint,'the first tenant''s blooms are untouched');
select ok((select snapshot<>'[]'::jsonb from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'the first tenant''s snapshots are untouched');
set local role anon;
select throws_ok($$select public.delete_entry('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')$$,'42501',null,'anonymous deletion is refused');
reset role;

-- The RPCs are the only way to erase: a direct delete would skip the scrubbing.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select throws_ok($$delete from public.seeds where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,'42501',null,'an owner cannot delete a thought directly');
select throws_ok($$delete from public.gardens where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,'42501',null,'an owner cannot delete a garden directly');
select throws_ok($$delete from public.entries where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1'$$,'42501',null,'an owner cannot delete an entry directly');
select throws_ok($$delete from public.plots where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$$,'42501',null,'an owner cannot delete a topic directly');
reset role;
select is((select count(*) from pg_catalog.pg_policies where schemaname='public' and cmd='DELETE'),0::bigint,'no table policy permits a direct delete');

-- (a) One entry, with every revision and everything derived from it.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999999"}',true);
select is(public.deletion_preview('entry','dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  '{"kind":"entry","name":"Leaving room","gardens":0,"topics":0,"thoughts":0,"entries":1,"versions":2,"returns":1,"responses":1,"marks":2}'::jsonb,'the preview counts what an entry deletion erases');
select is((select count(*) from public.entries),6::bigint,'previewing deletes nothing');
select is(public.delete_entry('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  '{"kind":"entry","name":"Leaving room","gardens":0,"topics":0,"thoughts":0,"entries":1,"versions":2,"returns":1,"responses":1,"marks":2,"deleted":true}'::jsonb,'the owner deletes an entry and receives the same counts');
select is(public.delete_entry('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')->>'deleted','false','deleting the same entry again is a no-op');
select is((select count(*) from public.current_entries where seed_id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),1::bigint,'the thought keeps its other entry');
select is((select count(*) from public.blooms where garden_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),0::bigint,'the owner no longer sees a return drawn from the entry');
reset role;
select is(pg_temp.hits('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),0::bigint,'no row anywhere still names the deleted entry');
select is(pg_temp.hits('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea'),0::bigint,'no row anywhere still cites its current revision');
select is(pg_temp.hits('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'),0::bigint,'no row anywhere still holds its earlier revision');
select is(pg_temp.hits('CANARY-ALPHA'),0::bigint,'no copy of the entry text survives in any table');
select is(pg_temp.hits('CANARY-BLOOM'),0::bigint,'the interpretation drawn from it is gone, including remembered copies');
select is(pg_temp.hits('CANARY-CORRECTION'),0::bigint,'the correction written about that return is gone, including remembered copies');
select is(pg_temp.hits('Canary-Label'),0::bigint,'the label drawn from it is gone, including remembered copies');
select is((select count(*) from public.tending_marks where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),0::bigint,'marks from the pass that read it are gone');
select is((select count(*) from public.tending_mark_responses),0::bigint,'responses to those marks are gone');
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'withdrawn','the pass that read it is withdrawn');
select is((select snapshot::text||corrections::text||context::text from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'[][]{}','its frozen input is emptied');
select ok((select cleanup_pending from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1'),'and its provider files are queued for cleanup');
-- An in-flight pass that never froze the entry but was sent copies of it (a quoted correction, a
-- pruned interpretation and label, its thought in the orientation index) is stopped, not merely scrubbed:
-- the request already at the provider contains them.
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'cancelled','an in-flight pass that was sent copies of the deleted entry is cancelled');
select is((select snapshot::text||corrections::text||context::text from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'[][]{}','its stored input is emptied');
select is((select cleanup_pending::text||'/'||provider_id||'/'||input_file_id from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'true/batch-two/file-two','its provider batch and file are queued for cancellation and deletion');
update private.pass_inputs set next_attempt_at=now()+interval '1 hour';
update private.pass_inputs set next_attempt_at=now() where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2';
set local role service_role;
select public.claim_garden_pass() as stopped \gset
select is(:'stopped'::jsonb->>'status','cancelled','the worker claims it for provider cleanup, not for work');
select is(public.check_garden_pass((:'stopped'::jsonb->>'id')::uuid,(:'stopped'::jsonb->>'token')::uuid),false,'it no longer passes the publication check');
select lives_ok(format('select public.finish_garden_pass(%L::uuid,%L::uuid,%L::jsonb,100,40,false)',:'stopped'::jsonb->>'id',:'stopped'::jsonb->>'token',
  '{"blooms":[],"marks":[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc3","kind":"theme","label":"light","evidence":[{"revision_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","excerpt":"CANARY-STUDIO light"}]}],"no_output_reason":null}'),
  'a provider result that arrives anyway is settled');
reset role;
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff2'),'cancelled','and the pass stays cancelled');
select is((select count(*) from public.tending_marks where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2'),0::bigint,'so nothing from it is published');
-- The worker then cancels the batch and deletes its files (covered by the runtime tests).
update private.pass_inputs set cleanup_pending=false,next_attempt_at=now()+interval '1 hour' where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff2';
-- A completed pass that carried only the orientation index keeps its bloom; the index is scrubbed.
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff4'),'complete','a completed pass that only listed the thought for orientation stays complete');
select is((select count(*) from public.blooms where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4'),1::bigint,'and keeps its bloom');
select is((select context->'index' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4'),
  '[{"seed_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","title":"CANARY-TITLE-TWO walks","labels":["keepme"]}]'::jsonb,
  'its index loses the entry''s thought, and loses a withdrawn pass''s label from a thought that survives');
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff6'),'complete','a completed pass with no copy of the entry is untouched');
select is(pg_temp.hits('CANARY-BETA'),1::bigint,'the sibling entry is intact');

-- (b) A thought with its entries.
set local role authenticated;
select is(public.deletion_preview('seed','cccccccc-cccc-4ccc-8ccc-ccccccccccc2'),
  '{"kind":"seed","name":"CANARY-TITLE-TWO walks","gardens":0,"topics":0,"thoughts":1,"entries":1,"versions":1,"returns":1,"responses":0,"marks":0}'::jsonb,
  'the preview counts a thought''s entries and the bloom of a completed pass that was sent its text');
select is(public.delete_seed('cccccccc-cccc-4ccc-8ccc-ccccccccccc2')->>'deleted','true','the owner deletes a thought');
select is(public.delete_seed('cccccccc-cccc-4ccc-8ccc-ccccccccccc2')->>'deleted','false','deleting the same thought again is a no-op');
reset role;
select is(pg_temp.hits('cccccccc-cccc-4ccc-8ccc-ccccccccccc2'),0::bigint,'no row anywhere still names the deleted thought');
select is(pg_temp.hits('dddddddd-dddd-4ddd-8ddd-ddddddddddd3'),0::bigint,'its entry is gone');
select is(pg_temp.hits('CANARY-GAMMA'),0::bigint,'no copy of its text survives');
select is(pg_temp.hits('CANARY-TITLE-TWO'),0::bigint,'no copy of its title survives, including in orientation indexes');
select is((select count(*) from public.seeds where id='cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),1::bigint,'its sibling thought is intact');
-- A completed pass whose model was sent a quote of the deleted text read that text: same rule as a pass that froze it.
select is((select status from public.garden_passes where id='ffffffff-ffff-4fff-8fff-fffffffffff6'),'withdrawn','a completed pass that was sent a quote of the deleted thought is withdrawn');
select is(pg_temp.hits('CANARY-ORCHBLOOM'),0::bigint,'and loses its bloom');
select is((select corrections::text from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff6'),'[]','and the quote');
select is((select count(*) from public.blooms where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4'),1::bigint,'the index-only pass still keeps its bloom');
select is((select context->'index' from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff4'),'[]'::jsonb,'with the deleted thought gone from its index');

-- A new pass over Studio is dispatched and in flight when its topic is deleted.
set local role authenticated;
insert into public.garden_passes(id,garden_id,plot_ids) values
('ffffffff-ffff-4fff-8fff-fffffffffff5','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2']::uuid[]);
reset role;
update private.pass_inputs set next_attempt_at=now()+interval '1 hour' where pass_id<>'ffffffff-ffff-4fff-8fff-fffffffffff5';
set local role service_role;
select public.claim_garden_pass() as flight \gset
select lives_ok(format('select public.update_garden_job(%L::uuid,%L::uuid,%L,%L,null,true)',:'flight'::jsonb->>'id',:'flight'::jsonb->>'token','batch-in-flight','file-in-flight'),'the new pass records its provider batch and file');
reset role;

-- (c) A topic with its thoughts; the in-flight pass leaves a provider orphan.
select reserved_cents as reserved_before,spent_cents as spent_before from private.ai_months \gset
select reserved_cents as flight_cost from private.pass_inputs where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff5' \gset
set local role authenticated;
select throws_ok($$select public.delete_plot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Mornings')$$,'22023','confirmation does not match','a topic is not deleted without its own name');
select is((select count(*) from public.plots where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),1::bigint,'a refused deletion erases nothing');
select is(public.delete_plot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',' Studio '),
  '{"kind":"plot","name":"Studio","gardens":0,"topics":1,"thoughts":1,"entries":1,"versions":1,"returns":0,"responses":0,"marks":0,"deleted":true}'::jsonb,'the owner deletes a topic by name');
select is(public.delete_plot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Studio')->>'deleted','false','deleting the same topic again is a no-op');
reset role;
select is(pg_temp.hits('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),0::bigint,'no row anywhere still names the deleted topic');
select is(pg_temp.hits('cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),0::bigint,'its thought is gone');
select is(pg_temp.hits('CANARY-STUDIO'),0::bigint,'no copy of its text survives, including the in-flight snapshot');
select is((select count(*) from public.garden_passes where scope_key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),0::bigint,'both passes scoped to the topic are gone');
select is((select provider_id||'/'||input_file_id from private.provider_orphans),'batch-in-flight/file-in-flight','its provider batch and file ids are kept for cleanup');
select is(pg_temp.hits('ffffffff-ffff-4fff-8fff-fffffffffff5'),0::bigint,'the orphan does not name the pass, tenant or garden');
select is((select reserved_cents from private.ai_months),(:reserved_before-:flight_cost)::numeric,'the deleted pass''s reservation is released');
select is((select spent_cents from private.ai_months),(:spent_before+:flight_cost)::numeric,'and counted as spend because the work reached the provider');

-- The backend drains orphans under a lease.
set local role authenticated;
select throws_ok($$select public.claim_provider_orphan()$$,'42501',null,'users cannot claim provider orphans');
reset role;
set local role service_role;
select public.claim_provider_orphan() as orphan \gset
select is(:'orphan'::jsonb->>'provider_id','batch-in-flight','the backend claims the orphan');
select is(public.claim_provider_orphan(),null::jsonb,'a leased orphan is not claimed twice');
select throws_ok(format('select public.resolve_provider_orphan(%L::uuid,%L::uuid,true)',:'orphan'::jsonb->>'id','00000000-0000-4000-8000-000000000000'),'P0001','lease lost','a wrong token cannot resolve it');
select lives_ok(format('select public.resolve_provider_orphan(%L::uuid,%L::uuid,false)',:'orphan'::jsonb->>'id',:'orphan'::jsonb->>'token'),'an unfinished cleanup is released for a later attempt');
select is(public.claim_provider_orphan(),null::jsonb,'a released orphan waits before its next attempt');
reset role;
update private.provider_orphans set next_attempt_at=now();
set local role service_role;
select public.claim_provider_orphan() as orphan \gset
select is(:'orphan'::jsonb->>'attempts','2','the second attempt is counted');
select lives_ok(format('select public.resolve_provider_orphan(%L::uuid,%L::uuid,true)',:'orphan'::jsonb->>'id',:'orphan'::jsonb->>'token'),'a finished cleanup resolves the orphan');
reset role;
select is((select count(*) from private.provider_orphans),0::bigint,'a resolved orphan is removed');
insert into private.provider_orphans(id,input_file_id,attempts) values('ababcdcd-abab-4bab-8bab-ababcdcdabab','file-stuck',20);
set local role service_role;
select is(public.claim_provider_orphan(),null::jsonb,'an orphan that failed twenty times is no longer retried');
reset role;
select is((select input_file_id from private.provider_orphans),'file-stuck','but its id is kept for an operator');
delete from private.provider_orphans;

-- (d) A garden.
set local role authenticated;
select throws_ok($$select public.delete_garden('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','second garden')$$,'22023','confirmation does not match','a garden is not deleted without its exact name');
select is(public.delete_garden('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Second garden'),
  '{"kind":"garden","name":"Second garden","gardens":1,"topics":2,"thoughts":2,"entries":2,"versions":2,"returns":1,"responses":0,"marks":0,"deleted":true}'::jsonb,'the owner deletes a garden by name');
select is(public.delete_garden('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Second garden')->>'deleted','false','deleting the same garden again is a no-op');
select is((select count(*) from public.gardens),1::bigint,'the other garden is intact');
reset role;
select is(pg_temp.hits('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),0::bigint,'no row anywhere still names the deleted garden');
select is(pg_temp.hits('ffffffff-ffff-4fff-8fff-fffffffffff4'),0::bigint,'its pass, inputs and blooms are gone');
select is(pg_temp.hits('CANARY-GARDENTWO'),0::bigint,'no copy of its text survives');
select is(pg_temp.hits('CANARY-FARBLOOM'),0::bigint,'no return drawn from it survives');

-- (e) The whole account. Pass one still has provider files waiting for cleanup.
update private.pass_inputs set provider_id='batch-account',input_file_id='file-account',output_file_id='file-account-out' where pass_id='ffffffff-ffff-4fff-8fff-fffffffffff1';
set local role authenticated;
select is(public.deletion_preview('account')->>'gardens','1','the account preview counts every garden');
select throws_ok($$select public.delete_account('delete my account')$$,'22023','confirmation does not match','an account is not deleted without its email address');
-- A token is not enough: its session must be live, this user's, and freshly signed in.
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated"}',true);
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'SGA01','recent sign-in required','a token without a session cannot delete the account');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999998"}',true);
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'SGA01','recent sign-in required','a session older than ten minutes cannot delete the account');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999997"}',true);
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'SGA01','recent sign-in required','another person''s session cannot delete the account');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","email":"delete-alice@example.test","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999999"}',true);
reset role;
update auth.sessions set not_after=now()-interval '1 second' where id='99999999-9999-4999-8999-999999999999';
set local role authenticated;
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'SGA01','recent sign-in required','an expired session cannot delete the account');
reset role;
-- Signed out everywhere: the session row is gone but the access token has not expired.
delete from auth.sessions where id='99999999-9999-4999-8999-999999999999';
set local role authenticated;
select throws_ok($$select public.delete_account('delete-alice@example.test')$$,'SGA01','recent sign-in required','a revoked session cannot delete the account');
reset role;
select is((select count(*) from auth.users where id='11111111-1111-4111-8111-111111111111'),1::bigint,'every refused attempt left the account whole');
-- A fresh sign-in.
insert into auth.sessions(id,user_id,created_at,updated_at) values('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111',now()-interval '1 minute',now());
set local role authenticated;
select is((select count(*) from public.gardens),1::bigint,'a refused account deletion erases nothing');
select is(public.delete_account(' Delete-Alice@Example.test '),
  '{"kind":"account","name":null,"gardens":1,"topics":1,"thoughts":1,"entries":1,"versions":1,"returns":0,"responses":0,"marks":0,"deleted":true}'::jsonb,'the owner deletes the account by email address');
-- The old access token may live a little longer; it can find and create nothing.
select is(public.delete_account('delete-alice@example.test')->>'deleted','false','deleting the same account again is a no-op');
select is((select count(*) from public.accounts),0::bigint,'the old session sees no account');
select throws_ok($$insert into public.accounts(id) values('11111111-1111-4111-8111-111111111111')$$,'23503',null,'the old session cannot recreate the account');
select throws_ok($$insert into public.gardens(name) values('Ghost garden')$$,'23503',null,'the old session cannot create a garden');
reset role;
select is((select count(*) from auth.users where id='11111111-1111-4111-8111-111111111111'),0::bigint,'the sign-in identity is removed');
select is((select count(*) from auth.sessions where user_id='11111111-1111-4111-8111-111111111111'),0::bigint,'its sessions are revoked');
select is(pg_temp.hits('11111111-1111-4111-8111-111111111111'),0::bigint,'no application row anywhere still belongs to the deleted account');
select is(pg_temp.hits('CANARY-'),0::bigint,'no canary text of the deleted account survives in any table');
select is((select provider_id||'/'||input_file_id||'/'||output_file_id from private.provider_orphans),'batch-account/file-account/file-account-out','provider ids pending cleanup outlive the account, content-free');
select is((select reserved_cents from private.ai_months),0::numeric,'no budget reservation is stranded');

-- The other tenant is whole.
select is((select count(*) from auth.users where id='22222222-2222-4222-8222-222222222222'),1::bigint,'the other tenant still has a sign-in identity');
select is((select count(*) from public.seed_revisions where tenant_id='22222222-2222-4222-8222-222222222222'),1::bigint,'the other tenant''s writing is intact');
select is(pg_temp.hits('BOB-CANARY'),1::bigint,'and unchanged');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"99999999-9999-4999-8999-999999999997"}',true);
select throws_ok($$select public.delete_account('delete-bob@example.test')$$,'22023','confirmation does not match','a session without an email claim needs the fallback phrase');
select is(public.delete_account('Delete my account')->>'deleted','true','the fallback phrase deletes an account whose session carries no email');
reset role;
select is(pg_temp.hits('22222222-2222-4222-8222-222222222222'),0::bigint,'and nothing of that account remains');
select * from finish();
rollback;

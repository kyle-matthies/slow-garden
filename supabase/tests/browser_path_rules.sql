-- Rules the browser data path relies on (20261116041903_browser_path_rules.sql).
-- Synthetic data only. Every refusal here was previously made only by a server action.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('41111111-1111-4111-8111-111111111111','rules-alice@example.test','{}','{}',now(),now()),
('42222222-2222-4222-8222-222222222222','rules-bob@example.test','{}','{}',now(),now());

-- The characters String.prototype.trim() removes, and near misses it keeps.
create temp table blank_chars(cp integer primary key);
insert into blank_chars select unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]);
create temp table kept_chars(cp integer primary key);
-- U+001C, U+0085 (NEL), U+180E, U+200B, U+200C, U+200D, U+2060: not whitespace to trim().
insert into kept_chars select unnest(array[28,133,6158,8203,8204,8205,8288]);
grant select on blank_chars,kept_chars to authenticated;

-- ---------------------------------------------------------------- hygiene
select ok(not has_function_privilege('anon','public.garden_capabilities()','execute')
  and not has_function_privilege('anon','public.import_thought(uuid,uuid,text,jsonb)','execute'),'anonymous visitors cannot call the new RPCs');
select ok(has_function_privilege('authenticated','public.garden_capabilities()','execute')
  and has_function_privilege('authenticated','public.import_thought(uuid,uuid,text,jsonb)','execute'),'signed-in owners can');
select is((select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where ((n.nspname='public' and p.proname in('garden_capabilities','import_thought'))
      or (n.nspname='private' and p.proname in('require_deletion_enabled','refuse_archived_parent','refuse_archived_writing','clean_area_name','clean_seed_title')))
    and p.prosecdef and p.proconfig @> array['search_path=""']),7::bigint,'every new privileged function is security definer with an empty search path');
select ok(not has_schema_privilege('authenticated','private','usage') and not has_schema_privilege('anon','private','usage'),'the private schema stays closed to users');
select ok(not has_function_privilege('authenticated','private.require_deletion_enabled()','execute')
  and not has_function_privilege('anon','private.trim_text(text)','execute'),'private helpers are not handed out beyond what constraints need');
select ok(not has_table_privilege('anon','private.deployment_switches','select')
  and not has_table_privilege('authenticated','private.deployment_switches','select,insert,update,delete'),'no API role holds a privilege on the deployment switches');
select ok(has_table_privilege('service_role','private.deployment_switches','select,update')
  and not has_table_privilege('service_role','private.deployment_switches','insert')
  and not has_table_privilege('service_role','private.deployment_switches','delete'),'the service role can read and flip a switch, not add or remove the row');
select ok((select relrowsecurity from pg_class where oid='private.deployment_switches'::regclass),'row level security is on for the switches');
select is((select deletion_enabled from private.deployment_switches),false,'deletion ships switched off');
select is((select count(*) from pg_constraint where conname in('seed_revisions_body_rule','bloom_responses_correction_rule') and not convalidated),
  2::bigint,'the two rules on append-only text are NOT VALID: enforced for new rows, never run against existing ones');
select is((select count(*) from pg_constraint c where c.contype='c' and c.conrelid in('public.gardens'::regclass,'public.plots'::regclass,'public.seeds'::regclass,'public.accounts'::regclass)
  and c.conname in('gardens_name_rule','plots_name_rule','seeds_title_rule','accounts_timezone_shape')),
  0::bigint,'no new check constraint sits on a table whose rows are updated, so a legacy row can still be archived');
select is((select prosecdef from pg_proc where oid='public.save_entry(uuid,uuid,uuid,text,uuid)'::regprocedure),false,'save_entry still runs as the caller, under row level security');
select ok(has_function_privilege('authenticated','public.save_entry(uuid,uuid,uuid,text,uuid)','execute')
  and not has_function_privilege('anon','public.save_entry(uuid,uuid,uuid,text,uuid)','execute'),'and keeps its grants');

-- ---------------------------------------------------------------- helpers
select is((select count(*) from blank_chars where private.trim_text(chr(cp))=''),25::bigint,'each of the 25 characters trim() removes is blank here');
select is((select count(*) from kept_chars where private.trim_text(chr(cp))=''),0::bigint,'zero-width and control characters trim() keeps are not blank here');
select is(private.trim_text((select string_agg(chr(cp),'' order by cp) from blank_chars)),'','a run of every blank character is blank');
select is(private.trim_text(E'\u00A0\uFEFF a\u3000b \u2028\t'),E'a\u3000b','trimming removes both ends and keeps the middle');
select is(private.utf16_length('abc'),3,'ASCII counts one unit each');
select is(private.utf16_length(E'\u00E9\u4E2D'),2,'other Basic Multilingual Plane characters count one unit each');
select is(private.utf16_length(E'a\U0001F600b\U0001D11E'),6,'characters outside the BMP count two units, as String.length does');
select is(private.utf16_length(''),0,'empty is zero');
select ok(private.is_calendar_date('2024-02-29') and private.is_calendar_date('0100-01-01') and private.is_calendar_date('9999-12-31'),'real calendar dates are accepted');
select ok(not private.is_calendar_date('2023-02-29') and not private.is_calendar_date('2026-13-01') and not private.is_calendar_date('2026-00-10')
  and not private.is_calendar_date('2026-1-1') and not private.is_calendar_date('0099-01-01') and not private.is_calendar_date('2026-01-01T00:00')
  and not private.is_calendar_date(null),'impossible, short, early and decorated dates are refused');

-- ---------------------------------------------------------------- fixtures
set local role authenticated;
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
insert into public.gardens(id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','Bob garden');
insert into public.plots(id,garden_id,name) values('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','Bob topic');
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
insert into public.gardens(id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Alice garden'),('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Alice shelf');
insert into public.plots(id,garden_id,name,ai_enabled) values
('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Open topic',true),
('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Shelved topic',false),
('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Shelf topic',false);
insert into public.seeds(id,garden_id,plot_id,title) values
('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Open thought'),
('4ccccccc-cccc-4ccc-8ccc-ccccccccccc2','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Shelved thought'),
('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','Shelf thought'),
('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Resting thought');
select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','4ddddddd-dddd-4ddd-8ddd-ddddddddddd1','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Synthetic rules source one.');
select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','4ddddddd-dddd-4ddd-8ddd-ddddddddddd5','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5','Synthetic rules source five.');
select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc2','4ddddddd-dddd-4ddd-8ddd-ddddddddddd2','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Synthetic rules source two.');
select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','4ddddddd-dddd-4ddd-8ddd-ddddddddddd3','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','Synthetic rules source three.');
select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','4ddddddd-dddd-4ddd-8ddd-ddddddddddd4','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4','Synthetic rules source four.');

-- ---------------------------------------------------------------- 1. capabilities and the deletion switch
select is(public.garden_capabilities(),'{"tending":false,"deletion":false}'::jsonb,'nothing is available by default');
select throws_ok($$select count(*) from private.deployment_switches$$,'42501',null,'a signed-in account cannot read the switches');
select throws_ok($$update private.deployment_switches set deletion_enabled=true$$,'42501',null,'a signed-in account cannot flip a switch');
reset role;
set local role anon;
select throws_ok($$select public.garden_capabilities()$$,'42501',null,'an anonymous visitor cannot ask');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.garden_capabilities()$$,'28000','authentication required','a session without an identity is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc9','T','[]')$$,'28000','authentication required','and cannot import');
reset role;

-- Runtime on, allowlist empty: still unavailable to everyone.
update private.ai_runtime set enabled=true,approved_at=now(),model='synthetic-test-model',workflow_version='tend-connect-v3-test';
set local role authenticated;
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
select is(public.garden_capabilities()->>'tending','false','runtime enabled but not allowlisted: tending unavailable');
reset role;
insert into private.ai_tenants(tenant_id) values('41111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(public.garden_capabilities(),'{"tending":true,"deletion":false}'::jsonb,'runtime enabled and allowlisted: tending available');
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
select is(public.garden_capabilities(),'{"tending":false,"deletion":false}'::jsonb,'another account learns nothing from the first account being allowlisted');
reset role;
update private.ai_runtime set enabled=false;
set local role authenticated;
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
select is(public.garden_capabilities()->>'tending','false','allowlisted but runtime disabled: tending unavailable');
select is((select array_agg(k order by k) from jsonb_object_keys(public.garden_capabilities()) k),array['deletion','tending'],'the answer is two booleans and nothing else');

-- Deletion off: every RPC refuses and nothing is erased.
select throws_ok($$select public.deletion_preview('entry','4ddddddd-dddd-4ddd-8ddd-ddddddddddd1')$$,'SGA03','deletion is not available','preview refuses while deletion is off');
select throws_ok($$select public.deletion_preview('account')$$,'SGA03','deletion is not available','account preview refuses while deletion is off');
select throws_ok($$select public.delete_entry('4ddddddd-dddd-4ddd-8ddd-ddddddddddd1')$$,'SGA03','deletion is not available','delete_entry refuses while deletion is off');
select throws_ok($$select public.delete_seed('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,'SGA03','deletion is not available','delete_seed refuses while deletion is off');
select throws_ok($$select public.delete_plot('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Open topic')$$,'SGA03','deletion is not available','delete_plot refuses while deletion is off');
select throws_ok($$select public.delete_garden('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Alice garden')$$,'SGA03','deletion is not available','delete_garden refuses while deletion is off');
select throws_ok($$select public.delete_account('rules-alice@example.test')$$,'SGA03','deletion is not available','delete_account refuses while deletion is off');
select throws_ok($$select public.delete_entry('4ddddddd-dddd-4ddd-8ddd-dddddddddd99')$$,'SGA03','deletion is not available','the refusal does not depend on the item existing');
select is((select count(*) from public.entries),5::bigint,'nothing was erased');
reset role;
-- The service role is the operator's hand on the switch.
set local role service_role;
select lives_ok($$update private.deployment_switches set deletion_enabled=true$$,'the service role can switch deletion on');
select throws_ok($$insert into private.deployment_switches(singleton) values(false)$$,'42501',null,'and cannot add a second row');
reset role;
set local role authenticated;
select is(public.garden_capabilities()->>'deletion','true','the switch is what capabilities report');
select is(public.deletion_preview('entry','4ddddddd-dddd-4ddd-8ddd-ddddddddddd5')->>'entries','1','preview answers once deletion is on');
select is(public.delete_entry('4ddddddd-dddd-4ddd-8ddd-ddddddddddd5')->>'deleted','true','and deletion works');
select is((select count(*) from public.entries),4::bigint,'exactly that entry is gone');
reset role;
delete from private.deployment_switches;
set local role authenticated;
select is(public.garden_capabilities()->>'deletion','false','a missing switch row reads as off');
select throws_ok($$select public.delete_entry('4ddddddd-dddd-4ddd-8ddd-ddddddddddd1')$$,'SGA03','deletion is not available','and refuses');
reset role;
insert into private.deployment_switches(singleton) values(true);

-- ---------------------------------------------------------------- 2. bloom responses
update private.ai_runtime set enabled=true,workflow_version='connect-v2-test';
set local role authenticated;
insert into public.garden_passes(id,garden_id,plot_ids) values('4fffffff-ffff-4fff-8fff-fffffffffff1','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[]);
reset role;
update public.garden_passes set status='complete',finished_at=now() where id='4fffffff-ffff-4fff-8fff-fffffffffff1';
insert into public.blooms(id,pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence)
  values('49999999-9999-4999-8999-999999999991','4fffffff-ffff-4fff-8fff-fffffffffff1','41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',0,'question','A synthetic question?',
    '[{"revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","excerpt":"Synthetic rules"}]');
set local role authenticated;
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','correct',null)$$,
  '23514',null,'a correct response without a correction is refused');
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','correct','')$$,
  '23514',null,'a correct response with empty text is refused');
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','correct',E' \t\n ')$$,
  '23514',null,'a correct response with spaces, tabs and newlines is refused');
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','correct',E'\u00A0\u3000\uFEFF\u2003')$$,
  '23514',null,'a correct response with only Unicode whitespace is refused');
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','keep','Stray text')$$,
  '23514',null,'a keep response cannot carry a correction');
select throws_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','prune','')$$,
  '23514',null,'a prune response cannot carry even an empty correction');
select lives_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values('48888888-8888-4888-8888-888888888881','49999999-9999-4999-8999-999999999991','correct',E'  In my own words.\n')$$,
  'a correct response with text is stored');
select is((select correction from public.bloom_responses where id='48888888-8888-4888-8888-888888888881'),E'  In my own words.\n','exactly as written');
select lives_ok($$insert into public.bloom_responses(id,bloom_id,response) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','keep')$$,'keep without a correction is stored');
select lives_ok($$insert into public.bloom_responses(id,bloom_id,response) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','prune')$$,'prune without a correction is stored');
select lives_ok($$insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'49999999-9999-4999-8999-999999999991','correct',E'\u200B')$$,
  'a zero-width space is not blank to trim(), so it is not blank here either');
reset role;
update private.ai_runtime set enabled=false;

-- ---------------------------------------------------------------- 4 and 8. blank text and lengths
set local role authenticated;
select throws_ok(format($$insert into public.gardens(name) values(repeat(chr(%s),3))$$,cp),'23514','choose a short name',format('a garden name of only U+%s is refused',upper(lpad(to_hex(cp),4,'0'))))
  from blank_chars order by cp;
select lives_ok(format($$insert into public.gardens(name) values(chr(%s))$$,cp),format('a garden name of U+%s is not blank to trim() and is accepted',upper(lpad(to_hex(cp),4,'0'))))
  from kept_chars order by cp;
select throws_ok($$insert into public.gardens(name) values('')$$,'23514','choose a short name','an empty garden name is refused');
select throws_ok($$insert into public.plots(garden_id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',E'\t\n')$$,'23514','choose a short name','a tab-and-newline topic name is refused');
select throws_ok($$insert into public.plots(garden_id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',E'\u00A0\u202F\uFEFF')$$,'23514','choose a short name','a non-breaking topic name is refused');
select throws_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',E'\n\u2028\u3000')$$,'23514','choose a short name','a whitespace-only thought title is refused');
select throws_ok($$update public.gardens set name=E' \u00A0 ' where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,'23514','choose a short name','renaming to whitespace is refused');
select throws_ok($$update public.seeds set title=E'\t' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,'23514','choose a short name','retitling to whitespace is refused');
select is((select name from public.gardens where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'Alice garden','and the name is unchanged');

insert into public.gardens(id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',E'\u00A0 Padded  garden\t\n');
select is((select name from public.gardens where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),'Padded  garden','a garden name is stored trimmed, inner spacing kept');
insert into public.plots(id,garden_id,name) values('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',E'\uFEFFPadded topic ');
select is((select name from public.plots where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'),'Padded topic','a topic name is stored trimmed');
insert into public.seeds(id,garden_id,plot_id,title) values('4ccccccc-cccc-4ccc-8ccc-ccccccccccc5','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',E'\u3000Padded thought\u2029');
select is((select title from public.seeds where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc5'),'Padded thought','a thought title is stored trimmed');
update public.plots set name=E'  Renamed topic\n' where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
select is((select name from public.plots where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'),'Renamed topic','a rename is stored trimmed');

select lives_ok($$insert into public.gardens(name) values(repeat('a',120))$$,'a 120-character garden name is accepted');
select throws_ok($$insert into public.gardens(name) values(repeat('a',121))$$,'23514','choose a short name','121 characters is refused');
select throws_ok($$insert into public.gardens(name) values('  '||repeat('a',119))$$,'23514','choose a short name','121 units before trimming is refused, as the web refuses it');
select lives_ok($$insert into public.gardens(name) values(repeat(E'\U0001F331',60))$$,'60 emoji are 120 UTF-16 units and are accepted');
select throws_ok($$insert into public.gardens(name) values(repeat(E'\U0001F331',61))$$,'23514','choose a short name','61 emoji are 122 UTF-16 units and are refused, though only 61 characters');
select throws_ok($$insert into public.plots(garden_id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',repeat('b',121))$$,'23514','choose a short name','a 121-character topic name is refused');
select lives_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('c',160))$$,'a 160-character title is accepted');
select throws_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat('c',161))$$,'23514','choose a short name','a 161-character title is refused');
select throws_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',repeat(E'\U0001F331',81))$$,'23514','choose a short name','81 emoji are 162 UTF-16 units and are refused as a title');

select throws_ok(format($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat(chr(%s),2))$$,cp),'23514',null,format('an entry of only U+%s is refused',upper(lpad(to_hex(cp),4,'0'))))
  from blank_chars order by cp;
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),'')$$,'23514',null,'an empty entry is refused');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','4ddddddd-dddd-4ddd-8ddd-ddddddddddd6','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee6',E'\n  Indented synthetic body.\n\n')$$,'an entry with surrounding whitespace is accepted');
select is((select body from public.seed_revisions where id='4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee6'),E'\n  Indented synthetic body.\n\n','and stored exactly as written: bodies are never trimmed');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat('d',20000))$$,'a 20,000-character entry is accepted');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat('d',20001))$$,'23514',null,'20,001 characters is refused');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),'  '||repeat('d',19999)||'  ')$$,'23514',null,'padding counts toward the 20,000, as on the web');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat(E'\U0001F331',10000))$$,'10,000 emoji are 20,000 UTF-16 units and are accepted');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat(E'\U0001F331',10000)||'x')$$,'23514',null,'one more unit is refused, though only 10,001 characters');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,revision_number,body,created_by)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',900,E'\n\n','41111111-1111-4111-8111-111111111111')$$,
  '23514',null,'a direct insert of a blank revision is refused too');

select lives_ok($$update public.accounts set timezone='America/Argentina/Buenos_Aires' where id='41111111-1111-4111-8111-111111111111'$$,'a zone the web accepts is accepted');
select throws_ok($$update public.accounts set timezone='posix/America/Argentina/Buenos_Aires' where id='41111111-1111-4111-8111-111111111111'$$,'22023','unknown time zone','a real zone the web refuses for its shape is refused, with the existing message');
select throws_ok($$update public.accounts set timezone=' UTC' where id='41111111-1111-4111-8111-111111111111'$$,'22023','unknown time zone','an unknown zone is still refused by the existing trigger');
reset role;
-- Rows written before these rules (simulated by writing with triggers off) keep working as they are.
set local session_replication_role=replica;
insert into public.gardens(id,tenant_id,name) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','41111111-1111-4111-8111-111111111111',E'\t');
insert into public.plots(id,tenant_id,garden_id,name) values('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9','41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','  Padded legacy topic  ');
insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values('4ccccccc-cccc-4ccc-8ccc-ccccccccccc9','41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9',E'\n');
update public.accounts set timezone='posix/America/Argentina/Buenos_Aires' where id='42222222-2222-4222-8222-222222222222';
set local session_replication_role=origin;
set local role authenticated;
select lives_ok($$update public.gardens set status='archived',archived_at=now() where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'a legacy garden with a blank name can still be archived');
select lives_ok($$update public.gardens set status='active',archived_at=null where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'and restored');
select lives_ok($$update public.plots set ai_enabled=true where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9'$$,'a legacy padded topic can still change its settings');
select is((select name from public.plots where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9'),'  Padded legacy topic  ','and keeps its name exactly');
select lives_ok($$update public.seeds set status='archived',archived_at=now() where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc9'$$,'a legacy thought with a blank title can still be archived');
select lives_ok($$update public.seeds set status='active',archived_at=null where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc9'$$,'and restored');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc9',gen_random_uuid(),gen_random_uuid(),'Writing in a legacy thought still works.')$$,'and written in');
select is((select name from public.gardens where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'),E'\t','the legacy name is untouched');
select throws_ok($$update public.gardens set name=E'\n' where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'23514','choose a short name','renaming it to another blank name is refused');
select lives_ok($$update public.gardens set name='Named at last' where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'$$,'renaming it properly works');
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
select lives_ok($$update public.accounts set tend_overnight=true where id='42222222-2222-4222-8222-222222222222'$$,'an account with a legacy time zone can still change its other preferences');
select is((select timezone from public.accounts where id='42222222-2222-4222-8222-222222222222'),'posix/America/Argentina/Buenos_Aires','and keeps the zone');
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
reset role;

-- ---------------------------------------------------------------- 6. source dates
select ok(not has_column_privilege('authenticated','public.entries','created_at','update')
  and not has_column_privilege('authenticated','public.entries','created_at','insert')
  and not has_column_privilege('authenticated','public.seed_revisions','created_at','insert')
  and not has_table_privilege('authenticated','public.seed_revisions','update'),'the owner holds no privilege to write a source date');
select ok(not has_column_privilege('authenticated','public.gardens','created_at','insert') and not has_column_privilege('authenticated','public.gardens','created_at','update')
  and not has_column_privilege('authenticated','public.plots','created_at','insert') and not has_column_privilege('authenticated','public.plots','created_at','update')
  and not has_column_privilege('authenticated','public.seeds','created_at','insert') and not has_column_privilege('authenticated','public.seeds','created_at','update')
  and not has_column_privilege('authenticated','public.gardens','updated_at','update') and not has_column_privilege('authenticated','public.seeds','updated_at','update')
  and not has_column_privilege('authenticated','public.plots','permission_version','update'),'nor a garden, topic or thought date, nor a permission version');
select ok(has_column_privilege('authenticated','public.gardens','name','update') and has_column_privilege('authenticated','public.gardens','archived_at','update')
  and has_column_privilege('authenticated','public.plots','ai_enabled','update') and has_column_privilege('authenticated','public.plots','cross_pollinate','update')
  and has_column_privilege('authenticated','public.seeds','title','update') and has_column_privilege('authenticated','public.seeds','status','update')
  and has_column_privilege('authenticated','public.seeds','position_x','insert'),'everything the web writes keeps its privilege');
select ok(has_column_privilege('authenticated','public.entries','archived_at','update')
  and has_column_privilege('authenticated','public.entries','id','insert')
  and has_column_privilege('authenticated','public.seed_revisions','body','insert'),'archiving and ordinary writing keep their privileges');
set local role authenticated;
select throws_ok($$update public.entries set created_at='2001-01-01T12:00:00Z' where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd1'$$,'42501',null,'an owner cannot backdate an entry directly');
select throws_ok($$update public.entries set created_at=now()+interval '10 years',archived_at=null where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd1'$$,'42501',null,'nor postdate one alongside another change');
select throws_ok($$insert into public.entries(id,garden_id,seed_id,created_at) values(gen_random_uuid(),'4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','2001-01-01T12:00:00Z')$$,'42501',null,'nor insert an entry with a chosen date');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,revision_number,body,created_by,created_at)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1',901,'Dated revision','41111111-1111-4111-8111-111111111111','2001-01-01T12:00:00Z')$$,
  '42501',null,'nor insert a revision with a chosen date');
select throws_ok($$update public.gardens set created_at='2001-01-01T12:00:00Z' where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,'42501',null,'an owner cannot move a garden date');
select throws_ok($$update public.plots set created_at='2001-01-01T12:00:00Z' where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$$,'42501',null,'nor a topic date');
select throws_ok($$update public.seeds set created_at=now()+interval '10 years' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,'42501',null,'nor a thought date');
select throws_ok($$insert into public.gardens(name,created_at) values('Dated garden','2001-01-01T12:00:00Z')$$,'42501',null,'nor create a garden with a chosen date');
select throws_ok($$insert into public.seeds(garden_id,plot_id,title,created_at) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Dated thought','2001-01-01T12:00:00Z')$$,'42501',null,'nor a thought with a chosen date');
-- Revision numbers are the database's.
select lives_ok($$insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  values('4eeeeeee-eeee-4eee-8eee-eeeeeeeeee77','41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','4ddddddd-dddd-4ddd-8ddd-ddddddddddd4',2147483647,'Direct insert with the largest number.','41111111-1111-4111-8111-111111111111')$$,
  'a direct revision insert asking for number 2147483647 is accepted');
select is((select revision_number from public.seed_revisions where id='4eeeeeee-eeee-4eee-8eee-eeeeeeeeee77'),2,'but is given the next number for its thought');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','4ddddddd-dddd-4ddd-8ddd-ddddddddddd4','4eeeeeee-eeee-4eee-8eee-eeeeeeeeee78','The next save still works.','4eeeeeee-eeee-4eee-8eee-eeeeeeeeee77')$$,
  'so the next save on that thought still works');
select is((select array_agg(revision_number order by revision_number) from public.seed_revisions where seed_id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc4'),array[1,2,3],'and numbers stay in sequence');
select throws_ok($$update public.seed_revisions set revision_number=9 where id='4eeeeeee-eeee-4eee-8eee-eeeeeeeeee77'$$,'42501',null,'a revision can still not be changed afterwards');
select lives_ok($$update public.entries set archived_at=now() where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd6'$$,'archiving an entry still works');
select lives_ok($$update public.entries set archived_at=null where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd6'$$,'and restoring it');
select ok((select created_at>now()-interval '1 minute' from public.entries where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd1'),'an ordinary save is dated by the database');
select lives_ok($$select public.create_seed('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Legacy create_seed still writes.')$$,'the original create_seed API still works under the column grants');

-- ---------------------------------------------------------------- 3. archived places
update public.plots set archived_at=now() where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
update public.gardens set status='archived',archived_at=now() where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
update public.seeds set status='archived',archived_at=now() where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc4';
update public.entries set archived_at=now() where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd6';
select throws_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','New in archived topic')$$,
  'SGA02','this topic is archived; restore it to write here','a new thought in an archived topic is refused, and told why');
select throws_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','New in archived garden')$$,
  'SGA02','this garden is archived; restore it to write here','a new thought in an archived garden is refused, and told why');
select throws_ok($$select public.create_seed('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Legacy path into an archived garden')$$,
  'SGA02','this garden is archived; restore it to write here','the original create_seed API is refused there too');
select throws_ok($$update public.seeds set plot_id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,
  'SGA02','this topic is archived; restore it to write here','an existing thought cannot be moved into an archived topic');
select throws_ok($$update public.seeds set garden_id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',plot_id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,
  '42501',null,'nor into another garden at all: the owner holds no privilege to change a thought''s garden');
select is((select plot_id from public.seeds where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'),'4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid,'it stays where it was');
select lives_ok($$update public.seeds set title='Retitled where it is' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc2'$$,'a thought already in an archived topic can still be retitled or archived: only the move is refused');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3',gen_random_uuid(),gen_random_uuid(),'New entry in an archived garden')$$,
  'SGA02','this garden is archived; restore it to write here','a new entry in an archived garden is refused');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','4ddddddd-dddd-4ddd-8ddd-ddddddddddd3',gen_random_uuid(),'Revision in an archived garden','4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3')$$,
  'SGA02','this garden is archived; restore it to write here','revising an entry in an archived garden is refused');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc2',gen_random_uuid(),gen_random_uuid(),'New entry in an archived topic')$$,
  'SGA02','this topic is archived; restore it to write here','a new entry in an archived topic is refused');
select throws_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4',gen_random_uuid(),gen_random_uuid(),'New entry in an archived thought')$$,
  'SGA02','this thought is archived; restore it to write here','a new entry in an archived thought is refused');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','4ddddddd-dddd-4ddd-8ddd-ddddddddddd3',902,'Direct insert, archived garden','41111111-1111-4111-8111-111111111111')$$,
  'SGA02','this garden is archived; restore it to write here','a direct revision insert in an archived garden is refused');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc2','4ddddddd-dddd-4ddd-8ddd-ddddddddddd2',902,'Direct insert, archived topic','41111111-1111-4111-8111-111111111111')$$,
  'SGA02','this topic is archived; restore it to write here','a direct revision insert in an archived topic is refused');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','4ddddddd-dddd-4ddd-8ddd-ddddddddddd4',903,'Direct insert, archived thought','41111111-1111-4111-8111-111111111111')$$,
  'SGA02','this thought is archived; restore it to write here','a direct revision insert in an archived thought is refused');
select throws_ok($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by)
  values('41111111-1111-4111-8111-111111111111','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','4ddddddd-dddd-4ddd-8ddd-ddddddddddd6',904,'Direct insert, archived entry','41111111-1111-4111-8111-111111111111')$$,
  'SGA02','this entry is archived; restore it to write here','a direct revision insert on an archived entry is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','4ccccccc-cccc-4ccc-8ccc-cccccccccc91','Import into archived topic',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic import','date',null)))$$,
  'SGA02','choose an active topic','an import into an archived topic is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','4ccccccc-cccc-4ccc-8ccc-cccccccccc92','Import into archived garden',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic import','date',null)))$$,
  'SGA02','choose an active topic','an import into a topic of an archived garden is refused');
select is((select count(*) from public.seeds where id in('4ccccccc-cccc-4ccc-8ccc-cccccccccc91','4ccccccc-cccc-4ccc-8ccc-cccccccccc92')),0::bigint,'and leaves nothing behind');

-- One answer for a thought that is missing and one that is another account's, whatever its state.
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
insert into public.seeds(id,garden_id,plot_id,title) values('4ccccccc-cccc-4ccc-8ccc-cccccccccbb1','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','Bob probe thought');
select throws_ok(format($$insert into public.seed_revisions(tenant_id,garden_id,seed_id,revision_number,body,created_by)
  values('42222222-2222-4222-8222-222222222222','4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab0',%L,1,'Synthetic probe','42222222-2222-4222-8222-222222222222')$$,seed),
  '23503',null,format('a revision aimed at %s is refused by the foreign key',label))
  from (values('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','another account''s active thought'),
    ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','another account''s archived thought'),
    ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','another account''s thought in an archived garden'),
    ('4ccccccc-cccc-4ccc-8ccc-cccccccccfff','a thought that does not exist')) v(seed,label);
select throws_ok(format($$select public.save_entry(%L,gen_random_uuid(),gen_random_uuid(),'Synthetic probe')$$,seed),
  '42501','seed unavailable',format('save_entry on %s says only that it is unavailable',label))
  from (values('4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','another account''s active thought'),
    ('4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','another account''s archived thought'),
    ('4ccccccc-cccc-4ccc-8ccc-cccccccccfff','a thought that does not exist')) v(seed,label);
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);

update public.plots set archived_at=null where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
update public.gardens set status='active',archived_at=null where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select lives_ok($$insert into public.seeds(garden_id,plot_id,title) values('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','After restoring the topic')$$,'a restored topic takes new thoughts again');
select lives_ok($$select public.save_entry('4ccccccc-cccc-4ccc-8ccc-ccccccccccc3',gen_random_uuid(),gen_random_uuid(),'After restoring the garden')$$,'a restored garden takes new entries again');
select lives_ok($$update public.seeds set plot_id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$,'and a thought can be moved into the restored topic');
update public.seeds set plot_id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccc1';

-- ---------------------------------------------------------------- 5. import
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd1',E'  Imported thought\n',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef1","body":"Imported synthetic one.","date":"2019-03-04"},
    {"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde2","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef2","body":"Imported synthetic two.","date":null},
    {"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde3","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef3","body":"Imported synthetic three."}]'),
  '{"id":"4ccccccc-cccc-4ccc-8ccc-ccccccccccd1","created":3,"skipped":0}'::jsonb,'an import creates the thought and its entries and reports them');
select is((select title from public.seeds where id='4ccccccc-cccc-4ccc-8ccc-ccccccccccd1'),'Imported thought','the title is stored trimmed');
select is((select created_at from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde1'),'2019-03-04T12:00:00Z'::timestamptz,'a dated entry is backdated to noon UTC of its day');
select ok((select created_at>now()-interval '1 minute' from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde2'),'an undated entry is dated now');
select is((select array_agg(revision_number order by revision_number) from public.seed_revisions where seed_id='4ccccccc-cccc-4ccc-8ccc-ccccccccccd1'),array[1,2,3],'entries keep the order they were sent in');
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd1','Imported thought',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef1","body":"Imported synthetic one.","date":"2001-01-01"},
    {"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde2","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef2","body":"Imported synthetic two.","date":"2001-01-01"},
    {"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde4","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef4","body":"Imported synthetic four.","date":"2020-01-01"}]'),
  '{"id":"4ccccccc-cccc-4ccc-8ccc-ccccccccccd1","created":1,"skipped":2}'::jsonb,'a replay skips what exists and adds what is new');
select is((select count(*) from public.seed_revisions where seed_id='4ccccccc-cccc-4ccc-8ccc-ccccccccccd1'),4::bigint,'without duplicating anything');
select is((select created_at from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde1'),'2019-03-04T12:00:00Z'::timestamptz,'a replay with a different date leaves the dated entry''s date alone');
select ok((select created_at>now()-interval '1 minute' from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde2'),'and does not date the undated one');

-- An entry that already exists is never re-dated or added to (review finding 1).
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','Replay of ordinary writing',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","body":"Synthetic rules source one.","date":"2001-01-01"}]'),
  '{"id":"4ccccccc-cccc-4ccc-8ccc-ccccccccccc1","created":0,"skipped":1}'::jsonb,'replaying an ordinary, non-imported entry with a date is a no-op');
select ok((select created_at>now()-interval '1 minute' from public.entries where id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd1'),'its date did not move');
select is((select count(*) from public.seed_revisions where entry_id='4ddddddd-dddd-4ddd-8ddd-ddddddddddd1'),1::bigint,'and it gained no revision');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','New revision on an existing entry',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeee91","body":"Synthetic addition.","date":"2001-01-01"}]')$$,
  '22023','request identifier already used','an existing entry cannot be given a new revision or date through import');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','Replay under another entry',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddd92","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","body":"Synthetic rules source one.","date":"2001-01-01"}]')$$,
  '22023','request identifier already used','a revision cannot be replayed under a different entry');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','4ccccccc-cccc-4ccc-8ccc-ccccccccccc1','Wrong topic',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","body":"Synthetic rules source one.","date":"2001-01-01"}]')$$,
  '42501','seed unavailable','an existing thought must be in the topic named');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccc4','Archived thought',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd4","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","body":"Synthetic rules source four.","date":"2001-01-01"}]')$$,
  'SGA02','this thought is archived; restore it to write here','an archived thought is refused even for a pure replay');
update public.plots set archived_at=now() where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','4ccccccc-cccc-4ccc-8ccc-ccccccccccc2','Archived topic replay',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd2","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2","body":"Synthetic rules source two.","date":"2001-01-01"}]')$$,
  'SGA02','choose an active topic','a replay in an archived topic is refused before anything is read');
update public.plots set archived_at=null where id='4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
update public.gardens set status='archived',archived_at=now() where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','4ccccccc-cccc-4ccc-8ccc-ccccccccccc3','Archived garden replay',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddd3","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3","body":"Synthetic rules source three.","date":"2001-01-01"}]')$$,
  'SGA02','choose an active topic','and in an archived garden');
update public.gardens set status='active',archived_at=null where id='4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
select is((select count(*) from public.entries where created_at<'2010-01-01' or created_at>now()),0::bigint,'no entry anywhere was moved to the past or the future by those attempts');
-- Dates are never in the future.
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Far future',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date','9999-12-31')))$$,'22023','check the topic and entries','a date in the far future is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Two days ahead',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',to_char((now() at time zone 'UTC')::date+2,'YYYY-MM-DD'))))$$,'22023','check the topic and entries','a date two days ahead of UTC is refused');
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd5','Tomorrow somewhere',
  jsonb_build_array(jsonb_build_object('entry_id','4ddddddd-dddd-4ddd-8ddd-dddddddddd51','revision_id','4eeeeeee-eeee-4eee-8eee-eeeeeeeeee51','body','Synthetic dated tomorrow in UTC.','date',to_char((now() at time zone 'UTC')::date+1,'YYYY-MM-DD')),
    jsonb_build_object('entry_id','4ddddddd-dddd-4ddd-8ddd-dddddddddd52','revision_id','4eeeeeee-eeee-4eee-8eee-eeeeeeeeee52','body','Synthetic dated today in UTC.','date',to_char((now() at time zone 'UTC')::date,'YYYY-MM-DD'))))->>'created',
  '2','tomorrow''s UTC date (today somewhere on earth) and today''s are accepted');
select is((select count(*) from public.entries where id in('4ddddddd-dddd-4ddd-8ddd-dddddddddd51','4ddddddd-dddd-4ddd-8ddd-dddddddddd52') and created_at>now()),0::bigint,'and neither entry is dated after the moment it was imported');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd1','Imported thought',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde5","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef5","body":"Imported synthetic five.","date":null},
    {"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef1","body":"Different text under a used identifier.","date":null}]')$$,
  '22023','request identifier already used','a reused identifier with different text is refused');
select is((select count(*) from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde5'),0::bigint,'and the whole import is rolled back: no partial result');

-- Limits.
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Too many',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic '||n,'date',null)) from generate_series(1,501) n))$$,
  '22023','check the topic and entries','501 entries are refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'None','[]')$$,'22023','check the topic and entries','no entries are refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Not a list','{"entry_id":"x"}')$$,'22023','check the topic and entries','entries must be a list');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Null list',null)$$,'22023','check the topic and entries','a missing list is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),E'\u00A0\t',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'22023','check the topic and entries','a blank title is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),repeat('t',161),
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'22023','check the topic and entries','a 161-character title is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Blank body',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',E'\n\u3000','date',null)))$$,'22023','check the topic and entries','a blank body is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Long body',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',repeat('e',20001),'date',null)))$$,'22023','check the topic and entries','a 20,001-character body is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Body not text',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',7,'date',null)))$$,'22023','check the topic and entries','a body that is not text is refused');
select throws_ok(format($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Bad date',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',%L)))$$,d),'22023','check the topic and entries',format('the date %s is refused',d))
  from unnest(array['2026-02-30','2026-1-1','0099-01-01','2026-01-01T12:00:00Z','yesterday','']) d;
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Date not text',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',20260101)))$$,'22023','check the topic and entries','a date that is not text is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Bad id',
  jsonb_build_array(jsonb_build_object('entry_id','not-a-uuid','revision_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'22023','check the topic and entries','a malformed identifier is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Missing id',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'22023','check the topic and entries','a missing identifier is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Unknown key',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null,'created_at','2001-01-01')))$$,'22023','check the topic and entries','an entry with a key the import does not know is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Padding key',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null,'padding',repeat('z',2000000))))$$,'22023','check the topic and entries','so bytes cannot be carried in uncounted keys');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Entry not an object',
  '["just text"]')$$,'22023','check the topic and entries','an entry that is not an object is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'T',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',repeat('"',19000)||'x','date',null)) from generate_series(1,40) n))$$,
  '22023','import too large','the whole payload is counted as it travels: 40 entries of quotation marks are under the text limit but twice it on the wire');
select throws_ok($$select public.import_thought(null,gen_random_uuid(),'No topic',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'22023','check the topic and entries','a missing topic is refused');
select throws_ok($$select public.import_thought(gen_random_uuid(),gen_random_uuid(),'Unknown topic',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic','date',null)))$$,'SGA02','choose an active topic','an unknown topic is refused like an archived one');
-- Total size: title plus bodies, in UTF-8 bytes, at most 1,048,576.
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd2','T',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',case when n<=52 then repeat('f',20000) else repeat('f',8575) end,'date',null)) from generate_series(1,53) n))->>'created',
  '53','an import of exactly 1,048,576 bytes is accepted');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'T',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',case when n<=52 then repeat('f',20000) else repeat('f',8576) end,'date',null)) from generate_series(1,53) n))$$,
  '22023','import too large','one byte more is refused');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'T',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body',repeat(E'\u4E2D',20000),'date',null)) from generate_series(1,18) n))$$,
  '22023','import too large','bytes are counted, not characters: 18 entries of 20,000 three-byte characters are refused');

-- The cap is per call: a thought can grow over several imports.
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd6','Large thought',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic first batch '||n,'date','2015-05-05')) from generate_series(1,500) n))->>'created','500','500 entries in one call are accepted');
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','4ccccccc-cccc-4ccc-8ccc-ccccccccccd6','Large thought',
  (select jsonb_agg(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic second batch '||n,'date',null)) from generate_series(1,500) n))->>'created','500','and a second call may add 500 more to the same thought');
select is((select count(*) from public.entries where seed_id='4ccccccc-cccc-4ccc-8ccc-ccccccccccd6'),1000::bigint,'the limit is per call, not per thought');

-- Another account.
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',gen_random_uuid(),'Into another account',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic trespass','date',null)))$$,
  'SGA02','choose an active topic','another account cannot import into this account''s topic, and learns only what an unknown topic says');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','4ccccccc-cccc-4ccc-8ccc-ccccccccccd1','Onto another thought',
  jsonb_build_array(jsonb_build_object('entry_id',gen_random_uuid(),'revision_id',gen_random_uuid(),'body','Synthetic trespass','date',null)))$$,
  '42501','seed unavailable','nor name this account''s thought from its own topic');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','4ccccccc-cccc-4ccc-8ccc-ccccccccccd3','Reusing identifiers',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-dddddddddde1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef9","body":"Synthetic trespass","date":"2001-01-01"}]')$$,
  '22023','request identifier already used','nor write into or re-date this account''s entry');
select throws_ok($$select public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','4ccccccc-cccc-4ccc-8ccc-ccccccccccd3','Reusing identifiers',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddb1","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeef1","body":"Imported synthetic one.","date":"2001-01-01"}]')$$,
  '22023','request identifier already used','nor replay this account''s revision');
select is((select count(*) from public.seeds where title<>'Bob probe thought'),0::bigint,'the other account gained nothing');
select is(public.import_thought('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0','4ccccccc-cccc-4ccc-8ccc-ccccccccccd4','Bob import',
  '[{"entry_id":"4ddddddd-dddd-4ddd-8ddd-ddddddddddb2","revision_id":"4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeb2","body":"Bob synthetic import.","date":"2018-06-01"}]')->>'created','1','and can import into its own topic');
select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
select is((select created_at from public.entries where id='4ddddddd-dddd-4ddd-8ddd-dddddddddde1'),'2019-03-04T12:00:00Z'::timestamptz,'this account''s entry date is untouched');
select is((select count(*) from public.seed_revisions where body like '%trespass%' or body like 'Bob %'),0::bigint,'and it sees none of the other account''s writing');
reset role;
select is((select count(*) from public.seed_revisions where body like '%trespass%'),0::bigint,'no refused import left a row anywhere');

select * from finish();
rollback;

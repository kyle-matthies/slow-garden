#!/usr/bin/env bash
set -euo pipefail
# Proves 20261116041903_browser_path_rules.sql applies over rows the older
# constraints accepted and the new rules refuse, without changing, rejecting or
# stranding any of them, and that new rows of the same kind are refused.
# Destructive ONLY to the dedicated, synthetic Slow Garden test stack.
# Never accepts --linked, credentials, an arbitrary database, or another project name.
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if ! rg -q 'project_id = "slow-garden-web-thinking"' .local-runtime/supabase/config.toml; then
  echo 'Dedicated local test stack required.' >&2; exit 1
fi
cp supabase/migrations/*.sql .local-runtime/supabase/migrations/
supabase db reset --workdir .local-runtime --local --version 20261116023939 --yes > .local-runtime/upgrade-rules-reset.log 2>&1
db() { docker exec -i supabase_db_slow-garden-web-thinking psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
db -q <<'SQL'
-- Everything here was accepted by the constraints in force before this migration.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('88888888-8888-4888-8888-888888888888','legacy-rules@example.test','{}','{}',now(),now());
insert into public.gardens(id,tenant_id,name) values
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','88888888-8888-4888-8888-888888888888',E'\t'),
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','88888888-8888-4888-8888-888888888888',chr(160)||chr(8203-1)),
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','88888888-8888-4888-8888-888888888888','  Padded legacy garden  '),
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','88888888-8888-4888-8888-888888888888',repeat(chr(127793),61));
insert into public.plots(id,tenant_id,garden_id,name) values
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',E'\n'),
 ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Archived legacy topic');
update public.plots set archived_at=now() where id='8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values
 ('8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',E'\t\n'),
 ('8ccccccc-cccc-4ccc-8ccc-ccccccccccc2','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','Thought in an archived topic');
insert into public.entries(id,tenant_id,garden_id,seed_id,created_at) values
 ('8ddddddd-dddd-4ddd-8ddd-ddddddddddd1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','1999-01-01T12:00:00Z'),
 ('8ddddddd-dddd-4ddd-8ddd-ddddddddddd2','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','9999-12-31T12:00:00Z'),
 ('8ddddddd-dddd-4ddd-8ddd-ddddddddddd3','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc2',now());
insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) values
 ('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','8ddddddd-dddd-4ddd-8ddd-ddddddddddd1',1,E'\n\n','88888888-8888-4888-8888-888888888888'),
 ('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','8ddddddd-dddd-4ddd-8ddd-ddddddddddd2',2,repeat(chr(127793),10001),'88888888-8888-4888-8888-888888888888'),
 ('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee3','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','8ddddddd-dddd-4ddd-8ddd-ddddddddddd2',7,E'\t'||chr(160),'88888888-8888-4888-8888-888888888888'),
 ('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8ccccccc-cccc-4ccc-8ccc-ccccccccccc2','8ddddddd-dddd-4ddd-8ddd-ddddddddddd3',1,'Synthetic legacy text in an archived topic.','88888888-8888-4888-8888-888888888888');
update public.accounts set timezone='posix/America/Argentina/Buenos_Aires' where id='88888888-8888-4888-8888-888888888888';
-- Responses need a pass and a bloom; written without the pass triggers.
set session_replication_role=replica;
insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,status,finished_at) values('8fffffff-ffff-4fff-8fff-fffffffffff1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',array['8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1']::uuid[],'complete',now());
insert into public.blooms(id,pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence) values('89999999-9999-4999-8999-999999999991','8fffffff-ffff-4fff-8fff-fffffffffff1','88888888-8888-4888-8888-888888888888','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',0,'question','Synthetic?','[{"revision_id":"8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee4","excerpt":"Synthetic"}]');
set session_replication_role=origin;
insert into public.bloom_responses(id,tenant_id,bloom_id,response,correction) values
 (gen_random_uuid(),'88888888-8888-4888-8888-888888888888','89999999-9999-4999-8999-999999999991','correct',null),
 (gen_random_uuid(),'88888888-8888-4888-8888-888888888888','89999999-9999-4999-8999-999999999991','correct',E'\t'),
 (gen_random_uuid(),'88888888-8888-4888-8888-888888888888','89999999-9999-4999-8999-999999999991','keep','Stray legacy correction');
-- Exact copies to compare against after the migration.
create schema upgrade_evidence;
create table upgrade_evidence.gardens as select * from public.gardens;
create table upgrade_evidence.plots as select * from public.plots;
create table upgrade_evidence.seeds as select * from public.seeds;
create table upgrade_evidence.entries as select * from public.entries;
create table upgrade_evidence.seed_revisions as select * from public.seed_revisions;
create table upgrade_evidence.bloom_responses as select * from public.bloom_responses;
create table upgrade_evidence.accounts as select * from public.accounts;
SQL
supabase migration up --workdir .local-runtime --local 2>&1 | grep -E 'browser_path_rules report|Applying migration 20261116041903|rror' || true
db -q <<'SQL'
do $$
declare t text; n bigint;
begin
  -- 1. Not one existing row changed, appeared or disappeared.
  foreach t in array array['gardens','plots','seeds','entries','seed_revisions','bloom_responses','accounts'] loop
    execute format('select count(*) from ((select * from upgrade_evidence.%1$I except select * from public.%1$I) union all (select * from public.%1$I except select * from upgrade_evidence.%1$I)) d',t) into n;
    if n<>0 then raise exception 'migration changed % row(s) of %',n,t; end if;
  end loop;
  -- 2. The rules exist, and the two constraints were not validated against old rows.
  if (select count(*) from pg_constraint where conname in('seed_revisions_body_rule','bloom_responses_correction_rule') and not convalidated)<>2 then
    raise exception 'append-only constraints must exist and stay NOT VALID';
  end if;
  if to_regprocedure('public.garden_capabilities()') is null or to_regprocedure('public.import_thought(uuid,uuid,text,jsonb)') is null then
    raise exception 'migration did not apply';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',false);
do $$
declare ok boolean;
begin
  -- 3. Legacy rows still work as they are.
  update public.gardens set status='archived',archived_at=now() where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  update public.gardens set status='active',archived_at=null where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  update public.gardens set status='archived',archived_at=now() where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  update public.seeds set status='archived',archived_at=now() where id='8ccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  update public.seeds set status='active',archived_at=null where id='8ccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  update public.entries set archived_at=now() where id='8ddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  update public.entries set archived_at=null where id='8ddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  update public.accounts set tend_overnight=true where id='88888888-8888-4888-8888-888888888888';
  update public.plots set archived_at=null where id='8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  -- Revising an entry whose current text is a legacy blank, and adding a new entry beside it.
  perform public.save_entry('8ccccccc-cccc-4ccc-8ccc-ccccccccccc1','8ddddddd-dddd-4ddd-8ddd-ddddddddddd1',gen_random_uuid(),'Synthetic revision of a legacy blank entry.','8eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1');
  perform public.save_entry('8ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),'Synthetic new entry in a legacy thought.');
  if jsonb_array_length(public.export_garden_sources()->'revisions')<>6 then raise exception 'export lost or gained revisions'; end if;
  -- 4. New rows of the same kinds are refused.
  ok:=false; begin insert into public.gardens(name) values(E'\t'); exception when check_violation then ok:=true; end;
  if not ok then raise exception 'a new tab-only garden name was accepted'; end if;
  ok:=false; begin update public.gardens set name=chr(160) where id='8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'; exception when check_violation then ok:=true; end;
  if not ok then raise exception 'renaming to a blank name was accepted'; end if;
  ok:=false; begin insert into public.seeds(garden_id,plot_id,title) values('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',E'\n'); exception when check_violation then ok:=true; end;
  if not ok then raise exception 'a new blank thought title was accepted'; end if;
  ok:=false; begin perform public.save_entry('8ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),E'\n\n'); exception when check_violation then ok:=true; end;
  if not ok then raise exception 'a new newline-only body was accepted'; end if;
  ok:=false; begin perform public.save_entry('8ccccccc-cccc-4ccc-8ccc-ccccccccccc1',gen_random_uuid(),gen_random_uuid(),repeat(chr(127793),10001)); exception when check_violation then ok:=true; end;
  if not ok then raise exception 'a new body over 20,000 UTF-16 units was accepted'; end if;
  ok:=false; begin insert into public.bloom_responses(id,bloom_id,response,correction) values(gen_random_uuid(),'89999999-9999-4999-8999-999999999991','correct',null); exception when check_violation then ok:=true; end;
  if not ok then raise exception 'a new correct response without text was accepted'; end if;
  ok:=false; begin update public.accounts set timezone='posix/America/Indiana/Knox' where id='88888888-8888-4888-8888-888888888888'; exception when invalid_parameter_value then ok:=true; end;
  if not ok then raise exception 'a new time zone the web refuses was accepted'; end if;
  ok:=false; begin update public.entries set created_at=now() where id='8ddddddd-dddd-4ddd-8ddd-ddddddddddd2'; exception when insufficient_privilege then ok:=true; end;
  if not ok then raise exception 'the owner could still move an entry date'; end if;
  -- Last, because changing a topic's tending withdraws its passes: a legacy blank-named topic still takes settings.
  update public.plots set ai_enabled=true where id='8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
end $$;
reset role;
do $$begin
  -- 5. After all of that, every legacy revision is still byte for byte what it was.
  if exists(select * from upgrade_evidence.seed_revisions except select * from public.seed_revisions) then raise exception 'legacy source text changed'; end if;
  if exists(select id,name from upgrade_evidence.gardens except select id,name from public.gardens) then raise exception 'a legacy garden name changed'; end if;
  if exists(select id,title from upgrade_evidence.seeds except select id,title from public.seeds) then raise exception 'a legacy thought title changed'; end if;
  if exists(select id,created_at from upgrade_evidence.entries except select id,created_at from public.entries) then raise exception 'a legacy entry date changed'; end if;
end $$;
drop schema upgrade_evidence cascade;
SQL
echo 'Browser path rules apply over legacy rows: 0 existing rows changed or rejected; legacy rows still archive, restore, revise and export; new rows of the same kinds are refused.'

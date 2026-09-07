#!/usr/bin/env bash
set -euo pipefail
# Destructive ONLY to the dedicated, synthetic Slow Garden test stack.
# Never accepts --linked, credentials, an arbitrary database, or another project name.
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if ! rg -q 'project_id = "slow-garden-web-thinking"' .local-runtime/supabase/config.toml; then
  echo 'Dedicated local test stack required.' >&2; exit 1
fi
cp supabase/migrations/*.sql .local-runtime/supabase/migrations/
supabase db reset --workdir .local-runtime --local --version 20260903070437 --yes > .local-runtime/upgrade-reset.log 2>&1
docker exec -i supabase_db_slow-garden-web-thinking psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('99999999-9999-4999-8999-999999999999','upgrade@example.test','{}','{}',now(),now());
insert into public.gardens(id,tenant_id,name) values('99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999999','Legacy fixture');
insert into public.seeds(id,tenant_id,garden_id) values('99999999-9999-4999-8999-999999999992','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999991');
insert into public.seed_revisions(id,tenant_id,garden_id,seed_id,revision_number,body,created_by,created_at)
select ('99999999-9999-4999-8999-'||lpad(n::text,12,'0'))::uuid,'99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992',n,'Synthetic original · revision '||n||E'\nSecond line.','99999999-9999-4999-8999-999999999999','2026-08-01'::timestamptz+n*interval '1 minute' from generate_series(1,30) n;
create table private.upgrade_evidence as select id,body,created_at,revision_number from public.seed_revisions;
SQL
supabase migration up --workdir .local-runtime --local
docker exec -i supabase_db_slow-garden-web-thinking psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if exists((select id,body,created_at,revision_number from private.upgrade_evidence except select id,body,created_at,revision_number from public.seed_revisions) union all (select id,body,created_at,revision_number from public.seed_revisions except select id,body,created_at,revision_number from private.upgrade_evidence)) then raise exception 'migration altered source evidence';end if;
 if (select count(*) from public.entries)<>1 then raise exception 'legacy history split into entries';end if;
 if (select revision_number from public.current_entries)<>30 then raise exception 'latest revision wrong';end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
do $$begin
 if jsonb_array_length(public.export_garden_sources()->'revisions')<>30 then raise exception 'export truncated source revisions';end if;
end $$;
reset role;
drop table private.upgrade_evidence;
SQL
echo 'Upgrade preserves all 30 source revisions, timestamps and IDs; latest entry and full export verified.'

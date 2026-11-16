-- Rollback-only synthetic verification. No private tenant bodies are queried.
begin;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98989898-9898-4989-8989-989898989891','slow-garden-canary-a@example.test','{}','{}',now(),now()),
('98989898-9898-4989-8989-989898989892','slow-garden-canary-b@example.test','{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','98989898-9898-4989-8989-989898989891',true);
insert into public.gardens(id,name) values('98989898-9898-4989-8989-989898989893','Synthetic rollback garden');
insert into public.plots(id,garden_id,name) values('98989898-9898-4989-8989-989898989894','98989898-9898-4989-8989-989898989893','Synthetic plot');
insert into public.seeds(id,garden_id,plot_id,title) values('98989898-9898-4989-8989-989898989895','98989898-9898-4989-8989-989898989893','98989898-9898-4989-8989-989898989894','Synthetic thought');
select public.save_entry('98989898-9898-4989-8989-989898989895','98989898-9898-4989-8989-989898989896','98989898-9898-4989-8989-989898989897','Synthetic source only');
select public.save_entry('98989898-9898-4989-8989-989898989895','98989898-9898-4989-8989-989898989896','98989898-9898-4989-8989-989898989897','Synthetic source only');
select public.save_entry('98989898-9898-4989-8989-989898989895','98989898-9898-4989-8989-989898989896','98989898-9898-4989-8989-989898989898','Revised synthetic source','98989898-9898-4989-8989-989898989897');
do $$begin
 if (select count(*) from public.seed_revisions where entry_id='98989898-9898-4989-8989-989898989896')<>2 then raise exception 'idempotency failed'; end if;
 if (select body from public.current_entries where entry_id='98989898-9898-4989-8989-989898989896')<>'Revised synthetic source' then raise exception 'latest revision failed';end if;
 if jsonb_array_length(public.export_garden_sources()->'revisions')<>2 then raise exception 'source export failed';end if;
 if exists(select 1 from public.plots where id='98989898-9898-4989-8989-989898989894' and (ai_enabled or cross_pollinate)) then raise exception 'AI defaults failed';end if;
end $$;
select set_config('request.jwt.claim.sub','98989898-9898-4989-8989-989898989892',true);
do $$begin
 if exists(select 1 from public.current_entries where entry_id='98989898-9898-4989-8989-989898989896') then raise exception 'cross-tenant read succeeded';end if;
 begin
  perform public.save_entry('98989898-9898-4989-8989-989898989895','98989898-9898-4989-8989-989898989896','98989898-9898-4989-8989-989898989899','Forbidden');
  raise exception 'cross-tenant write succeeded';
 exception when insufficient_privilege then null;end;
end $$;

-- Owner-only allowlist (private.ai_tenants) and transport freeze. Still inside the
-- rollback: the runtime is switched on only within this uncommitted transaction,
-- which no other session can see, and nothing reaches the worker or a provider.
-- Needs the migrations through 20261116023939_garden_scheduling.
reset role;
update private.ai_runtime set enabled=true,model=coalesce(model,'synthetic-canary'),approved_at=coalesce(approved_at,now()) where singleton;
update public.plots set ai_enabled=true where id='98989898-9898-4989-8989-989898989894';
do $$begin
 if exists(select 1 from private.ai_tenants where tenant_id in('98989898-9898-4989-8989-989898989891','98989898-9898-4989-8989-989898989892')) then raise exception 'canary tenant already allowlisted';end if;
 if has_table_privilege('authenticated','private.ai_tenants','select,insert,update,delete') or has_table_privilege('anon','private.ai_tenants','select') then raise exception 'allowlist is exposed to an API role';end if;
 if (select nightly_enabled from private.ai_runtime) and not exists(select 1 from private.ai_tenants) then raise exception 'nightly switch is on with an empty allowlist';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','98989898-9898-4989-8989-989898989891',true);
do $$begin
 begin
  insert into public.garden_passes(id,garden_id,plot_ids) values('98989898-9898-4989-8989-98989898989a','98989898-9898-4989-8989-989898989893',array['98989898-9898-4989-8989-989898989894']::uuid[]);
  raise exception 'pass accepted for a tenant that is not allowlisted';
 exception when sqlstate '55000' then
  if sqlerrm<>'tending is not available for this account yet' then raise exception 'unexpected refusal: %',sqlerrm;end if;
 end;
end $$;
reset role;
insert into private.ai_tenants(tenant_id,note) values('98989898-9898-4989-8989-989898989891','rollback-only canary');
set local role authenticated;
select set_config('request.jwt.claim.sub','98989898-9898-4989-8989-989898989891',true);
insert into public.garden_passes(id,garden_id,plot_ids) values('98989898-9898-4989-8989-98989898989a','98989898-9898-4989-8989-989898989893',array['98989898-9898-4989-8989-989898989894']::uuid[]);
select set_config('request.jwt.claim.sub','98989898-9898-4989-8989-989898989892',true);
do $$begin
 begin
  insert into public.garden_passes(id,tenant_id,garden_id,plot_ids) values('98989898-9898-4989-8989-98989898989b','98989898-9898-4989-8989-989898989892','98989898-9898-4989-8989-989898989893',array['98989898-9898-4989-8989-989898989894']::uuid[]);
  raise exception 'second tenant created a pass';
 exception when sqlstate '55000' or insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if (select count(*) from private.pass_inputs i where i.pass_id='98989898-9898-4989-8989-98989898989a' and i.transport=(select transport from private.ai_runtime) and i.dispatches=0 and jsonb_array_length(i.snapshot)=1)<>1 then raise exception 'allowlisted pass was not prepared as expected';end if;
end $$;
delete from private.ai_tenants where tenant_id='98989898-9898-4989-8989-989898989891';
do $$begin
 if (select status from public.garden_passes where id='98989898-9898-4989-8989-98989898989a')<>'cancelled' then raise exception 'removal from the allowlist did not cancel the pass';end if;
 if not (select cleanup_pending from private.pass_inputs where pass_id='98989898-9898-4989-8989-98989898989a') then raise exception 'cancelled pass was not queued for cleanup';end if;
end $$;
-- Fails with "current transaction is aborted" if any check above failed.
select 'hosted synthetic canary passed' as result;
rollback;
select 'rolled back; the canary passed only if the statement before the rollback returned its result' as note;

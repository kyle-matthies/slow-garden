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
rollback;
select 'hosted synthetic canary passed; rolled back' as result;

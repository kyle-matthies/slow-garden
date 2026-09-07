begin;
create table private.ai_runtime (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  workflow_version text not null default 'connect-v2-unapproved',
  model text,
  input_cents_per_million numeric not null default 1000 check(input_cents_per_million>0),
  output_cents_per_million numeric not null default 5000 check(output_cents_per_million>0),
  soft_cap_cents integer not null default 1000 check(soft_cap_cents>0),
  hard_cap_cents integer not null default 1500 check(hard_cap_cents>=soft_cap_cents),
  approved_at timestamptz,
  check (not enabled or (model is not null and approved_at is not null))
);
insert into private.ai_runtime(singleton) values(true);
create table private.ai_months (
  month date primary key,
  reserved_cents numeric not null default 0 check(reserved_cents>=0),
  spent_cents numeric not null default 0 check(spent_cents>=0)
);
create table public.garden_passes (
  id uuid primary key,
  tenant_id uuid not null default auth.uid(),
  garden_id uuid not null,
  plot_ids uuid[] not null check(cardinality(plot_ids) between 1 and 20),
  status text not null default 'queued' check(status in('queued','processing','complete','failed','cancelled','withdrawn')),
  no_output_reason text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key(garden_id,tenant_id) references public.gardens(id,tenant_id) on delete cascade,
  unique(id,tenant_id,garden_id)
);
create index passes_tenant_idx on public.garden_passes(tenant_id,created_at);
create table private.pass_inputs (
  pass_id uuid primary key references public.garden_passes(id) on delete cascade,
  snapshot jsonb not null,
  permissions jsonb not null,
  corrections jsonb not null default '[]',
  workflow_version text not null,
  model text not null,
  budget_month date not null references private.ai_months(month),
  reserved_cents numeric not null,
  input_rate numeric not null,
  output_rate numeric not null,
  provider_id text,
  input_file_id text,
  output_file_id text,
  lease_until timestamptz,
  lease_token uuid,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  actual_cents numeric,
  cleanup_pending boolean not null default false
);
create table public.blooms (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null,
  tenant_id uuid not null,
  garden_id uuid not null,
  ordinal integer not null check(ordinal between 0 and 2),
  kind text not null check(kind in('connection','tension','change','question')),
  interpretation text not null check(char_length(interpretation) between 1 and 1200),
  evidence jsonb not null check(jsonb_array_length(evidence) between 1 and 12),
  created_at timestamptz not null default now(),
  unique(pass_id,ordinal),
  unique(id,tenant_id),
  foreign key(pass_id,tenant_id,garden_id) references public.garden_passes(id,tenant_id,garden_id) on delete cascade
);
create index blooms_owner_idx on public.blooms(tenant_id,pass_id,garden_id);
create table public.bloom_responses (
  id uuid primary key,
  tenant_id uuid not null default auth.uid(),
  bloom_id uuid not null,
  response text not null check(response in('keep','correct','prune')),
  correction text check(char_length(correction)<=2000),
  created_at timestamptz not null default now(),
  foreign key(bloom_id,tenant_id) references public.blooms(id,tenant_id) on delete cascade
);
create index responses_bloom_idx on public.bloom_responses(bloom_id,tenant_id);
alter table public.garden_passes enable row level security;
alter table public.blooms enable row level security;
alter table public.bloom_responses enable row level security;
create policy passes_read on public.garden_passes for select to authenticated using(tenant_id=(select auth.uid()));
create policy passes_request on public.garden_passes for insert to authenticated with check(tenant_id=(select auth.uid()));
create policy passes_cancel on public.garden_passes for update to authenticated using(tenant_id=(select auth.uid())) with check(tenant_id=(select auth.uid()));
create policy blooms_read on public.blooms for select to authenticated using(tenant_id=(select auth.uid()) and exists(select 1 from public.garden_passes p where p.id=pass_id and p.status='complete'));
create policy responses_read on public.bloom_responses for select to authenticated using(tenant_id=(select auth.uid()));
create policy responses_write on public.bloom_responses for insert to authenticated with check(tenant_id=(select auth.uid()) and exists(select 1 from public.blooms b where b.id=bloom_id));
revoke all on public.garden_passes,public.blooms,public.bloom_responses from public,anon,authenticated;
grant select on public.garden_passes,public.blooms,public.bloom_responses to authenticated;
grant insert(id,tenant_id,garden_id,plot_ids) on public.garden_passes to authenticated;
grant update(status) on public.garden_passes to authenticated;
grant insert on public.bloom_responses to authenticated;

-- Trigger, not callable RPC: elevated access is restricted to snapshot and budget setup.
create function private.prepare_pass() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime; p public.plots; snap jsonb; perms jsonb:='{}'; cost numeric; m date:=date_trunc('month',now() at time zone 'UTC')::date; budget private.ai_months;
begin
  if auth.uid() is null or auth.uid()<>new.tenant_id then raise exception 'authentication required' using errcode='42501'; end if;
  select * into cfg from private.ai_runtime where singleton;
  if not cfg.enabled then raise exception 'AI evaluation gate has not been activated' using errcode='55000'; end if;
  perform 1 from public.accounts where id=new.tenant_id for update;
  if not exists(select 1 from public.gardens where id=new.garden_id and tenant_id=new.tenant_id and status='active') then raise exception 'garden unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.garden_passes where tenant_id=new.tenant_id and status in('queued','processing')) then raise exception 'a reflection is already in progress' using errcode='55000'; end if;
  if cardinality(new.plot_ids)<>(select count(distinct v) from unnest(new.plot_ids) v) then raise exception 'duplicate plots' using errcode='22023'; end if;
  for p in select * from public.plots where id=any(new.plot_ids) order by id for update loop
    if p.tenant_id<>new.tenant_id or p.garden_id<>new.garden_id or not p.ai_enabled or p.archived_at is not null or (cardinality(new.plot_ids)>1 and not p.cross_pollinate) then raise exception 'plot permission denied' using errcode='42501'; end if;
    perms:=perms||jsonb_build_object(p.id,p.permission_version);
  end loop;
  if (select count(*) from jsonb_object_keys(perms))<>cardinality(new.plot_ids) then raise exception 'plot unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('revision_id',c.revision_id,'entry_id',c.entry_id,'seed_id',c.seed_id,'plot_id',s.plot_id,'body',c.body,'created_at',c.created_at) order by c.created_at,c.entry_id),'[]') into snap
    from public.current_entries c join public.seeds s on s.id=c.seed_id where c.tenant_id=new.tenant_id and s.plot_id=any(new.plot_ids) and s.status='active' and c.archived_at is null;
  if jsonb_array_length(snap)=0 then raise exception 'write an entry before inviting a reflection' using errcode='22023'; end if;
  -- UTF-8 byte count is a conservative token ceiling; reject rather than silently truncate.
  if octet_length(snap::text)>100000 then raise exception 'select fewer plots for this reflection' using errcode='22023'; end if;
  cost:=ceil(((octet_length(snap::text)+10000)*cfg.input_cents_per_million+4000*cfg.output_cents_per_million)/1000000*1.25);
  insert into private.ai_months(month) values(m) on conflict do nothing;
  select * into budget from private.ai_months where month=m for update;
  if budget.reserved_cents+budget.spent_cents+cost>cfg.hard_cap_cents then raise exception 'AI budget reached' using errcode='55000'; end if;
  update private.ai_months set reserved_cents=reserved_cents+cost where month=m;
  -- Deferrable FK allows creation inside BEFORE INSERT.
  insert into private.pass_inputs(pass_id,snapshot,permissions,workflow_version,model,budget_month,reserved_cents,input_rate,output_rate)
    values(new.id,snap,perms,cfg.workflow_version,cfg.model,m,cost,cfg.input_cents_per_million,cfg.output_cents_per_million);
  update private.pass_inputs set corrections=(select coalesce(jsonb_agg(jsonb_build_object('correction',r.correction,'evidence',b.evidence)),'[]')
    from public.bloom_responses r join public.blooms b on b.id=r.bloom_id join public.garden_passes prev on prev.id=b.pass_id
    where r.tenant_id=new.tenant_id and r.response='correct' and prev.status='complete' and prev.plot_ids <@ new.plot_ids)
    where pass_id=new.id;
  if octet_length((select corrections::text from private.pass_inputs where pass_id=new.id))>10000 then raise exception 'correction context too large; review scope' using errcode='22023'; end if;
  new.status:='queued';new.no_output_reason:=null;new.finished_at:=null;new.created_at:=now();
  return new;
end $$;
alter table private.pass_inputs drop constraint pass_inputs_pass_id_fkey;
alter table private.pass_inputs add foreign key(pass_id) references public.garden_passes(id) on delete cascade deferrable initially deferred;
create trigger passes_prepare before insert on public.garden_passes for each row execute function private.prepare_pass();
revoke all on function private.prepare_pass() from public,anon,authenticated;

create function private.guard_pass_update() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and (new.status<>'cancelled' or old.status not in('queued','processing')) then raise exception 'only active passes can be cancelled' using errcode='42501'; end if;
  return new;
end $$;
create trigger passes_guard before update on public.garden_passes for each row execute function private.guard_pass_update();
create function private.invalidate_plot_passes() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.ai_enabled is distinct from new.ai_enabled or old.cross_pollinate is distinct from new.cross_pollinate or old.archived_at is distinct from new.archived_at then
    new.permission_version:=old.permission_version+1;
    update public.garden_passes set status=case when status='complete' then 'withdrawn' else 'cancelled' end,finished_at=now()
      where new.id=any(plot_ids) and status in('queued','processing','complete');
  else new.permission_version:=old.permission_version; end if;
  return new;
end $$;
create trigger plots_permissions before update on public.plots for each row execute function private.invalidate_plot_passes();
revoke all on function private.invalidate_plot_passes() from public,anon,authenticated;

-- Service-only RPCs: no user can submit provider output or forge a frozen snapshot.
grant usage on schema private to service_role;
grant select on public.plots,public.gardens to service_role;
grant all on all tables in schema private to service_role;
grant all on public.garden_passes,public.blooms,public.bloom_responses to service_role;
create function public.claim_garden_pass() returns jsonb language plpgsql security invoker set search_path='' as $$
declare job private.pass_inputs; p public.garden_passes; token uuid:=gen_random_uuid();
begin
  select i.* into job from private.pass_inputs i join public.garden_passes gp on gp.id=i.pass_id
    where ((gp.status in('queued','processing') and (select enabled from private.ai_runtime where singleton)) or (gp.status in('cancelled','withdrawn','failed','complete') and i.cleanup_pending))
      and i.next_attempt_at<=now() and (i.lease_until is null or i.lease_until<now())
    order by i.next_attempt_at for update of i skip locked limit 1;
  if job.pass_id is null then return null; end if;
  select * into p from public.garden_passes where id=job.pass_id for update;
  if p.status in('queued','processing') and not (select enabled from private.ai_runtime where singleton) then return null; end if;
  update private.pass_inputs set lease_until=now()+interval '2 minutes',lease_token=token,attempts=attempts+1 where pass_id=job.pass_id;
  if p.status='queued' then update public.garden_passes set status='processing' where id=p.id; end if;
  return jsonb_build_object('id',p.id,'status',p.status,'token',token,'snapshot',job.snapshot,'corrections',job.corrections,'model',job.model,'workflow_version',job.workflow_version,'provider_id',job.provider_id,'input_file_id',job.input_file_id,'output_file_id',job.output_file_id,'attempts',job.attempts,'created_at',p.created_at,'settled',job.actual_cents is not null);
end $$;
create function public.check_garden_pass(p_id uuid,p_token uuid) returns boolean language sql security invoker set search_path='' as $$
  select exists(select 1 from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id
    where i.pass_id=p_id and i.lease_token=p_token and i.lease_until>now() and p.status in('queued','processing') and exists(select 1 from public.gardens g where g.id=p.garden_id and g.status='active') and (select enabled from private.ai_runtime where singleton)
    and not exists(select 1 from jsonb_each_text(i.permissions) v left join public.plots q on q.id=v.key::uuid where q.id is null or q.permission_version<>v.value::integer or not q.ai_enabled or q.archived_at is not null));
$$;
create function public.update_garden_job(p_id uuid,p_token uuid,p_provider text default null,p_input_file text default null,p_output_file text default null,p_release boolean default false,p_clean boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
begin
  update private.pass_inputs set provider_id=coalesce(p_provider,provider_id),input_file_id=coalesce(p_input_file,input_file_id),output_file_id=coalesce(p_output_file,output_file_id),
    cleanup_pending=not p_clean,lease_until=case when p_release then null else lease_until end,
    next_attempt_at=case when p_release then now()+interval '5 minutes' else next_attempt_at end
    where pass_id=p_id and lease_token=p_token and lease_until>now();
  if not found then raise exception 'lease lost'; end if;
end $$;
create function public.finish_garden_pass(p_id uuid,p_token uuid,p_result jsonb,p_input_tokens integer default 0,p_output_tokens integer default 0,p_failed boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; p public.garden_passes; b jsonb; e jsonb; idx integer:=0; cost numeric; active boolean;
begin
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.lease_token is distinct from p_token or j.lease_until<now() then raise exception 'lease lost'; end if;
  select * into p from public.garden_passes where id=p_id for update;
  if j.actual_cents is not null then return; end if;
  active:=public.check_garden_pass(p_id,p_token);
  if active and not p_failed then
    if jsonb_typeof(p_result->'blooms') is distinct from 'array' or jsonb_array_length(p_result->'blooms')>3 then raise exception 'invalid bloom count'; end if;
    for b in select value from jsonb_array_elements(p_result->'blooms') loop
      if jsonb_typeof(b->'evidence') is distinct from 'array' or jsonb_array_length(b->'evidence')<1 then raise exception 'evidence required'; end if;
      for e in select value from jsonb_array_elements(b->'evidence') loop
        if not exists(select 1 from jsonb_array_elements(j.snapshot) s where s->>'revision_id'=e->>'revision_id' and length(e->>'excerpt')>0 and position(e->>'excerpt' in s->>'body')>0) then raise exception 'invalid source evidence'; end if;
      end loop;
      insert into public.blooms(pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence)
        values(p.id,p.tenant_id,p.garden_id,idx,b->>'kind',b->>'interpretation',b->'evidence') on conflict(pass_id,ordinal) do nothing;
      idx:=idx+1;
    end loop;
  end if;
  -- Unknown usage retains the full reservation conservatively instead of inventing zero cost.
  cost:=case when p_input_tokens+p_output_tokens>0 then (greatest(p_input_tokens,0)*j.input_rate+greatest(p_output_tokens,0)*j.output_rate)/1000000 else j.reserved_cents end;
  update private.ai_months set reserved_cents=greatest(0,reserved_cents-j.reserved_cents),spent_cents=spent_cents+cost where month=j.budget_month;
  update private.pass_inputs set actual_cents=cost,cleanup_pending=true,lease_until=null,next_attempt_at=now() where pass_id=p_id;
  update public.garden_passes set status=case when not active then case when status='withdrawn' then 'withdrawn' else 'cancelled' end when p_failed then 'failed' else 'complete' end,
    no_output_reason=case when active and not p_failed and idx=0 then 'No new reflection this time. Your thoughts can rest.' else null end,finished_at=now() where id=p_id;
end $$;
revoke all on function public.claim_garden_pass(),public.check_garden_pass(uuid,uuid),public.update_garden_job(uuid,uuid,text,text,text,boolean,boolean),public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.claim_garden_pass(),public.check_garden_pass(uuid,uuid),public.update_garden_job(uuid,uuid,text,text,text,boolean,boolean),public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) to service_role;
create function private.queue_cancel_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in('cancelled','withdrawn') and old.status is distinct from new.status then
    update private.pass_inputs set cleanup_pending=true,next_attempt_at=now() where pass_id=new.id;
  end if;
  return new;
end $$;
create trigger passes_cleanup after update on public.garden_passes for each row execute function private.queue_cancel_cleanup();
revoke all on function private.queue_cancel_cleanup() from public,anon,authenticated;
create function private.invalidate_source_passes() returns trigger language plpgsql security definer set search_path='' as $$
declare key_name text:=case when tg_table_name='seeds' then 'seed_id' else 'entry_id' end; affected uuid[];
begin
  if tg_op='UPDATE' and old.archived_at is not distinct from new.archived_at then return new; end if;
  select array_agg(pass_id) into affected from private.pass_inputs i where exists(select 1 from jsonb_array_elements(i.snapshot) s where s->>key_name=old.id::text);
  update public.garden_passes set status=case when status='complete' then 'withdrawn' else 'cancelled' end,finished_at=now()
    where id=any(affected) and status in('queued','processing','complete');
  if tg_op='DELETE' then
    update private.pass_inputs set snapshot='[]',corrections='[]' where pass_id=any(affected);
    delete from public.blooms where pass_id=any(affected);
    return old;
  end if;
  return new;
end $$;
create trigger seed_pass_invalidation before update or delete on public.seeds for each row execute function private.invalidate_source_passes();
create trigger entry_pass_invalidation before update or delete on public.entries for each row execute function private.invalidate_source_passes();
revoke all on function private.invalidate_source_passes() from public,anon,authenticated;
alter table private.ai_runtime enable row level security;
alter table private.ai_months enable row level security;
alter table private.pass_inputs enable row level security;
create index pass_inputs_budget_idx on private.pass_inputs(budget_month);
commit;

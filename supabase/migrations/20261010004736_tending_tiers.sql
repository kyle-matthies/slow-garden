-- Tending tiers and nightly tending (ADR-008, D-022).
-- Additive: connect-v2 passes keep their snapshot, validation and behaviour.
-- Nightly tending ships disabled: accounts opt in, the runtime gate stays closed,
-- and scheduling (pg_cron, pg_net, the worker tick) is a separate, reviewed
-- migration at runbook phase 4b.
begin;

-- Accounts: nightly opt-in and the time zone that decides when "night" is.
alter table public.accounts
  add column tend_overnight boolean not null default false,
  add column timezone text not null default 'UTC';

create function private.check_account_timezone() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'unknown time zone' using errcode='22023';
  end if;
  return new;
end $$;
create trigger accounts_timezone before insert or update of timezone on public.accounts
  for each row execute function private.check_account_timezone();
revoke all on function private.check_account_timezone() from public,anon,authenticated;

-- Passes: how they were started and which permission scope they cover.
-- Users still insert only (id, tenant_id, garden_id, plot_ids); `trigger` can be
-- set to 'nightly' only by privileged code.
alter table public.garden_passes
  add column trigger text not null default 'manual' check(trigger in('manual','nightly')),
  add column scope_key text;
update public.garden_passes set scope_key=(select string_agg(x::text,',' order by x) from unnest(plot_ids) x) where scope_key is null;
create index passes_scope_idx on public.garden_passes(tenant_id,scope_key,status);
alter table private.pass_inputs add column context jsonb not null default '{}';

-- New bloom kinds for tiers 2 and 3. Length stays 1200 for connect-v2;
-- tend-connect-v3 is held to one short sentence in finish_garden_pass.
alter table public.blooms drop constraint blooms_kind_check;
alter table public.blooms add constraint blooms_kind_check
  check(kind in('connection','tension','change','question','pattern','echo'));

-- Lexical retrieval of older writing (embeddings are a later ADR).
create index seed_revisions_body_search_idx on public.seed_revisions using gin(to_tsvector('simple'::regconfig,body));

-- Tier 1 catalogue marks: bounded Observations, not blooms.
create table public.tending_marks (
  id uuid primary key default gen_random_uuid(),
  pass_id uuid not null,
  tenant_id uuid not null,
  garden_id uuid not null,
  seed_id uuid not null,
  kind text not null check(kind in('theme','open_question','unfinished')),
  label text not null check(char_length(label)<=32 and (kind<>'theme' or char_length(label)>=1)),
  evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence) between 1 and 3),
  created_at timestamptz not null default now(),
  unique(pass_id,seed_id,kind,label),
  unique(id,tenant_id),
  foreign key(pass_id,tenant_id,garden_id) references public.garden_passes(id,tenant_id,garden_id) on delete cascade,
  foreign key(seed_id,tenant_id,garden_id) references public.seeds(id,tenant_id,garden_id) on delete cascade
);
create index tending_marks_owner_idx on public.tending_marks(tenant_id,garden_id,seed_id);
create index tending_marks_pass_idx on public.tending_marks(pass_id);
create table public.tending_mark_responses (
  id uuid primary key,
  tenant_id uuid not null default auth.uid(),
  mark_id uuid not null,
  response text not null check(response in('keep','prune')),
  created_at timestamptz not null default now(),
  foreign key(mark_id,tenant_id) references public.tending_marks(id,tenant_id) on delete cascade
);
create index tending_mark_responses_mark_idx on public.tending_mark_responses(mark_id,tenant_id);
alter table public.tending_marks enable row level security;
alter table public.tending_mark_responses enable row level security;
create policy marks_read on public.tending_marks for select to authenticated
  using(tenant_id=(select auth.uid()) and exists(select 1 from public.garden_passes p where p.id=pass_id and p.status='complete'));
create policy mark_responses_read on public.tending_mark_responses for select to authenticated
  using(tenant_id=(select auth.uid()));
create policy mark_responses_write on public.tending_mark_responses for insert to authenticated
  with check(tenant_id=(select auth.uid()) and exists(select 1 from public.tending_marks m where m.id=mark_id));
revoke all on public.tending_marks,public.tending_mark_responses from public,anon,authenticated;
grant select on public.tending_marks,public.tending_mark_responses to authenticated;
grant insert on public.tending_mark_responses to authenticated;
grant all on public.tending_marks,public.tending_mark_responses to service_role;

-- Recurring themes: counts come from stored marks and source dates, never from
-- a model's claim. Pruned marks drop out.
create view public.garden_themes with (security_invoker=true) as
select m.tenant_id, m.garden_id, lower(m.label) as label,
  array_agg(distinct m.seed_id) as seed_ids,
  count(distinct (r.created_at at time zone 'UTC')::date) as days,
  min(r.created_at) as first_at,
  max(r.created_at) as last_at
from public.tending_marks m
join public.garden_passes p on p.id=m.pass_id and p.status='complete'
cross join lateral jsonb_array_elements(m.evidence) e
join public.seed_revisions r on r.id=(e->>'revision_id')::uuid and r.tenant_id=m.tenant_id
where m.kind='theme'
  and not exists(select 1 from public.tending_mark_responses x where x.mark_id=m.id and x.response='prune')
group by m.tenant_id,m.garden_id,lower(m.label)
having count(distinct m.seed_id)>=2 or count(distinct (r.created_at at time zone 'UTC')::date)>=3;
revoke all on public.garden_themes from public,anon;
grant select on public.garden_themes to authenticated;

-- Pass preparation. connect-v2 is unchanged. tend-connect-v3 freezes what changed
-- since the scope's last completed pass, plus a few lexically related older
-- entries, and records which tiers the accumulated evidence unlocks.
create or replace function private.prepare_pass() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg private.ai_runtime; p public.plots; snap jsonb; perms jsonb:='{}'; cost numeric; m date:=date_trunc('month',now() at time zone 'UTC')::date; budget private.ai_months;
  scope text; v3 boolean; since timestamptz; changed jsonb; changed_ids uuid[]; trimmed integer:=0; candidates jsonb:='[]'; ctx jsonb:='{}'; idx jsonb;
  n_entries integer; n_weeks integer; newest timestamptz; oldest timestamptz; notice boolean; resurface boolean; terms text[]; q tsquery; corr jsonb;
begin
  -- Only privileged code can set trigger='nightly' (users have no column grant);
  -- every other pass must come from its own tenant.
  if new.trigger is distinct from 'nightly' and (auth.uid() is null or auth.uid()<>new.tenant_id) then raise exception 'authentication required' using errcode='42501'; end if;
  select * into cfg from private.ai_runtime where singleton;
  if not cfg.enabled then raise exception 'AI evaluation gate has not been activated' using errcode='55000'; end if;
  perform 1 from public.accounts where id=new.tenant_id for update;
  if not exists(select 1 from public.gardens where id=new.garden_id and tenant_id=new.tenant_id and status='active') then raise exception 'garden unavailable' using errcode='42501'; end if;
  if cardinality(new.plot_ids)<>(select count(distinct v) from unnest(new.plot_ids) v) then raise exception 'duplicate plots' using errcode='22023'; end if;
  scope:=(select string_agg(x::text,',' order by x) from unnest(new.plot_ids) x);
  new.scope_key:=scope;
  -- One active pass per permission scope, and a small ceiling per tenant.
  if exists(select 1 from public.garden_passes where tenant_id=new.tenant_id and scope_key=scope and status in('queued','processing')) then raise exception 'a reflection is already in progress' using errcode='55000'; end if;
  if (select count(*) from public.garden_passes where tenant_id=new.tenant_id and status in('queued','processing'))>=8 then raise exception 'too many reflections in progress' using errcode='55000'; end if;
  for p in select * from public.plots where id=any(new.plot_ids) order by id for update loop
    if p.tenant_id<>new.tenant_id or p.garden_id<>new.garden_id or not p.ai_enabled or p.archived_at is not null or (cardinality(new.plot_ids)>1 and not p.cross_pollinate) then raise exception 'plot permission denied' using errcode='42501'; end if;
    perms:=perms||jsonb_build_object(p.id,p.permission_version);
  end loop;
  if (select count(*) from jsonb_object_keys(perms))<>cardinality(new.plot_ids) then raise exception 'plot unavailable' using errcode='42501'; end if;
  v3:=cfg.workflow_version like 'tend-connect-v3%';
  if not v3 then
    select coalesce(jsonb_agg(jsonb_build_object('revision_id',c.revision_id,'entry_id',c.entry_id,'seed_id',c.seed_id,'plot_id',s.plot_id,'body',c.body,'created_at',c.created_at) order by c.created_at,c.entry_id),'[]') into snap
      from public.current_entries c join public.seeds s on s.id=c.seed_id where c.tenant_id=new.tenant_id and s.plot_id=any(new.plot_ids) and s.status='active' and c.archived_at is null;
    if jsonb_array_length(snap)=0 then raise exception 'write an entry before inviting a reflection' using errcode='22023'; end if;
  else
    select max(finished_at) into since from public.garden_passes where tenant_id=new.tenant_id and scope_key=scope and status='complete';
    select count(*),count(distinct date_trunc('week',c.created_at)),min(c.created_at) into n_entries,n_weeks,oldest
      from public.current_entries c join public.seeds s on s.id=c.seed_id where c.tenant_id=new.tenant_id and s.plot_id=any(new.plot_ids) and s.status='active' and c.archived_at is null;
    if n_entries=0 then raise exception 'write an entry before inviting a reflection' using errcode='22023'; end if;
    -- What changed, newest first, within about 60 KB; older changes join the candidate pool.
    with changes as (
      select c.revision_id,c.entry_id,c.seed_id,s.plot_id,s.title,c.body,c.created_at,greatest(c.created_at,c.revised_at) as touched,
        sum(octet_length(c.body)+240) over(order by greatest(c.created_at,c.revised_at) desc,c.entry_id rows unbounded preceding) as running
      from public.current_entries c join public.seeds s on s.id=c.seed_id
      where c.tenant_id=new.tenant_id and s.plot_id=any(new.plot_ids) and s.status='active' and c.archived_at is null
        and (since is null or greatest(c.created_at,c.revised_at)>since))
    select coalesce(jsonb_agg(jsonb_build_object('revision_id',revision_id,'entry_id',entry_id,'seed_id',seed_id,'plot_id',plot_id,'title',title,'body',body,'created_at',created_at,'role','changed') order by touched desc,entry_id) filter(where running<=60000 or touched=(select max(touched) from changes)),'[]'),
      coalesce(array_agg(entry_id) filter(where running<=60000 or touched=(select max(touched) from changes)),'{}'),
      count(*) filter(where not(running<=60000 or touched=(select max(touched) from changes))),
      max(touched)
      into changed,changed_ids,trimmed,newest from changes;
    if jsonb_array_length(changed)=0 then raise exception 'nothing new to tend since the last return' using errcode='22023'; end if;
    notice:=n_entries>=6 and n_weeks>=3;
    resurface:=oldest<=newest-interval '28 days';
    if notice or resurface then
      -- The changed writing's most frequent words (4+ letters) find related older entries.
      select array_agg(lexeme) into terms from (
        select t.lexeme from unnest(to_tsvector('simple'::regconfig,(select string_agg(x->>'body',' ') from jsonb_array_elements(changed) x))) t
        where char_length(t.lexeme)>=4 order by array_length(t.positions,1) desc,t.lexeme limit 48) w;
      if terms is not null then
        q:=array_to_string(array(select ''''||replace(replace(t,'\','\\'),'''','''''')||'''' from unnest(terms) t),' | ')::tsquery;
        select coalesce(jsonb_agg(item order by rank desc,created_at),'[]') into candidates from (
          select jsonb_build_object('revision_id',c.revision_id,'entry_id',c.entry_id,'seed_id',c.seed_id,'plot_id',s.plot_id,'title',s.title,'body',c.body,'created_at',c.created_at,'role','candidate') as item,
            ts_rank_cd(to_tsvector('simple'::regconfig,c.body),q)
              + case when exists(select 1 from public.tending_marks tm where tm.seed_id=c.seed_id and tm.kind='theme' and lower(tm.label)=any(terms)
                  and not exists(select 1 from public.tending_mark_responses x where x.mark_id=tm.id and x.response='prune')) then 0.2 else 0 end as rank,
            c.created_at
          from public.current_entries c join public.seeds s on s.id=c.seed_id
          where c.tenant_id=new.tenant_id and s.plot_id=any(new.plot_ids) and s.status='active' and c.archived_at is null
            and not (c.entry_id=any(changed_ids)) and to_tsvector('simple'::regconfig,c.body)@@q
            and octet_length(c.body)<=8000
          order by rank desc,c.created_at limit 12) r;
      end if;
    end if;
    -- Orientation only: titles and kept labels. Never evidence.
    select coalesce(jsonb_agg(jsonb_build_object('seed_id',s.id,'title',s.title,'labels',
        (select coalesce(jsonb_agg(distinct tm.label),'[]') from public.tending_marks tm
          where tm.seed_id=s.id and tm.kind='theme' and not exists(select 1 from public.tending_mark_responses x where x.mark_id=tm.id and x.response='prune')))),'[]')
      into idx from (select id,title from public.seeds where tenant_id=new.tenant_id and plot_id=any(new.plot_ids) and status='active' order by updated_at desc limit 200) s;
    snap:=changed||candidates;
    ctx:=jsonb_build_object('tiers',jsonb_build_object('catalog',true,'notice',notice,'resurface',resurface),
      'since',since,'changed',jsonb_array_length(changed),'trimmed',trimmed,'candidates',jsonb_array_length(candidates),'index',idx);
  end if;
  -- UTF-8 byte count is a conservative token ceiling; reject rather than silently truncate.
  if octet_length(snap::text)+octet_length(ctx::text)>100000 then raise exception 'select fewer plots for this reflection' using errcode='22023'; end if;
  -- tend-connect-v3 sends the snapshot twice (tend and connect stages).
  cost:=case when v3 then ceil(((2*(octet_length(snap::text)+octet_length(ctx::text))+20000)*cfg.input_cents_per_million+8000*cfg.output_cents_per_million)/1000000*1.25)
    else ceil(((octet_length(snap::text)+10000)*cfg.input_cents_per_million+4000*cfg.output_cents_per_million)/1000000*1.25) end;
  insert into private.ai_months(month) values(m) on conflict do nothing;
  select * into budget from private.ai_months where month=m for update;
  if budget.reserved_cents+budget.spent_cents+cost>cfg.hard_cap_cents then raise exception 'AI budget reached' using errcode='55000'; end if;
  update private.ai_months set reserved_cents=reserved_cents+cost where month=m;
  -- Deferrable FK allows creation inside BEFORE INSERT.
  insert into private.pass_inputs(pass_id,snapshot,permissions,workflow_version,model,budget_month,reserved_cents,input_rate,output_rate,context)
    values(new.id,snap,perms,cfg.workflow_version,cfg.model,m,cost,cfg.input_cents_per_million,cfg.output_cents_per_million,ctx);
  select coalesce(jsonb_agg(jsonb_build_object('correction',r.correction,'evidence',b.evidence)),'[]') into corr
    from public.bloom_responses r join public.blooms b on b.id=r.bloom_id join public.garden_passes prev on prev.id=b.pass_id
    where r.tenant_id=new.tenant_id and r.response='correct' and prev.status='complete' and prev.plot_ids <@ new.plot_ids;
  if v3 then
    -- Pruned blooms and labels are remembered so they do not recur.
    corr:=corr||(select coalesce(jsonb_agg(x),'[]') from (
      select jsonb_build_object('pruned',b.kind,'interpretation',b.interpretation) as x
        from public.bloom_responses r join public.blooms b on b.id=r.bloom_id join public.garden_passes prev on prev.id=b.pass_id
        where r.tenant_id=new.tenant_id and r.response='prune' and prev.status='complete' and prev.plot_ids <@ new.plot_ids
      union all
      select jsonb_build_object('pruned',tm.kind,'label',tm.label)
        from public.tending_mark_responses r join public.tending_marks tm on tm.id=r.mark_id join public.garden_passes prev on prev.id=tm.pass_id
        where r.tenant_id=new.tenant_id and r.response='prune' and prev.plot_ids <@ new.plot_ids
      limit 40) y);
  end if;
  update private.pass_inputs set corrections=corr where pass_id=new.id;
  if octet_length(corr::text)>10000 then raise exception 'correction context too large; review scope' using errcode='22023'; end if;
  new.status:='queued';new.no_output_reason:=null;new.finished_at:=null;new.created_at:=now();
  return new;
end $$;
revoke all on function private.prepare_pass() from public,anon,authenticated;

-- The worker receives the tier context with the job.
create or replace function public.claim_garden_pass() returns jsonb language plpgsql security invoker set search_path='' as $$
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
  return jsonb_build_object('id',p.id,'status',p.status,'token',token,'snapshot',job.snapshot,'corrections',job.corrections,'context',job.context,'model',job.model,'workflow_version',job.workflow_version,'provider_id',job.provider_id,'input_file_id',job.input_file_id,'output_file_id',job.output_file_id,'attempts',job.attempts,'created_at',p.created_at,'settled',job.actual_cents is not null);
end $$;

-- Ingestion re-validates every claim against the frozen snapshot. For
-- tend-connect-v3 it also enforces brevity, unlocked tiers and mark caps.
create or replace function public.finish_garden_pass(p_id uuid,p_token uuid,p_result jsonb,p_input_tokens integer default 0,p_output_tokens integer default 0,p_failed boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; p public.garden_passes; b jsonb; e jsonb; mk jsonb; idx integer:=0; cost numeric; active boolean; v3 boolean; counts jsonb:='{}'::jsonb; key text;
begin
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.lease_token is distinct from p_token or j.lease_until<now() then raise exception 'lease lost'; end if;
  select * into p from public.garden_passes where id=p_id for update;
  if j.actual_cents is not null then return; end if;
  active:=public.check_garden_pass(p_id,p_token);
  v3:=j.workflow_version like 'tend-connect-v3%';
  if active and not p_failed then
    if jsonb_typeof(p_result->'blooms') is distinct from 'array' or jsonb_array_length(p_result->'blooms')>3 then raise exception 'invalid bloom count'; end if;
    for b in select value from jsonb_array_elements(p_result->'blooms') loop
      if jsonb_typeof(b->'evidence') is distinct from 'array' or jsonb_array_length(b->'evidence')<1 then raise exception 'evidence required'; end if;
      if not v3 and b->>'kind' in('pattern','echo') then raise exception 'kind requires tend-connect-v3'; end if;
      if v3 and char_length(b->>'interpretation')>280 then raise exception 'interpretation too long'; end if;
      if v3 and b->>'kind'='pattern' and not coalesce((j.context#>>'{tiers,notice}')::boolean,false) then raise exception 'tier not unlocked'; end if;
      if v3 and b->>'kind'='echo' and not coalesce((j.context#>>'{tiers,resurface}')::boolean,false) then raise exception 'tier not unlocked'; end if;
      for e in select value from jsonb_array_elements(b->'evidence') loop
        if not exists(select 1 from jsonb_array_elements(j.snapshot) s where s->>'revision_id'=e->>'revision_id' and length(e->>'excerpt')>0 and position(e->>'excerpt' in s->>'body')>0) then raise exception 'invalid source evidence'; end if;
      end loop;
      insert into public.blooms(pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence)
        values(p.id,p.tenant_id,p.garden_id,idx,b->>'kind',b->>'interpretation',b->'evidence') on conflict(pass_id,ordinal) do nothing;
      idx:=idx+1;
    end loop;
    if jsonb_typeof(p_result->'marks')='array' and jsonb_array_length(p_result->'marks')>0 then
      if not v3 then raise exception 'marks require tend-connect-v3'; end if;
      if jsonb_array_length(p_result->'marks')>120 then raise exception 'too many marks'; end if;
      for mk in select value from jsonb_array_elements(p_result->'marks') loop
        if mk->>'kind' not in('theme','open_question','unfinished') then raise exception 'invalid mark kind'; end if;
        -- Marks describe changed writing only, and cite their own thought.
        if not exists(select 1 from jsonb_array_elements(j.snapshot) s where s->>'seed_id'=mk->>'seed_id' and s->>'role'='changed') then raise exception 'mark outside the snapshot'; end if;
        if jsonb_typeof(mk->'evidence') is distinct from 'array' or jsonb_array_length(mk->'evidence') not between 1 and 3 then raise exception 'evidence required'; end if;
        for e in select value from jsonb_array_elements(mk->'evidence') loop
          if not exists(select 1 from jsonb_array_elements(j.snapshot) s where s->>'revision_id'=e->>'revision_id' and s->>'seed_id'=mk->>'seed_id' and length(e->>'excerpt')>0 and position(e->>'excerpt' in s->>'body')>0) then raise exception 'invalid source evidence'; end if;
        end loop;
        key:=(mk->>'seed_id')||':'||(mk->>'kind');
        counts:=counts||jsonb_build_object(key,coalesce((counts->>key)::integer,0)+1);
        if (counts->>key)::integer>(case when mk->>'kind'='theme' then 2 else 1 end) then raise exception 'too many marks for one thought'; end if;
        insert into public.tending_marks(pass_id,tenant_id,garden_id,seed_id,kind,label,evidence)
          values(p.id,p.tenant_id,p.garden_id,(mk->>'seed_id')::uuid,mk->>'kind',coalesce(mk->>'label',''),mk->'evidence') on conflict do nothing;
      end loop;
    end if;
  end if;
  -- Unknown usage retains the full reservation conservatively instead of inventing zero cost.
  cost:=case when p_input_tokens+p_output_tokens>0 then (greatest(p_input_tokens,0)*j.input_rate+greatest(p_output_tokens,0)*j.output_rate)/1000000 else j.reserved_cents end;
  update private.ai_months set reserved_cents=greatest(0,reserved_cents-j.reserved_cents),spent_cents=spent_cents+cost where month=j.budget_month;
  update private.pass_inputs set actual_cents=cost,cleanup_pending=true,lease_until=null,next_attempt_at=now() where pass_id=p_id;
  update public.garden_passes set status=case when not active then case when status='withdrawn' then 'withdrawn' else 'cancelled' end when p_failed then 'failed' else 'complete' end,
    no_output_reason=case when active and not p_failed and idx=0 then 'No new reflection this time. Your thoughts can rest.' else null end,finished_at=now() where id=p_id;
end $$;
revoke all on function public.claim_garden_pass(),public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.claim_garden_pass(),public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) to service_role;

-- Deleting writing also removes tending that quoted it.
create or replace function private.invalidate_source_passes() returns trigger language plpgsql security definer set search_path='' as $$
declare key_name text:=case when tg_table_name='seeds' then 'seed_id' else 'entry_id' end; affected uuid[];
begin
  if tg_op='UPDATE' and old.archived_at is not distinct from new.archived_at then return new; end if;
  select array_agg(pass_id) into affected from private.pass_inputs i where exists(select 1 from jsonb_array_elements(i.snapshot) s where s->>key_name=old.id::text);
  update public.garden_passes set status=case when status='complete' then 'withdrawn' else 'cancelled' end,finished_at=now()
    where id=any(affected) and status in('queued','processing','complete');
  if tg_op='DELETE' then
    update private.pass_inputs set snapshot='[]',corrections='[]',context='{}' where pass_id=any(affected);
    delete from public.blooms where pass_id=any(affected);
    delete from public.tending_marks where pass_id=any(affected);
    return old;
  end if;
  return new;
end $$;
revoke all on function private.invalidate_source_passes() from public,anon,authenticated;

-- Nightly enqueue: for accounts that opted in and whose local time is in the
-- 02:00 hour, one pass per permission scope that has new writing. Each scope is
-- attempted independently; a budget stop or an active pass skips it tonight.
create function private.enqueue_nightly_passes(p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare a record; s record; n integer:=0; made integer; last timestamptz;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  for a in select id from public.accounts where tend_overnight and extract(hour from p_now at time zone timezone)=2 loop
    if exists(select 1 from public.garden_passes where tenant_id=a.id and trigger='nightly' and created_at>p_now-interval '20 hours') then continue; end if;
    made:=0;
    for s in
      select pl.garden_id,array_agg(pl.id order by pl.id) as plot_ids
        from public.plots pl join public.gardens g on g.id=pl.garden_id and g.status='active'
        where pl.tenant_id=a.id and pl.ai_enabled and pl.archived_at is null
        group by pl.garden_id,case when pl.cross_pollinate then null else pl.id end
    loop
      exit when made>=p_per_tenant;
      select max(finished_at) into last from public.garden_passes
        where tenant_id=a.id and scope_key=(select string_agg(x::text,',' order by x) from unnest(s.plot_ids) x) and status='complete';
      continue when not exists(select 1 from public.current_entries c join public.seeds sd on sd.id=c.seed_id
        where c.tenant_id=a.id and sd.plot_id=any(s.plot_ids) and sd.status='active' and c.archived_at is null
          and (last is null or greatest(c.created_at,c.revised_at)>last));
      begin
        insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values(gen_random_uuid(),a.id,s.garden_id,s.plot_ids,'nightly');
        made:=made+1;
        n:=n+1;
      exception when sqlstate '55000' or sqlstate '22023' or sqlstate '42501' then
        -- Budget, in-progress, size or permission: leave this scope for another night.
        null;
      end;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function private.enqueue_nightly_passes(timestamptz,integer) from public,anon,authenticated;

commit;

-- Lock order and nightly-cycle fixes, from the adversarial review of
-- 20261116061751_tending_followups.sql. To be settled before tending is enabled;
-- safe to apply with every switch at its default. Nothing here reads or changes
-- a person's writing. The merged migrations are not edited; functions they
-- defined are replaced here.
--
-- 1. THE NIGHTLY CYCLE BELONGS TO THE GARDEN, NOT TO A DATE.
--    "One night once" was keyed on the account's local date, so a person who
--    changed time zone across the date line was tended again an hour later: six
--    blooms in one garden in one hour. Now:
--      * a cycle is a row in private.bloom_cycles with its own id and the moment
--        it started (started_at, the moment nightly enqueue was given);
--      * a garden cannot start a nightly cycle within twenty hours of another of
--        its cycles, before or after. Twenty hours holds across every time-zone
--        change (the next local 02:00 is never less than about 23 hours on, or
--        it is refused), across the night clocks repeat an hour, and on the night
--        they skip one;
--      * the record is the cycle row, which belongs to the garden and survives
--        its passes: deleting a pass, or removing and re-adding the account on
--        the allowlist, does not reopen the night;
--      * the three-bloom counter is that row, found by id (private.pass_inputs.cycle_id),
--        so nothing a person can change moves it. cycle_date stays as a
--        label: the account's local date when the cycle started;
--      * nightly passes from before this migration carry no cycle; while one of
--        them is less than twenty hours old its garden is not started again.
-- 2. public.garden_passes' statement trigger (pass inputs before the pass row)
--    fired inside definer paths that had already locked their own inputs, then
--    locked every active one: archiving a thought against switching a topic's
--    tending off deadlocked. It now fires only for a signed-in person's own
--    statement (current_user = 'authenticated'), the one path it was written
--    for; every definer path locks exactly its own set, in id order, first.
-- 3. A SAVE NEVER WAITS ON THE WORKER. save_entry and import_thought locked the
--    thought FOR UPDATE, which conflicts with the key-share lock ingestion holds
--    on a thought it cites while it queues for the pass inputs. They now take
--    FOR NO KEY UPDATE: still exclusive against another save, an archive and a
--    deletion; compatible with key-share. (create_seed takes no thought lock.)
-- 4. Archiving or restoring a thought or an entry now takes the account's row
--    first (a statement trigger, before any row is locked), the first lock of
--    every deletion. They used to take the thought and then pass inputs while a
--    deletion held pass inputs and reached for others, and deadlocked under load.
--    Lock order: accounts, the allowlist row, gardens, topics, thoughts, entries,
--    pass inputs (in id order), passes, the cycle row, the month.
-- 5. private.run_nightly_enqueue no longer guesses whether it is inside a
--    transaction (the guess was wrong under the extended query protocol). Its
--    first statement is COMMIT, which Postgres refuses there with 2D000.
-- 6. private.nightly_skips.garden_id now references the garden and goes with it.
--
-- Reversal (as the operator, runtime disabled, queues drained):
--   drop trigger seeds_account_first on public.seeds;
--   drop trigger entries_account_first on public.entries;
--   drop function private.lock_account_first();
--   drop trigger passes_lock_inputs_first on public.garden_passes;
--   create trigger passes_lock_inputs_first before update on public.garden_passes
--     for each statement execute function private.lock_own_pass_inputs();
--   re-create public.save_entry and public.import_thought from 20261116041903_browser_path_rules.sql;
--   re-create public.finish_garden_pass, private.enqueue_nightly_for and
--     private.run_nightly_enqueue from 20261116061751_tending_followups.sql
--     (only with private.bloom_cycles empty: its key changes back below);
--   drop function private.pass_cycle(uuid), private.garden_cycle_near(uuid,timestamptz,uuid[]);
--   alter table private.nightly_skips drop constraint nightly_skips_garden_fkey;
--   alter table private.pass_inputs drop column cycle_id;
--   alter table private.bloom_cycles drop constraint bloom_cycles_pkey, drop column id, drop column started_at,
--     add primary key(garden_id,cycle_date);
begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

-- ---------------------------------------------------------------------------
-- 1. Cycles.
-- ---------------------------------------------------------------------------
alter table private.bloom_cycles drop constraint bloom_cycles_pkey;
alter table private.bloom_cycles
  add column id bigint generated always as identity,
  add column started_at timestamptz;
update private.bloom_cycles set started_at=cycle_date::timestamp at time zone 'UTC' where started_at is null;
alter table private.bloom_cycles alter column started_at set not null;
alter table private.bloom_cycles add primary key(id);
create index bloom_cycles_garden_idx on private.bloom_cycles(garden_id,started_at);
alter table private.pass_inputs add column cycle_id bigint references private.bloom_cycles(id) on delete set null;
create index pass_inputs_cycle_idx on private.pass_inputs(cycle_id);

-- The garden's cycle within twenty hours of a moment, either side, or null.
-- Also not null (0) while the garden has a nightly pass from before cycles
-- existed that is less than twenty hours old. p_except names passes to leave
-- out: the ones the calling run has just created and not yet stamped (a garden
-- with several scopes gets several passes in one run).
create function private.garden_cycle_near(p_garden uuid,p_at timestamptz,p_except uuid[] default '{}'::uuid[]) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select c.id from private.bloom_cycles c
       where c.garden_id=p_garden and c.started_at>p_at-interval '20 hours' and c.started_at<p_at+interval '20 hours'
       order by c.started_at desc limit 1),
    (select 0::bigint where exists(select 1 from public.garden_passes gp join private.pass_inputs i on i.pass_id=gp.id
       where gp.garden_id=p_garden and gp.trigger='nightly' and i.cycle_id is null and not (gp.id=any(p_except))
         and gp.created_at>p_at-interval '20 hours' and gp.created_at<p_at+interval '20 hours')));
$$;
revoke all on function private.garden_cycle_near(uuid,timestamptz,uuid[]) from public,anon,authenticated;

-- The cycle of a nightly pass that carries none: the garden's cycle near the
-- pass's creation, or a new one starting then. Recorded on the pass. One at a
-- time per garden, so two such passes cannot each open a cycle.
create function private.pass_cycle(p_pass uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare p public.garden_passes; v_id bigint;
begin
  select * into p from public.garden_passes where id=p_pass;
  if p.id is null then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.garden_id::text,0));
  select c.id into v_id from private.bloom_cycles c
    where c.garden_id=p.garden_id and c.started_at>p.created_at-interval '20 hours' and c.started_at<p.created_at+interval '20 hours'
    order by c.started_at desc limit 1;
  if v_id is null then
    insert into private.bloom_cycles(garden_id,tenant_id,cycle_date,started_at)
      values(p.garden_id,p.tenant_id,private.pass_local_date(p.id),p.created_at) returning id into v_id;
  end if;
  update private.pass_inputs set cycle_id=v_id where pass_id=p_pass;
  return v_id;
end $$;
revoke all on function private.pass_cycle(uuid) from public,anon,authenticated;
grant execute on function private.pass_cycle(uuid) to service_role;

-- Nightly enqueue for one account. As in tending_followups except: the account
-- row is locked first; "once a night" is asked of each garden (above), not of
-- the account's local date; and each garden that gets a pass opens a cycle row.
create or replace function private.enqueue_nightly_for(p_tenant uuid,p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; gc record; made integer:=0; last timestamptz; created uuid[]:='{}'::uuid[]; v_id uuid; v_cycle date; v_cycle_id bigint;
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date; v_soft integer; v_used numeric;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  select soft_cap_cents into v_soft from private.ai_runtime where singleton;
  insert into private.ai_months(month) values(v_month) on conflict do nothing;
  if not exists(select 1 from public.accounts acc where acc.id=p_tenant and acc.tend_overnight and private.is_tending_hour(p_now,acc.timezone)
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id)) then return 0; end if;
  -- The night: the account's local date at the moment its tending hour is being served.
  select (p_now at time zone acc.timezone)::date into v_cycle from public.accounts acc where acc.id=p_tenant;
  -- Two runs for one account take turns (prepare_pass takes this lock anyway).
  perform 1 from public.accounts where id=p_tenant for update;
  for s in
    select pl.garden_id,array_agg(pl.id order by pl.id) as plot_ids
      from public.plots pl join public.gardens g on g.id=pl.garden_id and g.status='active'
      where pl.tenant_id=p_tenant and pl.ai_enabled and pl.archived_at is null
      group by pl.garden_id,case when pl.cross_pollinate then null else pl.id end
      order by pl.garden_id,min(pl.id::text)
  loop
    exit when made>=p_per_tenant;
    -- A garden is tended once a night, and the record of that is the garden's own
    -- cycle row, not the account's local date (a time-zone change moves the date)
    -- and not its passes (deleting a pass must not reopen the night).
    continue when private.garden_cycle_near(s.garden_id,p_now,created) is not null;
    -- A pass holds at most twenty topics. Skip, note, and carry on with the rest.
    if cardinality(s.plot_ids)>20 then
      insert into private.nightly_skips(tenant_id,garden_id,cycle_date,reason,topics)
        values(p_tenant,s.garden_id,v_cycle,'scope_over_20_topics',cardinality(s.plot_ids));
      continue;
    end if;
    -- Same watermark as prepare_pass: the last completed snapshot, not its finish time.
    select max(created_at) into last from public.garden_passes
      where tenant_id=p_tenant and scope_key=(select string_agg(x::text,',' order by x) from unnest(s.plot_ids) x) and status='complete';
    continue when not exists(select 1 from public.current_entries c join public.seeds sd on sd.id=c.seed_id
      where c.tenant_id=p_tenant and sd.plot_id=any(s.plot_ids) and sd.status='active' and c.archived_at is null
        and (last is null or greatest(c.created_at,c.revised_at)>last));
    -- Automatic passes pause at the soft cap (see 20261116023935_ai_tenant_allowlist.sql):
    -- checked before every pass, read without FOR UPDATE on purpose.
    select m.reserved_cents+m.spent_cents into v_used from private.ai_months m where m.month=v_month;
    exit when v_used>=v_soft;
    begin
      v_id:=gen_random_uuid();
      insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values(v_id,p_tenant,s.garden_id,s.plot_ids,'nightly');
      created:=created||v_id;
      made:=made+1;
    exception when sqlstate '55000' or sqlstate '22023' or sqlstate '42501' or sqlstate '23514' then
      -- Budget, in-progress, size, permission or a table rule: leave this scope for another night.
      null;
    end;
  end loop;
  -- Open one cycle per garden that got a pass, then stamp its passes with it and
  -- share the garden's three blooms among them: most new writing first, then scope
  -- key. Counts and ids only.
  for gc in select distinct p.garden_id from public.garden_passes p where p.id=any(created) order by 1 loop
    insert into private.bloom_cycles(garden_id,tenant_id,cycle_date,started_at) values(gc.garden_id,p_tenant,v_cycle,p_now) returning id into v_cycle_id;
    update private.pass_inputs i set cycle_id=v_cycle_id,cycle_date=v_cycle,
        bloom_allowance=case when r.n=1 then 3 when r.n=2 then 3-r.rk when r.rk<=3 then 1 else 0 end
      from (select p.id,
          row_number() over(order by coalesce((x.context->>'changed')::integer,jsonb_array_length(x.snapshot)) desc,p.scope_key) as rk,
          count(*) over() as n
        from public.garden_passes p join private.pass_inputs x on x.pass_id=p.id where p.id=any(created) and p.garden_id=gc.garden_id) r
      where i.pass_id=r.id;
  end loop;
  return made;
end $$;
revoke all on function private.enqueue_nightly_for(uuid,timestamptz,integer) from public,anon,authenticated;

-- Ingestion. As in tending_followups except that the garden's counter is found
-- by the pass's cycle id.
create or replace function public.finish_garden_pass(p_id uuid,p_token uuid,p_result jsonb,p_input_tokens integer default 0,p_output_tokens integer default 0,p_failed boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; p public.garden_passes; b jsonb; e jsonb; mk jsonb; idx integer:=0; cost numeric; active boolean; v3 boolean; counts jsonb:='{}'::jsonb; key text;
  v_total integer:=0; v_allow integer; v_cycle bigint; v_published integer; v_chosen jsonb;
begin
  perform private.lock_marked_seeds(p_id,p_result->'marks');
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.pass_id is null or j.lease_token is distinct from p_token or j.lease_until is null or j.lease_until<=now() then raise exception 'lease lost'; end if;
  select * into p from public.garden_passes where id=p_id for update;
  if j.actual_cents is not null then return; end if;
  active:=public.check_garden_pass(p_id,p_token);
  v3:=j.workflow_version like 'tend-connect-v3%';
  if active and not p_failed then
    if jsonb_typeof(p_result->'blooms') is distinct from 'array' or jsonb_array_length(p_result->'blooms')>3 then raise exception 'invalid bloom count'; end if;
    -- Validate every bloom before any is stored.
    for b in select value from jsonb_array_elements(p_result->'blooms') loop
      if jsonb_typeof(b->'evidence') is distinct from 'array' or jsonb_array_length(b->'evidence')<1 then raise exception 'evidence required'; end if;
      if not v3 and b->>'kind' in('pattern','echo') then raise exception 'kind requires tend-connect-v3'; end if;
      if v3 and char_length(b->>'interpretation')>280 then raise exception 'interpretation too long'; end if;
      -- The finalizer is the second boundary: every v3 kind must belong to an unlocked tier
      -- (mirrors allowedKinds() in the worker), whatever the worker's schema allowed.
      if v3 and coalesce(b->>'kind','') not in('connection','tension','change','pattern','question','echo') then raise exception 'invalid bloom kind'; end if;
      if v3 and b->>'kind' in('connection','tension','change','pattern') and not coalesce((j.context#>>'{tiers,notice}')::boolean,false) then raise exception 'tier not unlocked'; end if;
      if v3 and b->>'kind' in('question','echo') and not coalesce((j.context#>>'{tiers,resurface}')::boolean,false) then raise exception 'tier not unlocked'; end if;
      -- An echo sets older writing beside current writing: a changed source and one at least
      -- four weeks older, both cited.
      if v3 and b->>'kind'='echo' and not exists(
        select 1 from jsonb_array_elements(b->'evidence') ec join jsonb_array_elements(j.snapshot) sc on sc->>'revision_id'=ec->>'revision_id',
          jsonb_array_elements(b->'evidence') eo join jsonb_array_elements(j.snapshot) so on so->>'revision_id'=eo->>'revision_id'
        where sc->>'role'='changed' and (sc->>'created_at')::timestamptz-(so->>'created_at')::timestamptz>=interval '28 days')
      then raise exception 'echo needs older writing beside new'; end if;
      for e in select value from jsonb_array_elements(b->'evidence') loop
        if not exists(select 1 from jsonb_array_elements(j.snapshot) s where s->>'revision_id'=e->>'revision_id' and length(e->>'excerpt')>0 and position(e->>'excerpt' in s->>'body')>0) then raise exception 'invalid source evidence'; end if;
      end loop;
    end loop;
    v_total:=jsonb_array_length(p_result->'blooms');
    v_allow:=v_total;
    v_chosen:=p_result->'blooms';
    -- The nightly budget: this pass's share, and never more than three for the
    -- garden in the cycle. The cycle row is locked here and held to the end of
    -- the transaction, so two passes finishing together are counted one after
    -- the other.
    if p.trigger='nightly' and v_total>0 then
      -- The pass's own cycle, by id. A nightly pass that carries none (one an
      -- operator created) joins the garden's cycle near its creation, or opens one.
      v_cycle:=coalesce(j.cycle_id,private.pass_cycle(p.id));
      select published into v_published from private.bloom_cycles where id=v_cycle for update;
      v_allow:=greatest(0,least(v_total,coalesce(j.bloom_allowance,3),3-v_published));
      if v_allow<v_total then
        -- Fixed rule, not the model's order: kind, then breadth of evidence, then position.
        select coalesce(jsonb_agg(r.value order by r.rk),'[]'::jsonb) into v_chosen from (
          select t.value,row_number() over(order by
              array_position(array['echo','pattern','change','tension','connection','question'],t.value->>'kind') nulls last,
              (select count(distinct ev->>'revision_id') from jsonb_array_elements(t.value->'evidence') ev) desc,
              t.ordinality) as rk
            from jsonb_array_elements(p_result->'blooms') with ordinality t(value,ordinality)) r
          where r.rk<=v_allow;
      end if;
    end if;
    for b in select value from jsonb_array_elements(v_chosen) loop
      insert into public.blooms(pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence)
        values(p.id,p.tenant_id,p.garden_id,idx,b->>'kind',b->>'interpretation',b->'evidence') on conflict(pass_id,ordinal) do nothing;
      idx:=idx+1;
    end loop;
    if v_cycle is not null then
      update private.bloom_cycles set published=published+idx,withheld=withheld+(v_total-idx) where id=v_cycle;
    end if;
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
  -- Real usage when it is known. Unknown usage keeps the full reservation, but only
  -- when work actually reached the provider; a pass that never left costs nothing.
  cost:=case when p_input_tokens+p_output_tokens>0 then (greatest(p_input_tokens,0)*j.input_rate+greatest(p_output_tokens,0)*j.output_rate)/1000000
    when j.provider_id is not null or j.input_file_id is not null or j.dispatch_open then j.reserved_cents
    else 0 end;
  update private.ai_months set reserved_cents=greatest(0,reserved_cents-j.reserved_cents),spent_cents=spent_cents+cost where month=j.budget_month;
  update private.pass_inputs set actual_cents=cost,dispatch_open=false,cleanup_pending=true,lease_until=null,next_attempt_at=now(),
    blooms_withheld=v_total-idx where pass_id=p_id;
  update public.garden_passes set status=case when not active then case when status='withdrawn' then 'withdrawn' else 'cancelled' end when p_failed then 'failed' else 'complete' end,
    no_output_reason=case when active and not p_failed and idx=0 then 'No new reflection this time. Your thoughts can rest.' else null end,finished_at=now() where id=p_id;
end $$;
revoke all on function public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The cancel-order trigger, for a person's own statement only.
-- ---------------------------------------------------------------------------
drop trigger passes_lock_inputs_first on public.garden_passes;
create trigger passes_lock_inputs_first before update on public.garden_passes
  for each statement when (current_user='authenticated') execute function private.lock_own_pass_inputs();

-- ---------------------------------------------------------------------------
-- 3. Saving and importing take FOR NO KEY UPDATE on the thought. Bodies
--    otherwise exactly as in 20261116041903_browser_path_rules.sql.
-- ---------------------------------------------------------------------------
create or replace function public.save_entry(p_seed_id uuid, p_entry_id uuid, p_revision_id uuid,
  p_body text, p_expected_revision_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.seeds; r public.seed_revisions; head_id uuid; n integer; v_garden uuid; v_plot uuid;
begin
  select garden_id,plot_id into v_garden,v_plot from public.seeds where id=p_seed_id and tenant_id=auth.uid();
  if not found then raise exception 'seed unavailable' using errcode='42501'; end if;
  perform 1 from public.gardens where id=v_garden for share;
  perform 1 from public.plots where id=v_plot for share;
  -- NO KEY UPDATE: still exclusive against another save, an archive and a deletion
  -- of this thought, but compatible with the key-share lock background ingestion
  -- holds on a thought it cites. A save never waits on the worker.
  select * into s from public.seeds where id = p_seed_id for no key update;
  if s.id is null or s.tenant_id <> auth.uid() then raise exception 'seed unavailable' using errcode='42501'; end if;
  if s.garden_id<>v_garden or s.plot_id<>v_plot then raise exception 'entry changed; review latest version before saving' using errcode='40001'; end if;
  select * into r from public.seed_revisions where id = p_revision_id;
  if r.id is not null then
    if r.entry_id <> p_entry_id or r.seed_id <> p_seed_id or r.body <> p_body then
      raise exception 'request identifier already used' using errcode='22023';
    end if;
    return r.id;
  end if;
  if not exists(select 1 from public.gardens where id=s.garden_id and status='active')
    then raise exception 'this garden is archived; restore it to write here' using errcode='SGA02'; end if;
  if exists(select 1 from public.plots where id=s.plot_id and archived_at is not null)
    then raise exception 'this topic is archived; restore it to write here' using errcode='SGA02'; end if;
  if s.status <> 'active' then raise exception 'this thought is archived; restore it to write here' using errcode='SGA02'; end if;
  select id into head_id from public.seed_revisions where entry_id=p_entry_id order by revision_number desc limit 1;
  if head_id is distinct from p_expected_revision_id then raise exception 'entry changed; review latest version before saving' using errcode='40001'; end if;
  insert into public.entries(id, tenant_id, garden_id, seed_id)
    values(p_entry_id, s.tenant_id, s.garden_id, s.id) on conflict(id) do nothing;
  if not exists(select 1 from public.entries where id=p_entry_id and seed_id=s.id and archived_at is null)
    then raise exception 'entry unavailable' using errcode='42501'; end if;
  select coalesce(max(revision_number), 0)+1 into n from public.seed_revisions where seed_id=s.id;
  insert into public.seed_revisions(id, tenant_id, garden_id, seed_id, entry_id, revision_number, body, created_by)
    values(p_revision_id, s.tenant_id, s.garden_id, s.id, p_entry_id, n, p_body, auth.uid());
  return p_revision_id;
end $$;

create or replace function public.import_thought(p_plot_id uuid,p_seed_id uuid,p_title text,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_title text:=private.trim_text(p_title); p public.plots; s public.seeds; r public.seed_revisions; e record;
  v_entry uuid; v_revision uuid; v_at timestamptz; v_created integer:=0; v_skipped integer:=0;
  v_garden_status public.garden_status; v_archived timestamptz;
  uuid_shape constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_plot_id is null or p_seed_id is null or v_title is null or v_title='' or private.utf16_length(v_title)>160
      or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 500 then
    raise exception 'check the topic and entries' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) x where (case when jsonb_typeof(x) is distinct from 'object' then true else
        (x-'entry_id'-'revision_id'-'body'-'date')<>'{}'::jsonb
        or jsonb_typeof(x->'body') is distinct from 'string'
        or private.trim_text(x->>'body')='' or private.utf16_length(x->>'body')>20000
        or jsonb_typeof(x->'entry_id') is distinct from 'string' or (x->>'entry_id') !~ uuid_shape
        or jsonb_typeof(x->'revision_id') is distinct from 'string' or (x->>'revision_id') !~ uuid_shape
        or coalesce(jsonb_typeof(x->'date'),'null') not in('null','string')
        or (coalesce(jsonb_typeof(x->'date'),'null')='string' and not private.is_calendar_date(x->>'date')) end) is not false) then
    raise exception 'check the topic and entries' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) x
      where x->>'date' is not null and (x->>'date')::date>(now() at time zone 'UTC')::date+1) then
    raise exception 'check the topic and entries' using errcode='22023';
  end if;
  if (select coalesce(sum(octet_length(x->>'body')),0) from jsonb_array_elements(p_entries) x)+octet_length(p_title)>1048576
      or octet_length(p_entries::text)+octet_length(p_title)>1048576+256*jsonb_array_length(p_entries) then
    raise exception 'import too large' using errcode='22023';
  end if;
  select * into p from public.plots where id=p_plot_id and tenant_id=v_tenant;
  if p.id is null then raise exception 'choose an active topic' using errcode='SGA02'; end if;
  select g.status into v_garden_status from public.gardens g where g.id=p.garden_id and g.tenant_id=v_tenant for share;
  select pl.archived_at into v_archived from public.plots pl where pl.id=p_plot_id for share;
  if v_garden_status is distinct from 'active' or v_archived is not null then
    raise exception 'choose an active topic' using errcode='SGA02';
  end if;
  select * into s from public.seeds where id=p_seed_id for no key update;
  if s.id is null then
    insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values(p_seed_id,v_tenant,p.garden_id,p_plot_id,v_title);
  elsif s.tenant_id<>v_tenant or s.plot_id<>p_plot_id then
    raise exception 'seed unavailable' using errcode='42501';
  elsif s.status<>'active' then
    raise exception 'this thought is archived; restore it to write here' using errcode='SGA02';
  end if;
  for e in select x->>'entry_id' as entry_id,x->>'revision_id' as revision_id,x->>'body' as body,x->>'date' as day
      from jsonb_array_elements(p_entries) with ordinality t(x,i) order by i loop
    v_entry:=e.entry_id::uuid;
    v_revision:=e.revision_id::uuid;
    select * into r from public.seed_revisions where id=v_revision;
    if r.id is not null then
      -- A replay. Same entry, thought and text, or it is refused; nothing changes.
      if r.tenant_id<>v_tenant or r.entry_id<>v_entry or r.seed_id<>p_seed_id or r.body<>e.body then
        raise exception 'request identifier already used' using errcode='22023';
      end if;
      v_skipped:=v_skipped+1;
      continue;
    end if;
    -- Only an entry this call creates is written or dated.
    if exists(select 1 from public.entries where id=v_entry) then
      raise exception 'request identifier already used' using errcode='22023';
    end if;
    v_at:=case when e.day is null then now() else least((e.day||'T12:00:00Z')::timestamptz,now()) end;
    insert into public.entries(id,tenant_id,garden_id,seed_id,created_at) values(v_entry,v_tenant,p.garden_id,p_seed_id,v_at);
    perform public.save_entry(p_seed_id,v_entry,v_revision,e.body);
    v_created:=v_created+1;
  end loop;
  return jsonb_build_object('id',p_seed_id,'created',v_created,'skipped',v_skipped);
end $$;
revoke all on function public.import_thought(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.import_thought(uuid,uuid,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Archive and restore take the account's row first.
--    A statement trigger, because a row trigger fires after the row is locked.
--    Only for a person's own statement, and only when the statement sets the
--    archive columns: renaming or moving a thought on the canvas is untouched.
--    The cost: an archive or restore waits for that account's pass preparation
--    or deletion in progress (milliseconds), as deletions already do.
-- ---------------------------------------------------------------------------
create function private.lock_account_first() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null then
    perform 1 from public.accounts where id=auth.uid() for update;
  end if;
  return null;
end $$;
revoke all on function private.lock_account_first() from public,anon,authenticated;
create trigger seeds_account_first before update of status,archived_at on public.seeds
  for each statement when (current_user='authenticated') execute function private.lock_account_first();
create trigger entries_account_first before update of archived_at on public.entries
  for each statement when (current_user='authenticated') execute function private.lock_account_first();

-- ---------------------------------------------------------------------------
-- 5. The nightly procedure: COMMIT first, no guessing.
-- ---------------------------------------------------------------------------
create or replace procedure private.run_nightly_enqueue(p_now timestamptz default now())
language plpgsql as $$
declare a uuid; ids uuid[]; v_state text;
begin
  -- Commit before anything else, gates open or closed. Inside a transaction this
  -- is where the call fails, with Postgres's own "invalid transaction termination"
  -- (2D000) and this procedure named in the context, before any work is done.
  -- It also means every scheduled run exercises the commit path, so the first
  -- commit is never the night the owner is enqueued.
  commit;
  if not private.nightly_gates_open() then return; end if;
  ids:=private.nightly_accounts(p_now);
  commit;
  foreach a in array ids loop
    begin
      perform private.enqueue_nightly_for(a,p_now);
    exception when others then
      get stacked diagnostics v_state=returned_sqlstate;
      insert into private.nightly_skips(tenant_id,reason) values(a,'error_'||pg_catalog.lower(v_state));
    end;
    commit;
  end loop;
end $$;
revoke all on procedure private.run_nightly_enqueue(timestamptz) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 6. A skip note goes with its garden.
-- ---------------------------------------------------------------------------
delete from private.nightly_skips s where s.garden_id is not null and not exists(select 1 from public.gardens g where g.id=s.garden_id);
alter table private.nightly_skips add constraint nightly_skips_garden_fkey
  foreign key(garden_id) references public.gardens(id) on delete cascade;
create index nightly_skips_garden_idx on private.nightly_skips(garden_id);

notify pgrst, 'reload schema';

commit;

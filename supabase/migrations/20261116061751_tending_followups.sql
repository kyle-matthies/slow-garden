-- Tending follow-ups from the pre-apply review of the five 20261116 migrations.
-- To be settled before nightly tending is enabled; safe to apply with every
-- switch at its default. Nothing here reads or changes a person's writing.
--
-- 1. THREE BLOOMS PER GARDEN PER NIGHT (AGENTS.md, ADR-008). The cap was per
--    pass, and a night makes one pass per permission scope, so a garden with two
--    tended topics could publish six.
--      Cycle. A nightly cycle is one garden on one night, where the night is the
--      account's local calendar date at the moment nightly enqueue runs for it
--      (its 02:00 hour in accounts.timezone, or the 03:00 hour on the night the
--      clocks skip 02:00). The date comes from the time the enqueue was given
--      and the account's zone, never from the server's zone or the wall clock
--      at publish time. Every pass enqueued that night
--      carries that date (private.pass_inputs.cycle_date).
--      Share. When the night's passes for a garden are created its three are
--      shared out among them, by a rule that uses only counts and ids: passes
--      ordered by how much new writing they froze (most first), then by scope
--      key. One pass gets 3; two get 2 and 1; three or more get 1, 1, 1 and the
--      rest 0 (private.pass_inputs.bloom_allowance). A share a pass does not use
--      is not handed on: the return gets smaller, never larger.
--      Choice. When a pass returns more blooms than it may publish, the ones kept
--      are chosen by a fixed rule, not by the model's order: by kind (echo,
--      pattern, change, tension, connection, question), then more distinct
--      cited revisions first, then the earlier position. All blooms are
--      validated first, as before; an invalid one still refuses the result.
--      Backstop. private.bloom_cycles counts what each garden published in each
--      cycle, under a row lock taken at publish time, so the total can never
--      pass three whatever the shares say and however passes finish (two at
--      once included). It is not given back if a bloom is later withdrawn.
--      Record. Counts only: blooms_withheld on the pass, published and withheld
--      on the cycle.
--      Invited passes. A pass a person invites is its own cycle: up to three, as
--      before, and it neither uses nor is limited by the night's budget. The
--      person asked for it; the nightly budget is about what arrives unasked.
--      Catalogue marks are not blooms and keep their own limits.
-- 2. private.run_nightly_enqueue commits after each account, so it cannot run
--    inside a transaction. It now says so before doing anything (SQLSTATE
--    25001), and commits once before reading the gates, so a call the check
--    cannot recognise fails with Postgres's own 2D000, also before any work,
--    whether the gates are open or closed. One account's failure no longer stops the
--    accounts after it: it is noted in private.nightly_skips and the run goes on.
-- 3. A scope of more than twenty cross-pollinating topics cannot be a pass
--    (garden_passes.plot_ids holds at most twenty). It raised 23514, which the
--    enqueue handler did not catch, so that account and every later one got
--    nothing. Such a scope is now skipped with a content-free note and the rest
--    is tended.
-- 4. Lock order. Everywhere: public.accounts, the account's private.ai_tenants
--    row, gardens, plots, seeds, entries, then private.pass_inputs, then
--    public.garden_passes, then private.bloom_cycles, then private.ai_months.
--      * delete_account removes its own allowlist row right after the accounts
--        lock (it used to reach it last, by cascade, after the pass inputs: the
--        reverse of allowlist removal; observed 40P01).
--      * finish_garden_pass takes a key-share lock on the thoughts its marks cite
--        before the pass inputs (it used to take it after, through the foreign
--        key: the reverse of deleting a thought).
--      * erase_garden and delete_plot lock their thoughts before any pass input.
--      * A person cancelling a pass takes the pass inputs before the pass row (a
--        statement trigger; it used to be the reverse of the worker's claim).
--    None of these adds a lock to save_entry, create_seed or import.
--
-- Reversal (as the operator, runtime disabled, queues drained):
--   drop trigger passes_lock_inputs_first on public.garden_passes;
--   drop function private.lock_own_pass_inputs();
--   re-create private.nightly_accounts from 20261116041903_browser_path_rules.sql;
--   drop function private.lock_marked_seeds(uuid,jsonb), private.pass_local_date(uuid),
--     private.is_tending_hour(timestamptz,text);   (after finish_garden_pass and
--     enqueue_nightly_for below have been re-created)
--   re-create public.finish_garden_pass from 20261116023937_provider_transport.sql,
--     private.enqueue_nightly_for, private.run_nightly_enqueue, private.erase_garden,
--     public.delete_plot and public.delete_account from 20261116041903_browser_path_rules.sql;
--   drop table private.nightly_skips, private.bloom_cycles;
--   alter table private.pass_inputs drop column cycle_date, drop column bloom_allowance,
--     drop column blooms_withheld;
begin;

-- Fail fast instead of queueing behind a long transaction (as in browser_path_rules).
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table private.pass_inputs
  add column cycle_date date,
  add column bloom_allowance smallint check(bloom_allowance between 0 and 3),
  add column blooms_withheld integer not null default 0 check(blooms_withheld>=0);

-- What each garden has published in each nightly cycle. Counts only.
create table private.bloom_cycles (
  garden_id uuid not null,
  tenant_id uuid not null,
  cycle_date date not null,
  published integer not null default 0 check(published between 0 and 3),
  withheld integer not null default 0 check(withheld>=0),
  primary key(garden_id,cycle_date),
  foreign key(garden_id,tenant_id) references public.gardens(id,tenant_id) on delete cascade
);
alter table private.bloom_cycles enable row level security;
create policy bloom_cycles_backend_only on private.bloom_cycles for all to service_role using(true) with check(true);
revoke all on private.bloom_cycles from public,anon,authenticated;
grant select,insert,update on private.bloom_cycles to service_role;

-- Why a scope or an account was passed over on a night. A reason code, ids and a
-- count; never text from the garden.
create table private.nightly_skips (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.accounts(id) on delete cascade,
  garden_id uuid,
  cycle_date date,
  reason text not null check(reason ~ '^[a-z0-9_]{1,40}$'),
  topics integer,
  noted_at timestamptz not null default now()
);
create index nightly_skips_tenant_idx on private.nightly_skips(tenant_id,noted_at);
alter table private.nightly_skips enable row level security;
create policy nightly_skips_backend_only on private.nightly_skips for all to service_role using(true) with check(true);
revoke all on private.nightly_skips from public,anon,authenticated;
grant select on private.nightly_skips to service_role;

-- ---------------------------------------------------------------------------
-- Helpers the worker's ingestion needs. finish_garden_pass runs as the service
-- role (SECURITY INVOKER), and the service role holds no privilege on
-- public.seeds or public.accounts: no migration grants one, and whether a
-- platform default does depends on the Postgres image (it did on the image the
-- newer CLI starts and did not on the one CI and 2.109.1 start, where the first
-- version of this migration failed with 42501). So the two things ingestion
-- needs from those tables go through SECURITY DEFINER helpers, scoped to the
-- pass, and nothing here relies on a default privilege.
-- ---------------------------------------------------------------------------
-- Key-share lock on the thoughts a result's marks cite, within the pass's own
-- tenant, in id order. Malformed ids are ignored here and refused by validation.
create function private.lock_marked_seeds(p_pass uuid,p_marks jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_marks) is distinct from 'array' then return; end if;
  perform 1 from public.seeds s
    where s.tenant_id=(select gp.tenant_id from public.garden_passes gp where gp.id=p_pass)
      and s.id in(select (m->>'seed_id')::uuid from jsonb_array_elements(p_marks) m
        where m->>'seed_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    order by s.id for key share;
end $$;
-- The night a pass belongs to when none was recorded on it: the account's local
-- date at the moment the pass was created.
create function private.pass_local_date(p_pass uuid) returns date
language sql stable security definer set search_path='' as $$
  select (gp.created_at at time zone a.timezone)::date
    from public.garden_passes gp join public.accounts a on a.id=gp.tenant_id where gp.id=p_pass;
$$;
revoke all on function private.lock_marked_seeds(uuid,jsonb),private.pass_local_date(uuid) from public,anon,authenticated;
grant execute on function private.lock_marked_seeds(uuid,jsonb),private.pass_local_date(uuid) to service_role;

-- The tending hour: the account's local 02:00 hour. On the one night a year
-- when a zone's clocks jump from 01:59 to 03:00 there is no 02:00 hour, and
-- the night used to be skipped altogether; the 03:00 hour stands in for it.
create function private.is_tending_hour(p_now timestamptz,p_timezone text) returns boolean
language sql stable set search_path='' as $$
  select extract(hour from p_now at time zone p_timezone)=2
    or (extract(hour from p_now at time zone p_timezone)=3
        and extract(hour from (p_now-interval '1 hour') at time zone p_timezone)=1);
$$;
revoke all on function private.is_tending_hour(timestamptz,text) from public,anon,authenticated;

create or replace function private.nightly_accounts(p_now timestamptz) returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(acc.id order by acc.id),'{}') from public.accounts acc
    where acc.tend_overnight and private.is_tending_hour(p_now,acc.timezone)
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id);
$$;
revoke all on function private.nightly_accounts(timestamptz) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- Nightly enqueue for one account. As in browser_path_rules, plus: scopes are
-- visited in a fixed order; a scope of more than twenty topics is skipped with a
-- note; a check violation is handled like the other refusals; and the passes
-- created are stamped with the night's cycle date and their share of each
-- garden's three blooms.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_nightly_for(p_tenant uuid,p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; made integer:=0; last timestamptz; created uuid[]:='{}'::uuid[]; v_id uuid; v_cycle date;
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date; v_soft integer; v_used numeric;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  select soft_cap_cents into v_soft from private.ai_runtime where singleton;
  insert into private.ai_months(month) values(v_month) on conflict do nothing;
  if not exists(select 1 from public.accounts acc where acc.id=p_tenant and acc.tend_overnight and private.is_tending_hour(p_now,acc.timezone)
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id)) then return 0; end if;
  -- The night: the account's local date at the moment its tending hour is being served.
  select (p_now at time zone acc.timezone)::date into v_cycle from public.accounts acc where acc.id=p_tenant;
  -- A night is tended once. Decided by the night itself, not by comparing a
  -- pass's creation time with p_now (which made the answer depend on when the
  -- function was called with a given p_now). Passes from before this migration
  -- carry no night and keep the old twenty-hour rule.
  if exists(select 1 from public.garden_passes gp join private.pass_inputs i on i.pass_id=gp.id
      where gp.tenant_id=p_tenant and gp.trigger='nightly'
        and (i.cycle_date=v_cycle or (i.cycle_date is null and gp.created_at>p_now-interval '20 hours'))) then return 0; end if;
  for s in
    select pl.garden_id,array_agg(pl.id order by pl.id) as plot_ids
      from public.plots pl join public.gardens g on g.id=pl.garden_id and g.status='active'
      where pl.tenant_id=p_tenant and pl.ai_enabled and pl.archived_at is null
      group by pl.garden_id,case when pl.cross_pollinate then null else pl.id end
      order by pl.garden_id,min(pl.id::text)
  loop
    exit when made>=p_per_tenant;
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
  -- Stamp the night and share each garden's three blooms among its passes:
  -- most new writing first, then scope key. Counts and ids only.
  update private.pass_inputs i set cycle_date=v_cycle,
      bloom_allowance=case when r.n=1 then 3 when r.n=2 then 3-r.rk when r.rk<=3 then 1 else 0 end
    from (select p.id,
        row_number() over(partition by p.garden_id order by coalesce((x.context->>'changed')::integer,jsonb_array_length(x.snapshot)) desc,p.scope_key) as rk,
        count(*) over(partition by p.garden_id) as n
      from public.garden_passes p join private.pass_inputs x on x.pass_id=p.id where p.id=any(created)) r
    where i.pass_id=r.id;
  return made;
end $$;
revoke all on function private.enqueue_nightly_for(uuid,timestamptz,integer) from public,anon,authenticated;

-- What the schedule runs. Not SECURITY DEFINER and no SET clause, because it
-- commits (see browser_path_rules); every name is schema-qualified.
-- It refuses to start inside a transaction, with a message that says why
-- (25001). In its own statement the transaction and the statement begin at the
-- same instant; inside BEGIN ... they do not.
-- One account's failure is rolled back to that account's start, noted, and the
-- run continues with the next account.
create or replace procedure private.run_nightly_enqueue(p_now timestamptz default now())
language plpgsql as $$
declare a uuid; ids uuid[]; v_state text;
begin
  if pg_catalog.transaction_timestamp()<>pg_catalog.statement_timestamp() then
    raise exception 'run_nightly_enqueue commits after each account and must be called on its own, not inside a transaction' using errcode='25001';
  end if;
  -- Commit before anything else, gates open or closed. Two reasons: where the
  -- check above cannot tell (several statements sent as one string), this fails
  -- here with Postgres's own 2D000, still before any work; and every scheduled
  -- run, including the hourly ones while the gates are closed, exercises the
  -- commit path, so the first commit is never the night the owner is enqueued.
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
-- Ingestion. As in 20261116023937_provider_transport.sql, plus:
--   * the thoughts cited by marks are key-share locked before the pass inputs
--     (lock order; a mark's foreign key takes the same lock, only later);
--   * every bloom is validated before any is stored;
--   * a nightly pass publishes at most its share, and its garden at most three
--     for the cycle; which blooms are kept follows the fixed rule above.
-- ---------------------------------------------------------------------------
create or replace function public.finish_garden_pass(p_id uuid,p_token uuid,p_result jsonb,p_input_tokens integer default 0,p_output_tokens integer default 0,p_failed boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; p public.garden_passes; b jsonb; e jsonb; mk jsonb; idx integer:=0; cost numeric; active boolean; v3 boolean; counts jsonb:='{}'::jsonb; key text;
  v_total integer:=0; v_allow integer; v_cycle date; v_published integer; v_chosen jsonb;
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
      v_cycle:=coalesce(j.cycle_date,private.pass_local_date(p.id));
      insert into private.bloom_cycles(garden_id,tenant_id,cycle_date) values(p.garden_id,p.tenant_id,v_cycle) on conflict do nothing;
      select published into v_published from private.bloom_cycles where garden_id=p.garden_id and cycle_date=v_cycle for update;
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
      update private.bloom_cycles set published=published+idx,withheld=withheld+(v_total-idx) where garden_id=p.garden_id and cycle_date=v_cycle;
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
-- Lock order.
-- ---------------------------------------------------------------------------
-- A person cancelling a pass: the pass inputs before the pass row. A statement
-- trigger, because a row trigger fires after the row is already locked. It
-- locks the caller's own active passes (at most eight) and does nothing for
-- the worker or the operator, whose paths already take the inputs first.
create function private.lock_own_pass_inputs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null then
    perform private.lock_pass_inputs(array(select id from public.garden_passes
      where tenant_id=auth.uid() and status in('queued','processing')));
  end if;
  return null;
end $$;
create trigger passes_lock_inputs_first before update on public.garden_passes
  for each statement execute function private.lock_own_pass_inputs();
revoke all on function private.lock_own_pass_inputs() from public,anon,authenticated;

-- Erasing a garden: garden, topics, thoughts, then passes. Body otherwise as in
-- 20261116041903_browser_path_rules.sql.
create or replace function private.erase_garden(p_tenant uuid,p_garden_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.gardens where id=p_garden_id and tenant_id=p_tenant for update;
  perform 1 from public.plots where tenant_id=p_tenant and garden_id=p_garden_id order by id for update;
  perform 1 from public.seeds where tenant_id=p_tenant and garden_id=p_garden_id order by id for update;
  -- Passes first: their inputs, blooms and marks cascade, and source deletes below stay cheap.
  perform private.lock_pass_inputs(array(select id from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id));
  delete from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.seeds where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.plots where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.gardens where tenant_id=p_tenant and id=p_garden_id;
end $$;
revoke all on function private.erase_garden(uuid,uuid) from public,anon,authenticated;

-- Deleting a topic: the topic's thoughts are locked before any pass input.
-- Body otherwise as in 20261116041903_browser_path_rules.sql.
create or replace function public.delete_plot(p_plot_id uuid,p_confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); p public.plots; receipt jsonb; v_seeds uuid[]; v_entries uuid[];
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into p from public.plots where id=p_plot_id and tenant_id=v_tenant for update;
  if p.id is null then return jsonb_build_object('deleted',false); end if;
  if btrim(coalesce(p_confirm_name,''))<>btrim(p.name) then raise exception 'confirmation does not match' using errcode='22023'; end if;
  perform 1 from public.seeds where plot_id=p_plot_id and tenant_id=v_tenant order by id for update;
  receipt:=private.deletion_scope(v_tenant,'plot',p_plot_id);
  select coalesce(array_agg(id),'{}') into v_seeds from public.seeds where plot_id=p_plot_id and tenant_id=v_tenant;
  select coalesce(array_agg(id),'{}') into v_entries from public.entries where seed_id=any(v_seeds) and tenant_id=v_tenant;
  perform private.erase_derived(v_tenant,v_seeds,v_entries,v_seeds);
  -- A pass scoped to this topic has no remaining meaning; its inputs cascade.
  perform private.lock_pass_inputs(array(select id from public.garden_passes where tenant_id=v_tenant and p_plot_id=any(plot_ids)));
  delete from public.garden_passes where tenant_id=v_tenant and p_plot_id=any(plot_ids);
  delete from public.seeds where plot_id=p_plot_id and tenant_id=v_tenant;
  delete from public.plots where id=p_plot_id and tenant_id=v_tenant;
  return receipt||jsonb_build_object('deleted',true);
end $$;

-- Deleting an account: its own allowlist row goes right after the accounts
-- lock, the order allowlist removal uses (allowlist row, then pass inputs).
-- Removing the row cancels the account's active passes through the usual
-- trigger; if the deletion is then refused, everything rolls back together.
-- Body otherwise as in 20261116041903_browser_path_rules.sql.
create or replace function public.delete_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_expected text; receipt jsonb; g uuid;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
  perform 1 from public.accounts where id=v_tenant for update;
  if not found then return jsonb_build_object('deleted',false); end if;
  if not exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=v_tenant
      and (s.not_after is null or s.not_after>now()) and s.created_at>now()-interval '10 minutes') then
    raise exception 'recent sign-in required' using errcode='SGA01';
  end if;
  v_expected:=coalesce(nullif(lower(btrim(auth.jwt()->>'email')),''),'delete my account');
  if lower(btrim(coalesce(p_confirm,'')))<>v_expected then raise exception 'confirmation does not match' using errcode='22023'; end if;
  delete from private.ai_tenants where tenant_id=v_tenant;
  receipt:=private.deletion_scope(v_tenant,'account',v_tenant);
  for g in select id from public.gardens where tenant_id=v_tenant order by id loop
    perform private.erase_garden(v_tenant,g);
  end loop;
  delete from auth.users where id=v_tenant;
  delete from public.accounts where id=v_tenant;
  if exists(select 1 from auth.users where id=v_tenant) then raise exception 'sign-in identity could not be removed' using errcode='55000'; end if;
  return receipt||jsonb_build_object('deleted',true);
end $$;

notify pgrst, 'reload schema';

commit;

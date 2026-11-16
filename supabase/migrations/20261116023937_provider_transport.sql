-- Provider transport and reasoning effort as pinned runtime settings
-- (activation prerequisites 2026-11-16; PRIVACY_ARCHITECTURE_OPTIONS finding 1).
--
--   transport         'batch' (default: nothing changes) or 'sync'. With 'sync' the
--                     worker makes one synchronous Responses call per stage with
--                     store:false instead of uploading a file and creating a batch.
--   reasoning_effort  null (default: the field is not sent, as today) or a pinned
--                     value. What is evaluated must be what ships (ADR-004).
-- Both are frozen into each pass when it is prepared, like model, workflow and
-- rates, so changing the runtime never changes a pass already in flight.
--
-- A synchronous call has no provider-side id to reconcile against, so the ledger
-- records each dispatch itself (public.mark_garden_dispatch):
--   * the limit is counted in provider calls, not dispatches: at most four per
--     pass. A two-stage tend-connect-v3 dispatch is two calls, so it gets one
--     retry; a single-request pass gets three;
--   * a dispatch that never reported back (timeout, crash, lease lost after the
--     provider answered) has unknown usage: before the next dispatch its full
--     reservation is booked as spend, and the hard cap can stop it;
--   * a dispatch the provider refused outright is closed without a charge.
--
-- Cost rule, for both transports (finish_garden_pass, keep_provider_orphan):
--   real usage reported            -> real usage at the pass's pinned rates
--   usage unknown, work was sent   -> the full reservation (batch: a file or batch
--                                     id is recorded; sync: a dispatch is open)
--   nothing was ever sent          -> zero
-- Before this migration a pass cancelled or failed before anything reached the
-- provider was charged its full reservation.
--
-- Leases: a released lease has lease_until NULL, and `lease_until < now()` is
-- then NULL, not true, so a stale token passed the old check in
-- finish_garden_pass and could cancel a live pass. Both functions here treat a
-- missing lease as lost.
-- Additive: existing rows become transport='batch', dispatches=0, provider_calls=0.
begin;

alter table private.ai_runtime
  add column transport text not null default 'batch' check(transport in('batch','sync')),
  -- The provider defines the accepted values; only the shape is constrained here.
  add column reasoning_effort text check(reasoning_effort ~ '^[a-z]{2,12}$');

alter table private.pass_inputs
  add column transport text not null default 'batch' check(transport in('batch','sync')),
  add column reasoning_effort text,
  add column dispatches integer not null default 0 check(dispatches>=0),
  add column provider_calls integer not null default 0 check(provider_calls between 0 and 4),
  add column dispatch_open boolean not null default false,
  add column lost_cents numeric not null default 0 check(lost_cents>=0);

-- Freeze the runtime's transport and effort into the pass. A trigger on the
-- private table rather than a rewrite of private.prepare_pass, whose insert it
-- intercepts; nothing else inserts into private.pass_inputs.
create function private.freeze_pass_runtime() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select r.transport,r.reasoning_effort into new.transport,new.reasoning_effort from private.ai_runtime r where r.singleton;
  new.dispatches:=0;
  new.provider_calls:=0;
  new.dispatch_open:=false;
  new.lost_cents:=0;
  return new;
end $$;
create trigger pass_inputs_freeze_runtime before insert on private.pass_inputs
  for each row execute function private.freeze_pass_runtime();
revoke all on function private.freeze_pass_runtime() from public,anon,authenticated;

-- The worker receives the frozen transport, effort and dispatch count with the job.
-- Body otherwise as in ai_tenant_allowlist.
create or replace function public.claim_garden_pass() returns jsonb language plpgsql security invoker set search_path='' as $$
declare job private.pass_inputs; p public.garden_passes; token uuid:=gen_random_uuid();
begin
  select i.* into job from private.pass_inputs i join public.garden_passes gp on gp.id=i.pass_id
    where ((gp.status in('queued','processing') and (select enabled from private.ai_runtime where singleton)
            and exists(select 1 from private.ai_tenants t where t.tenant_id=gp.tenant_id))
        or (gp.status in('cancelled','withdrawn','failed','complete') and i.cleanup_pending))
      and i.next_attempt_at<=now() and (i.lease_until is null or i.lease_until<now())
    order by i.next_attempt_at for update of i skip locked limit 1;
  if job.pass_id is null then return null; end if;
  select * into p from public.garden_passes where id=job.pass_id for update;
  if p.status in('queued','processing') and not ((select enabled from private.ai_runtime where singleton)
      and exists(select 1 from private.ai_tenants t where t.tenant_id=p.tenant_id)) then return null; end if;
  update private.pass_inputs set lease_until=now()+interval '2 minutes',lease_token=token,attempts=attempts+1 where pass_id=job.pass_id;
  if p.status='queued' then update public.garden_passes set status='processing' where id=p.id; end if;
  return jsonb_build_object('id',p.id,'status',p.status,'token',token,'snapshot',job.snapshot,'corrections',job.corrections,'context',job.context,'model',job.model,'workflow_version',job.workflow_version,'provider_id',job.provider_id,'input_file_id',job.input_file_id,'output_file_id',job.output_file_id,'attempts',job.attempts,'created_at',p.created_at,'settled',job.actual_cents is not null,
    'transport',job.transport,'reasoning_effort',job.reasoning_effort,'dispatches',job.dispatches,'provider_calls',job.provider_calls);
end $$;
revoke all on function public.claim_garden_pass() from public,anon,authenticated;
grant execute on function public.claim_garden_pass() to service_role;

-- Called by the worker, under its lease, immediately before a synchronous
-- dispatch (p_rejected=false, p_calls = the provider calls it is about to make)
-- and after the provider refused every call outright (p_rejected=true).
-- Returns a state, never content:
--   'ok'        dispatch recorded; the lease now runs 120 seconds from here
--   'inactive'  the pass may no longer publish (cancelled, revoked, gate closed)
--   'settled'   the pass already has its final cost
--   'limit'     these calls would take the pass past four provider calls
--   'budget'    booking the lost dispatch would cross the hard cap
--   'closed'    (p_rejected) the open dispatch is closed without a charge
-- A missing, released or expired lease raises 'lease lost'.
create function public.mark_garden_dispatch(p_id uuid,p_token uuid,p_rejected boolean default false,p_calls integer default 1) returns text
language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; cap integer; budget private.ai_months;
begin
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.pass_id is null or j.lease_token is distinct from p_token or j.lease_until is null or j.lease_until<=now() then raise exception 'lease lost'; end if;
  if j.transport<>'sync' then raise exception 'not a synchronous pass'; end if;
  if p_rejected then
    update private.pass_inputs set dispatch_open=false where pass_id=p_id;
    return 'closed';
  end if;
  if p_calls is null or p_calls not between 1 and 4 then raise exception 'invalid call count'; end if;
  if j.actual_cents is not null then return 'settled'; end if;
  if not public.check_garden_pass(p_id,p_token) then return 'inactive'; end if;
  if j.provider_calls+p_calls>4 then return 'limit'; end if;
  if j.dispatch_open then
    select hard_cap_cents into cap from private.ai_runtime where singleton;
    select * into budget from private.ai_months where month=j.budget_month for update;
    if budget.reserved_cents+budget.spent_cents+j.reserved_cents>cap then return 'budget'; end if;
    update private.ai_months set spent_cents=spent_cents+j.reserved_cents where month=j.budget_month;
  end if;
  update private.pass_inputs set dispatches=dispatches+1,provider_calls=provider_calls+p_calls,dispatch_open=true,
    lost_cents=lost_cents+case when j.dispatch_open then j.reserved_cents else 0 end,
    lease_until=now()+interval '120 seconds' where pass_id=p_id;
  return 'ok';
end $$;
revoke all on function public.mark_garden_dispatch(uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.mark_garden_dispatch(uuid,uuid,boolean,integer) to service_role;

-- Ingestion. Body as in tending_tiers except: the lease check is NULL-safe, and
-- the cost follows the rule at the top of this file (nothing sent, nothing charged).
create or replace function public.finish_garden_pass(p_id uuid,p_token uuid,p_result jsonb,p_input_tokens integer default 0,p_output_tokens integer default 0,p_failed boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; p public.garden_passes; b jsonb; e jsonb; mk jsonb; idx integer:=0; cost numeric; active boolean; v3 boolean; counts jsonb:='{}'::jsonb; key text;
begin
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.pass_id is null or j.lease_token is distinct from p_token or j.lease_until is null or j.lease_until<=now() then raise exception 'lease lost'; end if;
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
  -- Real usage when it is known. Unknown usage keeps the full reservation, but only
  -- when work actually reached the provider; a pass that never left costs nothing.
  cost:=case when p_input_tokens+p_output_tokens>0 then (greatest(p_input_tokens,0)*j.input_rate+greatest(p_output_tokens,0)*j.output_rate)/1000000
    when j.provider_id is not null or j.input_file_id is not null or j.dispatch_open then j.reserved_cents
    else 0 end;
  update private.ai_months set reserved_cents=greatest(0,reserved_cents-j.reserved_cents),spent_cents=spent_cents+cost where month=j.budget_month;
  update private.pass_inputs set actual_cents=cost,dispatch_open=false,cleanup_pending=true,lease_until=null,next_attempt_at=now() where pass_id=p_id;
  update public.garden_passes set status=case when not active then case when status='withdrawn' then 'withdrawn' else 'cancelled' end when p_failed then 'failed' else 'complete' end,
    no_output_reason=case when active and not p_failed and idx=0 then 'No new reflection this time. Your thoughts can rest.' else null end,finished_at=now() where id=p_id;
end $$;
revoke all on function public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.finish_garden_pass(uuid,uuid,jsonb,integer,integer,boolean) to service_role;

-- A deleted pass settles its reservation (in_app_deletion). A synchronous pass
-- has no provider id, so "reached the provider with unknown usage" is a
-- dispatch that is still open; a refused (closed) dispatch costs nothing.
-- Body otherwise as in in_app_deletion.
create or replace function private.keep_provider_orphan() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.cleanup_pending and (old.provider_id is not null or old.input_file_id is not null or old.output_file_id is not null) then
    insert into private.provider_orphans(provider_id,input_file_id,output_file_id)
      values(old.provider_id,old.input_file_id,old.output_file_id);
  end if;
  if old.actual_cents is null then
    update private.ai_months set reserved_cents=greatest(0,reserved_cents-old.reserved_cents),
      spent_cents=spent_cents+case when old.provider_id is not null or old.input_file_id is not null or old.dispatch_open then old.reserved_cents else 0 end
      where month=old.budget_month;
  end if;
  return old;
end $$;
revoke all on function private.keep_provider_orphan() from public,anon,authenticated;

commit;

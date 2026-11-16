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
--   * at most three dispatches per pass;
--   * a dispatch that never reported back (timeout, crash, lease lost after the
--     provider answered) has unknown usage: before the next dispatch its full
--     reservation is booked as spend, the same conservative rule
--     finish_garden_pass applies to unknown usage, and the hard cap can stop it;
--   * a dispatch the provider refused outright is closed without a charge.
-- Additive: existing rows become transport='batch', dispatches=0.
begin;

alter table private.ai_runtime
  add column transport text not null default 'batch' check(transport in('batch','sync')),
  -- The provider defines the accepted values; only the shape is constrained here.
  add column reasoning_effort text check(reasoning_effort ~ '^[a-z]{2,12}$');

alter table private.pass_inputs
  add column transport text not null default 'batch' check(transport in('batch','sync')),
  add column reasoning_effort text,
  add column dispatches integer not null default 0 check(dispatches between 0 and 3),
  add column dispatch_open boolean not null default false,
  add column lost_cents numeric not null default 0 check(lost_cents>=0);

-- Freeze the runtime's transport and effort into the pass. A trigger on the
-- private table rather than a rewrite of private.prepare_pass, whose insert it
-- intercepts; nothing else inserts into private.pass_inputs.
create function private.freeze_pass_runtime() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select r.transport,r.reasoning_effort into new.transport,new.reasoning_effort from private.ai_runtime r where r.singleton;
  new.dispatches:=0;
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
    'transport',job.transport,'reasoning_effort',job.reasoning_effort,'dispatches',job.dispatches);
end $$;
revoke all on function public.claim_garden_pass() from public,anon,authenticated;
grant execute on function public.claim_garden_pass() to service_role;

-- Called by the worker, under its lease, immediately before a synchronous
-- provider call (p_rejected=false) and after the provider refused the request
-- outright (p_rejected=true). Returns a state, never content:
--   'ok'        dispatch recorded; the lease now runs 120 seconds from here
--   'inactive'  the pass may no longer publish (cancelled, revoked, gate closed)
--   'settled'   the pass already has its final cost
--   'limit'     three dispatches have been made
--   'budget'    booking the lost dispatch would cross the hard cap
--   'closed'    (p_rejected) the open dispatch is closed without a charge
-- A missing or expired lease raises 'lease lost', like the other worker RPCs.
create function public.mark_garden_dispatch(p_id uuid,p_token uuid,p_rejected boolean default false) returns text
language plpgsql security invoker set search_path='' as $$
declare j private.pass_inputs; cap integer; budget private.ai_months;
begin
  select * into j from private.pass_inputs where pass_id=p_id for update;
  if j.pass_id is null or j.lease_token is distinct from p_token or j.lease_until<now() then raise exception 'lease lost'; end if;
  if j.transport<>'sync' then raise exception 'not a synchronous pass'; end if;
  if p_rejected then
    update private.pass_inputs set dispatch_open=false where pass_id=p_id;
    return 'closed';
  end if;
  if j.actual_cents is not null then return 'settled'; end if;
  if not public.check_garden_pass(p_id,p_token) then return 'inactive'; end if;
  if j.dispatches>=3 then return 'limit'; end if;
  if j.dispatch_open then
    select hard_cap_cents into cap from private.ai_runtime where singleton;
    select * into budget from private.ai_months where month=j.budget_month for update;
    if budget.reserved_cents+budget.spent_cents+j.reserved_cents>cap then return 'budget'; end if;
    update private.ai_months set spent_cents=spent_cents+j.reserved_cents where month=j.budget_month;
  end if;
  update private.pass_inputs set dispatches=dispatches+1,dispatch_open=true,
    lost_cents=lost_cents+case when j.dispatch_open then j.reserved_cents else 0 end,
    lease_until=now()+interval '120 seconds' where pass_id=p_id;
  return 'ok';
end $$;
revoke all on function public.mark_garden_dispatch(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.mark_garden_dispatch(uuid,uuid,boolean) to service_role;

-- A deleted pass settles its reservation (in_app_deletion). A synchronous pass
-- has no provider id, so "reached the provider" is also true when a dispatch
-- was recorded. Body otherwise as in in_app_deletion.
create or replace function private.keep_provider_orphan() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.cleanup_pending and (old.provider_id is not null or old.input_file_id is not null or old.output_file_id is not null) then
    insert into private.provider_orphans(provider_id,input_file_id,output_file_id)
      values(old.provider_id,old.input_file_id,old.output_file_id);
  end if;
  if old.actual_cents is null then
    update private.ai_months set reserved_cents=greatest(0,reserved_cents-old.reserved_cents),
      spent_cents=spent_cents+case when old.provider_id is not null or old.input_file_id is not null or old.dispatches>0 then old.reserved_cents else 0 end
      where month=old.budget_month;
  end if;
  return old;
end $$;
revoke all on function private.keep_provider_orphan() from public,anon,authenticated;

commit;

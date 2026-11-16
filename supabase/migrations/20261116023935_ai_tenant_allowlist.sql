-- Owner-only guard for AI tending (D-024, activation prerequisites 2026-11-16).
--
-- private.ai_runtime is one switch for the whole project, and authenticated holds
-- INSERT on public.garden_passes, so with enabled=true any signed-in account could
-- send its own writing to the provider on the project's key and budget, whatever the
-- web flag says. This adds an allowlist the database enforces at every entry point:
--   * a pass requested by a person (BEFORE INSERT on public.garden_passes),
--   * nightly enqueue (private.enqueue_nightly_passes),
--   * the worker's claim and its publish check (claim_garden_pass, check_garden_pass).
-- With the allowlist empty nothing runs, even when enabled=true.
-- Only the operator (postgres) and the service role can change it; no API role can
-- read it. Removing a tenant cancels that tenant's queued and in-flight passes, so
-- the existing cleanup path releases their reservations and provider work.
-- Additive: no existing row or column changes.
begin;

create table private.ai_tenants (
  tenant_id uuid primary key references public.accounts(id) on delete cascade,
  approved_at timestamptz not null default now(),
  note text check(char_length(note)<=200)
);
alter table private.ai_tenants enable row level security;
create policy ai_tenants_backend_only on private.ai_tenants for all to service_role using(true) with check(true);
revoke all on private.ai_tenants from public,anon,authenticated;
grant select,insert,update,delete on private.ai_tenants to service_role;

-- Pass creation. A separate trigger rather than a rewrite of private.prepare_pass:
-- it fires first (trigger names fire in alphabetical order, and either trigger
-- refusing is enough). While the runtime is disabled it stays silent so the
-- existing "gate has not been activated" refusal is unchanged.
-- The message is safe to show a person; the web maps SQLSTATE 55000 to its own copy.
create function private.require_ai_tenant() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select enabled from private.ai_runtime where singleton)
     and not exists(select 1 from private.ai_tenants t where t.tenant_id=new.tenant_id) then
    raise exception 'tending is not available for this account yet' using errcode='55000';
  end if;
  return new;
end $$;
create trigger passes_allowlist before insert on public.garden_passes
  for each row execute function private.require_ai_tenant();
revoke all on function private.require_ai_tenant() from public,anon,authenticated;

-- Leaving the allowlist stops the tenant's active work through the normal path:
-- cancelled passes are queued for cleanup (passes_cleanup) and are still claimed
-- for that cleanup whatever the allowlist or the runtime switch says.
-- Lock order matches claim and finish: private.pass_inputs, then public.garden_passes.
create function private.cancel_removed_ai_tenant() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_pass_inputs(array(select id from public.garden_passes
    where tenant_id=old.tenant_id and status in('queued','processing')));
  update public.garden_passes set status='cancelled',finished_at=now()
    where tenant_id=old.tenant_id and status in('queued','processing');
  return old;
end $$;
create trigger ai_tenants_removed after delete on private.ai_tenants
  for each row execute function private.cancel_removed_ai_tenant();
revoke all on function private.cancel_removed_ai_tenant() from public,anon,authenticated;

-- The worker never claims active work for a tenant that is not allowlisted.
-- Cleanup of terminal passes is unchanged. Body otherwise as in tending_tiers.
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
  return jsonb_build_object('id',p.id,'status',p.status,'token',token,'snapshot',job.snapshot,'corrections',job.corrections,'context',job.context,'model',job.model,'workflow_version',job.workflow_version,'provider_id',job.provider_id,'input_file_id',job.input_file_id,'output_file_id',job.output_file_id,'attempts',job.attempts,'created_at',p.created_at,'settled',job.actual_cents is not null);
end $$;

-- A leased pass may publish only while its tenant is still allowlisted.
create or replace function public.check_garden_pass(p_id uuid,p_token uuid) returns boolean language sql security invoker set search_path='' as $$
  select exists(select 1 from private.pass_inputs i join public.garden_passes p on p.id=i.pass_id
    where i.pass_id=p_id and i.lease_token=p_token and i.lease_until>now() and p.status in('queued','processing') and exists(select 1 from public.gardens g where g.id=p.garden_id and g.status='active') and (select enabled from private.ai_runtime where singleton)
    and exists(select 1 from private.ai_tenants t where t.tenant_id=p.tenant_id)
    and not exists(select 1 from jsonb_each_text(i.permissions) v left join public.plots q on q.id=v.key::uuid where q.id is null or q.permission_version<>v.value::integer or not q.ai_enabled or q.archived_at is not null));
$$;
revoke all on function public.claim_garden_pass(),public.check_garden_pass(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_garden_pass(),public.check_garden_pass(uuid,uuid) to service_role;

-- Nightly enqueue considers only allowlisted accounts. Body otherwise as in tending_tiers.
create or replace function private.enqueue_nightly_passes(p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare a record; s record; n integer:=0; made integer; last timestamptz;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  for a in select id from public.accounts acc where tend_overnight and extract(hour from p_now at time zone timezone)=2
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id) loop
    if exists(select 1 from public.garden_passes where tenant_id=a.id and trigger='nightly' and created_at>p_now-interval '20 hours') then continue; end if;
    made:=0;
    for s in
      select pl.garden_id,array_agg(pl.id order by pl.id) as plot_ids
        from public.plots pl join public.gardens g on g.id=pl.garden_id and g.status='active'
        where pl.tenant_id=a.id and pl.ai_enabled and pl.archived_at is null
        group by pl.garden_id,case when pl.cross_pollinate then null else pl.id end
    loop
      exit when made>=p_per_tenant;
      -- Same watermark as prepare_pass: the last completed snapshot, not its finish time.
      select max(created_at) into last from public.garden_passes
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

-- In-app deletion (D-024). Archive hides; these RPCs erase, permanently.
-- Scopes: entry, thought (seed), topic (plot), garden, account.
-- Rules:
--   * Derived material never outlives its source. A pass that read deleted
--     writing loses its snapshot, blooms and marks; copies of excerpts,
--     titles and labels in other passes' correction/index context are removed.
--   * Provider file and batch ids are never lost with a deleted pass: a
--     content-free private.provider_orphans row keeps them for worker cleanup
--     (runbook known gap 3.9), and the pass's budget reservation is settled.
--   * Each RPC acts only on rows owned by auth.uid(). An id that is missing or
--     belongs to another tenant is a no-op ({"deleted": false}), so a replay is
--     safe and the RPC is not an existence oracle.
--   * Deletion and pass preparation serialise on the caller's accounts row
--     (the lock prepare_pass takes), so a pass prepared at the same moment
--     either is erased with the writing or never sees it.
--   * Lock order is always private.pass_inputs, then public.garden_passes, the
--     order claim_garden_pass and finish_garden_pass use.
-- SECURITY DEFINER is deliberate: authenticated has no DELETE on entries,
-- plots or immutable revisions, and cannot read or scrub private.pass_inputs.
begin;

-- The RPCs below are the only way to erase. A direct DELETE cascaded the rows
-- but could not scrub copies held by other passes, so it is withdrawn.
drop policy gardens_delete_own on public.gardens;
drop policy seeds_delete_own on public.seeds;
revoke delete on public.gardens,public.seeds from authenticated;

-- Provider cleanup that must survive the pass it belonged to. Ids only.
create table private.provider_orphans (
  id uuid primary key default gen_random_uuid(),
  provider_id text,
  input_file_id text,
  output_file_id text,
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  check (provider_id is not null or input_file_id is not null or output_file_id is not null)
);
create index provider_orphans_due_idx on private.provider_orphans(next_attempt_at);
alter table private.provider_orphans enable row level security;
create policy orphans_backend_only on private.provider_orphans for all to service_role using(true) with check(true);
revoke all on private.provider_orphans from public,anon,authenticated;
grant all on private.provider_orphans to service_role;

-- Runs for every path that removes a pass (these RPCs, a cascade, an operator).
create function private.keep_provider_orphan() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.cleanup_pending and (old.provider_id is not null or old.input_file_id is not null or old.output_file_id is not null) then
    insert into private.provider_orphans(provider_id,input_file_id,output_file_id)
      values(old.provider_id,old.input_file_id,old.output_file_id);
  end if;
  -- An unsettled reservation would otherwise stay reserved forever. Work that
  -- reached the provider keeps its full reservation as spend (the same
  -- conservative rule finish_garden_pass applies to unknown usage); work that
  -- never left is released.
  if old.actual_cents is null then
    update private.ai_months set reserved_cents=greatest(0,reserved_cents-old.reserved_cents),
      spent_cents=spent_cents+case when old.provider_id is not null or old.input_file_id is not null then old.reserved_cents else 0 end
      where month=old.budget_month;
  end if;
  return old;
end $$;
create trigger pass_inputs_keep_orphan before delete on private.pass_inputs
  for each row execute function private.keep_provider_orphan();
revoke all on function private.keep_provider_orphan() from public,anon,authenticated;

-- Service-only drain, leased like garden passes. After twenty attempts an
-- orphan is no longer claimed; it stays, with its ids, for an operator.
create function public.claim_provider_orphan() returns jsonb language plpgsql security invoker set search_path='' as $$
declare o private.provider_orphans; token uuid:=gen_random_uuid();
begin
  select * into o from private.provider_orphans
    where next_attempt_at<=now() and (lease_until is null or lease_until<now()) and attempts<20
    order by next_attempt_at for update skip locked limit 1;
  if o.id is null then return null; end if;
  update private.provider_orphans set lease_until=now()+interval '2 minutes',lease_token=token,attempts=attempts+1 where id=o.id;
  return jsonb_build_object('id',o.id,'token',token,'provider_id',o.provider_id,'input_file_id',o.input_file_id,'output_file_id',o.output_file_id,'attempts',o.attempts+1);
end $$;
create function public.resolve_provider_orphan(p_id uuid,p_token uuid,p_done boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_done then
    delete from private.provider_orphans where id=p_id and lease_token=p_token and lease_until>now();
  else
    update private.provider_orphans set lease_until=null,next_attempt_at=now()+interval '5 minutes'
      where id=p_id and lease_token=p_token and lease_until>now();
  end if;
  if not found then raise exception 'lease lost'; end if;
end $$;
revoke all on function public.claim_provider_orphan(),public.resolve_provider_orphan(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_provider_orphan(),public.resolve_provider_orphan(uuid,uuid,boolean) to service_role;

-- Take pass input locks in one order, before any pass row is touched.
create function private.lock_pass_inputs(p_pass_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from private.pass_inputs where pass_id=any(p_pass_ids) order by pass_id for update;
end $$;
revoke all on function private.lock_pass_inputs(uuid[]) from public,anon,authenticated;

-- Every pass of this tenant that read, quoted or marked the given writing.
-- Found three independent ways so a blanked snapshot cannot hide a claim.
create function private.passes_reading(p_tenant uuid,p_seed_ids uuid[],p_entry_ids uuid[]) returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct x.pass_id),'{}') from (
    select i.pass_id from private.pass_inputs i join public.garden_passes gp on gp.id=i.pass_id
      where gp.tenant_id=p_tenant and exists(select 1 from jsonb_array_elements(i.snapshot) s
        where s->>'seed_id'=any(p_seed_ids::text[]) or s->>'entry_id'=any(p_entry_ids::text[]))
    union all
    select b.pass_id from public.blooms b cross join lateral jsonb_array_elements(b.evidence) e
      join public.seed_revisions r on r.id::text=e->>'revision_id'
      where b.tenant_id=p_tenant and r.tenant_id=p_tenant and (r.seed_id=any(p_seed_ids) or r.entry_id=any(p_entry_ids))
    union all
    select m.pass_id from public.tending_marks m
      where m.tenant_id=p_tenant and (m.seed_id=any(p_seed_ids) or exists(
        select 1 from jsonb_array_elements(m.evidence) e join public.seed_revisions r on r.id::text=e->>'revision_id'
        where r.tenant_id=p_tenant and r.entry_id=any(p_entry_ids)))
  ) x;
$$;
revoke all on function private.passes_reading(uuid,uuid[],uuid[]) from public,anon,authenticated;

-- Remove or make unreadable everything derived from the given writing. Call
-- before the source rows go: evidence is resolved through their revisions.
-- p_index_seed_ids are thoughts whose title or labels must leave other passes'
-- orientation index.
create function private.erase_derived(p_tenant uuid,p_seed_ids uuid[],p_entry_ids uuid[],p_index_seed_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare affected uuid[]; revs text[]; gone_evidence jsonb[]; gone_text text[]; gone_labels text[];
begin
  affected:=private.passes_reading(p_tenant,p_seed_ids,p_entry_ids);
  perform private.lock_pass_inputs(affected);
  select coalesce(array_agg(id::text),'{}') into revs from public.seed_revisions
    where tenant_id=p_tenant and (seed_id=any(p_seed_ids) or entry_id=any(p_entry_ids));
  select coalesce(array_agg(evidence),'{}'),coalesce(array_agg(interpretation),'{}') into gone_evidence,gone_text
    from public.blooms where pass_id=any(affected);
  select coalesce(array_agg(lower(label)) filter(where label<>''),'{}') into gone_labels
    from public.tending_marks where pass_id=any(affected) or (tenant_id=p_tenant and seed_id=any(p_seed_ids));
  -- Withdraw first: the existing cleanup trigger then queues provider files for deletion.
  update public.garden_passes set status=case when status='complete' then 'withdrawn' else 'cancelled' end,finished_at=now()
    where id=any(affected) and status in('queued','processing','complete');
  update private.pass_inputs set snapshot='[]',corrections='[]',context='{}' where pass_id=any(affected);
  delete from public.blooms where pass_id=any(affected);
  delete from public.tending_marks where pass_id=any(affected);
  -- Passes that never read this writing can still carry copies: quoted evidence
  -- and interpretations inside remembered corrections, and titles and labels in
  -- the orientation index.
  update private.pass_inputs i set
    corrections=(select coalesce(jsonb_agg(c),'[]') from jsonb_array_elements(i.corrections) c
      where (c->'evidence'=any(gone_evidence)) is not true
        and (c->>'interpretation'=any(gone_text)) is not true
        and (lower(c->>'label')=any(gone_labels)) is not true
        and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c->'evidence')='array' then c->'evidence' else '[]'::jsonb end) e
          where e->>'revision_id'=any(revs))),
    context=case when jsonb_typeof(i.context->'index')='array' then jsonb_set(i.context,'{index}',
      (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(i.context->'index') x where (x->>'seed_id'=any(p_index_seed_ids::text[])) is not true)) else i.context end
    from public.garden_passes gp
    where gp.id=i.pass_id and gp.tenant_id=p_tenant and not (i.pass_id=any(affected))
      and (i.corrections<>'[]'::jsonb or jsonb_typeof(i.context->'index')='array');
end $$;
revoke all on function private.erase_derived(uuid,uuid[],uuid[],uuid[]) from public,anon,authenticated;

-- What a deletion will erase, counted from the same sets the deletion uses.
-- Returns null when the item is missing or not the tenant's.
create function private.deletion_scope(p_tenant uuid,p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_name text; v_gardens uuid[]:='{}'::uuid[]; v_plots uuid[]:='{}'::uuid[]; v_seeds uuid[]:='{}'::uuid[]; v_entries uuid[]:='{}'::uuid[]; v_passes uuid[]:='{}'::uuid[]; v_seed uuid;
begin
  if p_kind='entry' then
    select seed_id into v_seed from public.entries where id=p_id and tenant_id=p_tenant;
    if v_seed is null then return null; end if;
    select title into v_name from public.seeds where id=v_seed;
    v_entries:=array[p_id];
    v_passes:=private.passes_reading(p_tenant,'{}',v_entries);
  elsif p_kind='seed' then
    select title into v_name from public.seeds where id=p_id and tenant_id=p_tenant;
    if v_name is null then return null; end if;
    v_seeds:=array[p_id];
  elsif p_kind='plot' then
    select name into v_name from public.plots where id=p_id and tenant_id=p_tenant;
    if v_name is null then return null; end if;
    v_plots:=array[p_id];
    select coalesce(array_agg(id),'{}') into v_seeds from public.seeds where plot_id=p_id and tenant_id=p_tenant;
  elsif p_kind='garden' then
    select name into v_name from public.gardens where id=p_id and tenant_id=p_tenant;
    if v_name is null then return null; end if;
    v_gardens:=array[p_id];
  elsif p_kind='account' then
    if not exists(select 1 from public.accounts where id=p_tenant) then return null; end if;
    select coalesce(array_agg(id),'{}') into v_gardens from public.gardens where tenant_id=p_tenant;
  else
    raise exception 'unknown deletion scope' using errcode='22023';
  end if;
  if p_kind in('garden','account') then
    select coalesce(array_agg(id),'{}') into v_plots from public.plots where tenant_id=p_tenant and garden_id=any(v_gardens);
    select coalesce(array_agg(id),'{}') into v_seeds from public.seeds where tenant_id=p_tenant and garden_id=any(v_gardens);
    select coalesce(array_agg(id),'{}') into v_passes from public.garden_passes where tenant_id=p_tenant and garden_id=any(v_gardens);
  end if;
  if p_kind<>'entry' then
    select coalesce(array_agg(id),'{}') into v_entries from public.entries where tenant_id=p_tenant and seed_id=any(v_seeds);
  end if;
  if p_kind in('seed','plot') then
    v_passes:=private.passes_reading(p_tenant,v_seeds,v_entries);
    if p_kind='plot' then
      select coalesce(array_agg(distinct x),'{}') into v_passes from (
        select unnest(v_passes) as x union all
        select id from public.garden_passes where tenant_id=p_tenant and p_id=any(plot_ids)) y;
    end if;
  end if;
  -- Returns and marks are counted as the person saw them: from completed passes.
  return jsonb_build_object('kind',p_kind,'name',v_name,
    'gardens',cardinality(v_gardens),'topics',cardinality(v_plots),'thoughts',cardinality(v_seeds),'entries',cardinality(v_entries),
    'versions',(select count(*) from public.seed_revisions where tenant_id=p_tenant and entry_id=any(v_entries)),
    'returns',(select count(*) from public.blooms b join public.garden_passes gp on gp.id=b.pass_id and gp.status='complete' where b.pass_id=any(v_passes)),
    'responses',(select count(*) from public.bloom_responses r join public.blooms b on b.id=r.bloom_id
      join public.garden_passes gp on gp.id=b.pass_id and gp.status='complete' where b.pass_id=any(v_passes)),
    'marks',(select count(*) from public.tending_marks m join public.garden_passes gp on gp.id=m.pass_id and gp.status='complete'
      where m.pass_id=any(v_passes) or (m.tenant_id=p_tenant and m.seed_id=any(v_seeds))));
end $$;
revoke all on function private.deletion_scope(uuid,text,uuid) from public,anon,authenticated;

-- Read-only: the counts the confirmation dialog shows.
create function public.deletion_preview(p_kind text,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid();
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  return private.deletion_scope(v_tenant,p_kind,case when p_kind='account' then v_tenant else p_id end);
end $$;

create function public.delete_entry(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_seed uuid; receipt jsonb;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  select seed_id into v_seed from public.entries where id=p_entry_id and tenant_id=v_tenant;
  if v_seed is null then return jsonb_build_object('deleted',false); end if;
  -- save_entry serialises on the thought; so does deletion.
  perform 1 from public.seeds where id=v_seed and tenant_id=v_tenant for update;
  receipt:=private.deletion_scope(v_tenant,'entry',p_entry_id);
  if receipt is null then return jsonb_build_object('deleted',false); end if;
  perform private.erase_derived(v_tenant,'{}',array[p_entry_id],array[v_seed]);
  delete from public.entries where id=p_entry_id and tenant_id=v_tenant;
  return receipt||jsonb_build_object('deleted',true);
end $$;

create function public.delete_seed(p_seed_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); receipt jsonb; v_entries uuid[];
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  perform 1 from public.seeds where id=p_seed_id and tenant_id=v_tenant for update;
  if not found then return jsonb_build_object('deleted',false); end if;
  receipt:=private.deletion_scope(v_tenant,'seed',p_seed_id);
  select coalesce(array_agg(id),'{}') into v_entries from public.entries where seed_id=p_seed_id and tenant_id=v_tenant;
  perform private.erase_derived(v_tenant,array[p_seed_id],v_entries,array[p_seed_id]);
  delete from public.seeds where id=p_seed_id and tenant_id=v_tenant;
  return receipt||jsonb_build_object('deleted',true);
end $$;

-- Topic, garden and account need the name typed back; the database checks it too.
create function public.delete_plot(p_plot_id uuid,p_confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); p public.plots; receipt jsonb; v_seeds uuid[]; v_entries uuid[];
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into p from public.plots where id=p_plot_id and tenant_id=v_tenant for update;
  if p.id is null then return jsonb_build_object('deleted',false); end if;
  if btrim(coalesce(p_confirm_name,''))<>btrim(p.name) then raise exception 'confirmation does not match' using errcode='22023'; end if;
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

create function private.erase_garden(p_tenant uuid,p_garden_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Passes first: their inputs, blooms and marks cascade, and source deletes below stay cheap.
  perform private.lock_pass_inputs(array(select id from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id));
  delete from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.seeds where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.plots where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.gardens where tenant_id=p_tenant and id=p_garden_id;
end $$;
revoke all on function private.erase_garden(uuid,uuid) from public,anon,authenticated;

create function public.delete_garden(p_garden_id uuid,p_confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); g public.gardens; receipt jsonb;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into g from public.gardens where id=p_garden_id and tenant_id=v_tenant for update;
  if g.id is null then return jsonb_build_object('deleted',false); end if;
  if btrim(coalesce(p_confirm_name,''))<>btrim(g.name) then raise exception 'confirmation does not match' using errcode='22023'; end if;
  receipt:=private.deletion_scope(v_tenant,'garden',p_garden_id);
  perform private.erase_garden(v_tenant,p_garden_id);
  return receipt||jsonb_build_object('deleted',true);
end $$;

-- Erases every garden, then the account row and the sign-in identity itself
-- (auth.users; sessions, identities and refresh tokens cascade). One
-- transaction: if the identity cannot be removed, nothing is erased.
-- The confirmation is the account's email address, or the words
-- "delete my account" when the session carries no email.
-- An access token alone is not enough: the token's session must still exist
-- (not signed out or revoked), belong to this user, and have been created by a
-- sign-in within the last ten minutes. Otherwise SQLSTATE SGA01.
create function public.delete_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_expected text; receipt jsonb; g uuid;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform 1 from public.accounts where id=v_tenant for update;
  if not found then return jsonb_build_object('deleted',false); end if;
  if not exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=v_tenant
      and (s.not_after is null or s.not_after>now()) and s.created_at>now()-interval '10 minutes') then
    raise exception 'recent sign-in required' using errcode='SGA01';
  end if;
  v_expected:=coalesce(nullif(lower(btrim(auth.jwt()->>'email')),''),'delete my account');
  if lower(btrim(coalesce(p_confirm,'')))<>v_expected then raise exception 'confirmation does not match' using errcode='22023'; end if;
  receipt:=private.deletion_scope(v_tenant,'account',v_tenant);
  for g in select id from public.gardens where tenant_id=v_tenant loop
    perform private.erase_garden(v_tenant,g);
  end loop;
  delete from auth.users where id=v_tenant;
  delete from public.accounts where id=v_tenant;
  if exists(select 1 from auth.users where id=v_tenant) then raise exception 'sign-in identity could not be removed' using errcode='55000'; end if;
  return receipt||jsonb_build_object('deleted',true);
end $$;

revoke all on function public.deletion_preview(text,uuid),public.delete_entry(uuid),public.delete_seed(uuid),
  public.delete_plot(uuid,text),public.delete_garden(uuid,text),public.delete_account(text) from public,anon;
grant execute on function public.deletion_preview(text,uuid),public.delete_entry(uuid),public.delete_seed(uuid),
  public.delete_plot(uuid,text),public.delete_garden(uuid,text),public.delete_account(text) to authenticated;

commit;

-- Rules the browser data path needs the database to hold (ADR-009 stage 1,
-- CLIENT_DATA_LAYER_2026-11-16 blockers 1 to 7). Until now these were checked
-- only by server actions; a browser that talks to Supabase with the person's
-- own session would have skipped them.
--   1. Deployment switches and public.garden_capabilities(): what this account
--      may use (tending, deletion), answered by the database. Deletion gets a
--      switch of its own, default off, and every deletion RPC refuses while it
--      is off (SQLSTATE SGA03).
--   2. A bloom response of 'correct' carries a non-blank correction; any other
--      response carries none.
--   3. No new thought in an archived topic or garden (SQLSTATE SGA02), and no
--      new writing in an archived thought, topic, garden or entry (22023).
--   4. Names, titles and bodies are never blank, where "blank" is exactly what
--      JavaScript's String.prototype.trim() empties (private.trim_text). Names
--      and titles are stored trimmed.
--   5. Lengths are counted the way the web counts them: UTF-16 code units
--      (private.utf16_length). Time zone names keep the web's shape and length.
--   6. public.import_thought: one transaction, at most 500 entries and
--      1,048,576 bytes of text, and the only way a person can date an entry.
--   7. entries.created_at and seed_revisions.created_at are no longer writable
--      by the owner (column grants); import_thought sets an entry's date.
-- Existing rows are checked first: if any would violate a new constraint the
-- migration stops before changing anything and reports counts only.
-- Additive for data: no existing row is rewritten.
begin;

-- ---------------------------------------------------------------------------
-- Text helpers. Pure and immutable; used by check constraints, so the roles
-- that write rows must be able to execute them. The private schema itself
-- stays closed, so they are not callable through the API.
-- ---------------------------------------------------------------------------

-- The characters String.prototype.trim() removes (ECMAScript WhiteSpace and
-- LineTerminator): U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028,
-- U+2029, U+202F, U+205F, U+3000, U+FEFF. Zero-width space (U+200B), the
-- joiners, U+2060, U+180E and U+0085 are NOT in the set, on the web or here.
-- Kept in step with BLANK_CHARACTERS in applications/web/src/lib/garden/store/rules.ts
-- (rules.test.ts reads this literal and compares).
create function private.trim_text(v text) returns text language sql immutable set search_path='' as $$
  select btrim(v, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF');
$$;
-- JavaScript's string length: characters outside the Basic Multilingual Plane count twice.
create function private.utf16_length(v text) returns integer language sql immutable set search_path='' as $$
  select char_length(v)+char_length(regexp_replace(v,'[^\U00010000-\U0010FFFF]','','g'));
$$;
-- The web's isCalendarDate: YYYY-MM-DD, a real day, year 0100 or later.
create function private.is_calendar_date(v text) returns boolean language plpgsql immutable set search_path='' as $$
begin
  if v is null or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v,4)::integer<100 then return false; end if;
  perform make_date(left(v,4)::integer,substr(v,6,2)::integer,substr(v,9,2)::integer);
  return true;
exception when datetime_field_overflow or invalid_datetime_format then
  return false;
end $$;
revoke all on function private.trim_text(text),private.utf16_length(text),private.is_calendar_date(text) from public,anon;
grant execute on function private.trim_text(text),private.utf16_length(text) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Pre-check. Counts only; no content is read into the message.
-- ---------------------------------------------------------------------------
do $$
declare n_gardens bigint; n_plots bigint; n_seeds bigint; n_bodies bigint; n_responses bigint; n_zones bigint;
begin
  select count(*) into n_gardens from public.gardens where private.trim_text(name)='' or private.utf16_length(name)>120;
  select count(*) into n_plots from public.plots where private.trim_text(name)='' or private.utf16_length(name)>120;
  select count(*) into n_seeds from public.seeds where private.trim_text(title)='' or private.utf16_length(title)>160;
  select count(*) into n_bodies from public.seed_revisions where private.trim_text(body)='' or private.utf16_length(body)>20000;
  select count(*) into n_responses from public.bloom_responses
    where case when response='correct' then correction is null or private.trim_text(correction)='' else correction is not null end;
  select count(*) into n_zones from public.accounts
    where char_length(timezone)>64 or timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$';
  if n_gardens+n_plots+n_seeds+n_bodies+n_responses+n_zones>0 then
    raise exception 'browser_path_rules pre-check: existing rows would violate the new rules (garden names %, topic names %, thought titles %, bodies %, bloom responses %, time zones %); nothing was changed',
      n_gardens,n_plots,n_seeds,n_bodies,n_responses,n_zones using errcode='23514';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Blockers 5 and 8: blank text and lengths.
-- The web refuses a name that trim() empties or that is longer than the limit
-- before trimming, then stores it trimmed. The triggers do the same for any
-- writer (SECURITY DEFINER only so they can reach the private helpers; they
-- touch nothing but the new row); the constraints state the stored-row rule and were validated against
-- every existing row. The older btrim-based constraints stay.
-- ---------------------------------------------------------------------------
create function private.clean_area_name() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.name is not null then
    if private.trim_text(new.name)='' or private.utf16_length(new.name)>120 then
      raise exception 'choose a short name' using errcode='23514';
    end if;
    new.name:=private.trim_text(new.name);
  end if;
  return new;
end $$;
create function private.clean_seed_title() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.title is not null then
    if private.trim_text(new.title)='' or private.utf16_length(new.title)>160 then
      raise exception 'choose a short name' using errcode='23514';
    end if;
    new.title:=private.trim_text(new.title);
  end if;
  return new;
end $$;
revoke all on function private.clean_area_name(),private.clean_seed_title() from public,anon,authenticated;
create trigger gardens_clean_name before insert or update of name on public.gardens
  for each row execute function private.clean_area_name();
create trigger plots_clean_name before insert or update of name on public.plots
  for each row execute function private.clean_area_name();
create trigger seeds_clean_title before insert or update of title on public.seeds
  for each row execute function private.clean_seed_title();

alter table public.gardens add constraint gardens_name_rule
  check (private.trim_text(name)<>'' and private.utf16_length(name)<=120) not valid;
alter table public.plots add constraint plots_name_rule
  check (private.trim_text(name)<>'' and private.utf16_length(name)<=120) not valid;
alter table public.seeds add constraint seeds_title_rule
  check (private.trim_text(title)<>'' and private.utf16_length(title)<=160) not valid;
alter table public.seed_revisions add constraint seed_revisions_body_rule
  check (private.trim_text(body)<>'' and private.utf16_length(body)<=20000) not valid;
-- The web's validateTimezone; private.check_account_timezone still requires a real zone.
alter table public.accounts add constraint accounts_timezone_shape
  check (char_length(timezone)<=64 and timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$') not valid;

-- ---------------------------------------------------------------------------
-- Blocker 3: a correction is text the next pass's model is given, so it must be
-- there when the response says so and absent otherwise.
-- ---------------------------------------------------------------------------
alter table public.bloom_responses add constraint bloom_responses_correction_rule
  check (case when response='correct' then correction is not null and private.trim_text(correction)<>'' else correction is null end) not valid;

alter table public.gardens validate constraint gardens_name_rule;
alter table public.plots validate constraint plots_name_rule;
alter table public.seeds validate constraint seeds_title_rule;
alter table public.seed_revisions validate constraint seed_revisions_body_rule;
alter table public.accounts validate constraint accounts_timezone_shape;
alter table public.bloom_responses validate constraint bloom_responses_correction_rule;

-- ---------------------------------------------------------------------------
-- Blocker 4: archived places take no new writing.
-- SECURITY DEFINER so the check reads the true rows whoever inserts.
-- ---------------------------------------------------------------------------
-- A new thought. FOR SHARE waits for an archive in progress (an archive needs
-- the row lock), so a thought cannot land in a topic archived at the same
-- moment. Lock order: garden, then topic. Named to fire after seeds_default_plot.
-- A parent that is missing or another tenant's is left to the composite foreign
-- key, which refuses it as before (23503).
create function private.refuse_archived_parent() returns trigger language plpgsql security definer set search_path='' as $$
declare v_status public.garden_status; v_archived timestamptz;
begin
  select g.status into v_status from public.gardens g where g.id=new.garden_id and g.tenant_id=new.tenant_id for share;
  if found and v_status<>'active' then raise exception 'choose an active topic' using errcode='SGA02'; end if;
  select p.archived_at into v_archived from public.plots p where p.id=new.plot_id and p.tenant_id=new.tenant_id and p.garden_id=new.garden_id for share;
  if found and v_archived is not null then raise exception 'choose an active topic' using errcode='SGA02'; end if;
  return new;
end $$;
create trigger seeds_refuse_archived_parent before insert on public.seeds
  for each row execute function private.refuse_archived_parent();
revoke all on function private.refuse_archived_parent() from public,anon,authenticated;

-- A new entry or revision, by save_entry, import or a direct insert. Same
-- message and SQLSTATE as save_entry's own refusal; adds the garden, and covers
-- inserts that do not go through save_entry. Named to fire after revisions_default_entry.
create function private.refuse_archived_writing() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.seeds s join public.plots p on p.id=s.plot_id join public.gardens g on g.id=s.garden_id
        where s.id=new.seed_id and s.status='active' and p.archived_at is null and g.status='active')
      or exists(select 1 from public.entries e where e.id=new.entry_id and e.archived_at is not null) then
    raise exception 'restore this thought before writing' using errcode='22023';
  end if;
  return new;
end $$;
create trigger revisions_refuse_archived before insert on public.seed_revisions
  for each row execute function private.refuse_archived_writing();
revoke all on function private.refuse_archived_writing() from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- Blocker 7: source dates belong to the database. A person's own session can
-- no longer set or move entries.created_at or seed_revisions.created_at; both
-- feed the tending watermark and the "change over time" tier. Archiving an
-- entry is still an owner update. Import dates go through import_thought.
-- ---------------------------------------------------------------------------
revoke insert,update on public.entries from authenticated;
grant insert(id,tenant_id,garden_id,seed_id),update(archived_at) on public.entries to authenticated;
revoke insert on public.seed_revisions from authenticated;
grant insert(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) on public.seed_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- Blockers 1 and 2: deployment switches the database owns.
-- One row. Only the operator (postgres) and the service role can change it; no
-- API role can read it. A missing row reads as off.
-- ---------------------------------------------------------------------------
create table private.deployment_switches (
  singleton boolean primary key default true check(singleton),
  deletion_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.deployment_switches(singleton) values(true);
alter table private.deployment_switches enable row level security;
create policy deployment_switches_backend_only on private.deployment_switches for all to service_role using(true) with check(true);
revoke all on private.deployment_switches from public,anon,authenticated,service_role;
grant select,update on private.deployment_switches to service_role;
create trigger deployment_switches_set_updated_at before update on private.deployment_switches
  for each row execute function private.set_updated_at();

create function private.require_deletion_enabled() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce((select deletion_enabled from private.deployment_switches where singleton),false) then
    raise exception 'deletion is not available' using errcode='SGA03';
  end if;
end $$;
revoke all on function private.require_deletion_enabled() from public,anon,authenticated;

-- What the caller may use. Booleans about the caller only: `tending` is true
-- when the runtime is enabled AND this account is on the allowlist, so an
-- account that is not allowlisted learns nothing about the runtime or anyone
-- else. Read-only.
create function public.garden_capabilities() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid();
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  return jsonb_build_object(
    'tending',coalesce((select enabled from private.ai_runtime where singleton),false)
      and exists(select 1 from private.ai_tenants t where t.tenant_id=v_tenant),
    'deletion',coalesce((select deletion_enabled from private.deployment_switches where singleton),false));
end $$;
revoke all on function public.garden_capabilities() from public,anon;
grant execute on function public.garden_capabilities() to authenticated;

-- The deletion RPCs, each with one added line after the sign-in check:
-- perform private.require_deletion_enabled(). Bodies otherwise as in
-- 20261116010931_in_app_deletion.sql; grants are unchanged.
create or replace function public.deletion_preview(p_kind text,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid();
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
  return private.deletion_scope(v_tenant,p_kind,case when p_kind='account' then v_tenant else p_id end);
end $$;

create or replace function public.delete_entry(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_seed uuid; receipt jsonb;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
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

create or replace function public.delete_seed(p_seed_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); receipt jsonb; v_entries uuid[];
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
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

create or replace function public.delete_garden(p_garden_id uuid,p_confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); g public.gardens; receipt jsonb;
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  perform private.require_deletion_enabled();
  -- Serialise with pass preparation and with other deletions by this account.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into g from public.gardens where id=p_garden_id and tenant_id=v_tenant for update;
  if g.id is null then return jsonb_build_object('deleted',false); end if;
  if btrim(coalesce(p_confirm_name,''))<>btrim(g.name) then raise exception 'confirmation does not match' using errcode='22023'; end if;
  receipt:=private.deletion_scope(v_tenant,'garden',p_garden_id);
  perform private.erase_garden(v_tenant,p_garden_id);
  return receipt||jsonb_build_object('deleted',true);
end $$;

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
  receipt:=private.deletion_scope(v_tenant,'account',v_tenant);
  for g in select id from public.gardens where tenant_id=v_tenant loop
    perform private.erase_garden(v_tenant,g);
  end loop;
  delete from auth.users where id=v_tenant;
  delete from public.accounts where id=v_tenant;
  if exists(select 1 from auth.users where id=v_tenant) then raise exception 'sign-in identity could not be removed' using errcode='55000'; end if;
  return receipt||jsonb_build_object('deleted',true);
end $$;

-- ---------------------------------------------------------------------------
-- Blocker 6: import as one bounded transaction.
-- The caller sends the identifiers the web already derives (deterministic, so
-- a retry is a replay). Limits, matching import-core.ts and the 1 MB request
-- ceiling a server action has:
--   * title: not blank and at most 160 UTF-16 units after trimming;
--   * 1 to 500 entries; each body not blank and at most 20,000 UTF-16 units;
--   * each date null or a calendar date;
--   * title plus bodies at most 1,048,576 bytes of UTF-8.
-- Writing goes through save_entry, so replay, conflict and archive rules are
-- the same as an ordinary save. Like the web import, a replayed entry is
-- counted as skipped and its date is set again.
-- SECURITY DEFINER because the owner can no longer write entries.created_at;
-- every statement is keyed to auth.uid().
-- Refusals: 22023 (input), SGA02 (topic missing, not the caller's, or archived).
-- ---------------------------------------------------------------------------
create function public.import_thought(p_plot_id uuid,p_seed_id uuid,p_title text,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=auth.uid(); v_title text:=private.trim_text(p_title); p public.plots; s public.seeds; e record;
  v_entry uuid; v_revision uuid; v_created integer:=0; v_skipped integer:=0;
  uuid_shape constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_tenant is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_plot_id is null or p_seed_id is null or v_title is null or v_title='' or private.utf16_length(v_title)>160
      or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 500 then
    raise exception 'check the topic and entries' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) x where (
        jsonb_typeof(x) is distinct from 'object'
        or jsonb_typeof(x->'body') is distinct from 'string'
        or private.trim_text(x->>'body')='' or private.utf16_length(x->>'body')>20000
        or jsonb_typeof(x->'entry_id') is distinct from 'string' or (x->>'entry_id') !~ uuid_shape
        or jsonb_typeof(x->'revision_id') is distinct from 'string' or (x->>'revision_id') !~ uuid_shape
        or coalesce(jsonb_typeof(x->'date'),'null') not in('null','string')
        or (coalesce(jsonb_typeof(x->'date'),'null')='string' and not private.is_calendar_date(x->>'date'))) is not false) then
    raise exception 'check the topic and entries' using errcode='22023';
  end if;
  if (select coalesce(sum(octet_length(x->>'body')),0) from jsonb_array_elements(p_entries) x)+octet_length(p_title)>1048576 then
    raise exception 'import too large' using errcode='22023';
  end if;
  -- Serialise with pass preparation and deletion, which take this lock first.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into p from public.plots where id=p_plot_id and tenant_id=v_tenant for share;
  if p.id is null or p.archived_at is not null
      or not exists(select 1 from public.gardens g where g.id=p.garden_id and g.tenant_id=v_tenant and g.status='active') then
    raise exception 'choose an active topic' using errcode='SGA02';
  end if;
  select * into s from public.seeds where id=p_seed_id for update;
  if s.id is null then
    insert into public.seeds(id,tenant_id,garden_id,plot_id,title) values(p_seed_id,v_tenant,p.garden_id,p_plot_id,v_title);
  elsif s.tenant_id<>v_tenant then
    raise exception 'seed unavailable' using errcode='42501';
  end if;
  for e in select x->>'entry_id' as entry_id,x->>'revision_id' as revision_id,x->>'body' as body,x->>'date' as day
      from jsonb_array_elements(p_entries) with ordinality t(x,i) order by i loop
    v_entry:=e.entry_id::uuid;
    v_revision:=e.revision_id::uuid;
    if exists(select 1 from public.seed_revisions where id=v_revision and tenant_id=v_tenant) then v_skipped:=v_skipped+1; else v_created:=v_created+1; end if;
    -- save_entry checks the thought is the caller's, refuses a reused identifier
    -- with different text, and refuses archived places.
    perform public.save_entry(p_seed_id,v_entry,v_revision,e.body);
    if e.day is not null then
      update public.entries set created_at=(e.day||'T12:00:00Z')::timestamptz
        where id=v_entry and tenant_id=v_tenant and seed_id=p_seed_id;
    end if;
  end loop;
  return jsonb_build_object('id',p_seed_id,'created',v_created,'skipped',v_skipped);
end $$;
revoke all on function public.import_thought(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.import_thought(uuid,uuid,text,jsonb) to authenticated;

commit;

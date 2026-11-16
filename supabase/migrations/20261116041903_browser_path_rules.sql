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
--   3. Archived places take no new writing (SQLSTATE SGA02, with a message that
--      names what is archived): no new or moved thought in an archived topic or
--      garden, no new entry or revision in an archived garden, topic, thought
--      or entry. Writing and archiving serialise on row locks.
--   4. Names, titles and bodies are never blank, where "blank" is exactly what
--      JavaScript's String.prototype.trim() empties (private.trim_text). Names
--      and titles are stored trimmed.
--   5. Lengths are counted the way the web counts them: UTF-16 code units
--      (private.utf16_length). Time zone names keep the web's shape and length.
--   6. public.import_thought: one transaction, bounded, and the only way a
--      person can date an entry; it never changes an entry that already exists.
--   7. created_at on gardens, topics, thoughts, entries and revisions, and
--      revision numbers, are set by the database, not by the owner's session.
--
-- EXISTING ROWS ARE NEVER REWRITTEN, REJECTED OR MADE UNUSABLE. Older
-- constraints accepted text these rules refuse (a tab-only name, a
-- newline-only body, a body over 20,000 UTF-16 units). Source text is the
-- person's own and revisions are immutable, so there is no acceptable repair:
--   * rules on text that can still be edited (names, titles, time zone) are
--     triggers that fire only when that column is written, so a legacy row
--     can still be archived, restored or otherwise updated as it is;
--   * rules on append-only text (revision bodies, bloom corrections) are CHECK
--     constraints left NOT VALID on purpose and never validated: Postgres
--     enforces them for every new row and does not look at old ones.
-- The migration therefore cannot fail on existing data. It reports, as a
-- NOTICE with counts only, how many existing rows the new rules would refuse.
--
-- Lock order for writing, archiving and deleting, everywhere:
--   public.accounts (pass preparation, deletion, import), then gardens, then
--   plots, then seeds, then entries; private.pass_inputs before garden_passes
--   as before. save_entry used to lock the thought first; it now takes the
--   garden and topic share locks before it.
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
-- Report. Counts only; no content is read into the message, and nothing here
-- can stop the migration. These rows stay exactly as they are.
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
  raise notice 'browser_path_rules report: existing rows the new rules would refuse if written today, all left unchanged (garden names %, topic names %, thought titles %, bodies %, bloom responses %, time zones %)',
    n_gardens,n_plots,n_seeds,n_bodies,n_responses,n_zones;
end $$;

-- ---------------------------------------------------------------------------
-- Blockers 5 and 8: blank text and lengths.
-- The web refuses a name that trim() empties or that is longer than the limit
-- before trimming, then stores it trimmed. The triggers do the same for any
-- writer (SECURITY DEFINER only so they can reach the private helpers; they
-- touch nothing but the new row). They fire on INSERT and on an UPDATE that
-- writes the column, never on an update of something else, so a legacy row
-- keeps working. No CHECK constraint is added to these tables: a CHECK, even
-- NOT VALID, is re-evaluated on every update of a row and would stop a legacy
-- garden from being archived or restored.
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

-- The web's validateTimezone (shape and length). private.check_account_timezone
-- still requires a real zone; same SQLSTATE and message, so the web says the same.
create function private.check_timezone_shape() returns trigger language plpgsql set search_path='' as $$
begin
  if char_length(new.timezone)>64 or new.timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$' then
    raise exception 'unknown time zone' using errcode='22023';
  end if;
  return new;
end $$;
create trigger accounts_timezone_shape before insert or update of timezone on public.accounts
  for each row execute function private.check_timezone_shape();
revoke all on function private.check_timezone_shape() from public,anon,authenticated;

-- Append-only text. NOT VALID is permanent and deliberate: new rows are
-- checked, existing rows are never examined. Do not VALIDATE these.
alter table public.seed_revisions add constraint seed_revisions_body_rule
  check (private.trim_text(body)<>'' and private.utf16_length(body)<=20000) not valid;
-- Blocker 3: a correction is text the next pass's model is given, so it must be
-- there when the response says so and absent otherwise.
alter table public.bloom_responses add constraint bloom_responses_correction_rule
  check (case when response='correct' then correction is not null and private.trim_text(correction)<>'' else correction is null end) not valid;

-- ---------------------------------------------------------------------------
-- Blocker 4: archived places take no new writing.
-- One SQLSTATE (SGA02) and a message that names what is archived, so the web
-- can tell the person what to restore. SECURITY DEFINER so the checks read and
-- lock the true rows whoever writes. Every check takes FOR SHARE on the row it
-- reads: archiving needs that row's lock, so writing and archiving wait for
-- each other and a write can never land in a place archived at the same moment.
-- Lock order: garden, topic, thought, entry.
-- ---------------------------------------------------------------------------
-- A new thought, or a thought moved to another topic or garden. A parent that
-- is missing or another tenant's is left to the composite foreign key, which
-- refuses both alike (23503). Named to fire after seeds_default_plot.
create function private.refuse_archived_parent() returns trigger language plpgsql security definer set search_path='' as $$
declare v_status public.garden_status; v_archived timestamptz;
begin
  if tg_op='UPDATE' and new.plot_id is not distinct from old.plot_id and new.garden_id is not distinct from old.garden_id
      and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;
  select g.status into v_status from public.gardens g where g.id=new.garden_id and g.tenant_id=new.tenant_id for share;
  if found and v_status<>'active' then raise exception 'this garden is archived; restore it to write here' using errcode='SGA02'; end if;
  select p.archived_at into v_archived from public.plots p where p.id=new.plot_id and p.tenant_id=new.tenant_id and p.garden_id=new.garden_id for share;
  if found and v_archived is not null then raise exception 'this topic is archived; restore it to write here' using errcode='SGA02'; end if;
  return new;
end $$;
create trigger seeds_refuse_archived_parent before insert or update of plot_id,garden_id,tenant_id on public.seeds
  for each row execute function private.refuse_archived_parent();
revoke all on function private.refuse_archived_parent() from public,anon,authenticated;

-- A new entry or revision, by save_entry, import or a direct insert. The
-- thought is looked up within the writer's own tenant: one that is missing or
-- another tenant's is not found here and is refused by the composite foreign
-- key (23503) whatever its state, so the answer says nothing about another
-- tenant's rows. Named to fire after revisions_default_entry.
create function private.refuse_archived_writing() returns trigger language plpgsql security definer set search_path='' as $$
declare v_garden uuid; v_plot uuid; v_garden_status public.garden_status; v_seed_status public.seed_status; v_archived timestamptz;
begin
  select s.garden_id,s.plot_id into v_garden,v_plot from public.seeds s where s.id=new.seed_id and s.tenant_id=new.tenant_id;
  if not found then return new; end if;
  select g.status into v_garden_status from public.gardens g where g.id=v_garden for share;
  if v_garden_status is distinct from 'active' then raise exception 'this garden is archived; restore it to write here' using errcode='SGA02'; end if;
  select p.archived_at into v_archived from public.plots p where p.id=v_plot for share;
  if v_archived is not null then raise exception 'this topic is archived; restore it to write here' using errcode='SGA02'; end if;
  select s.status into v_seed_status from public.seeds s where s.id=new.seed_id for share;
  if v_seed_status is distinct from 'active' then raise exception 'this thought is archived; restore it to write here' using errcode='SGA02'; end if;
  select e.archived_at into v_archived from public.entries e where e.id=new.entry_id and e.tenant_id=new.tenant_id for share;
  if found and v_archived is not null then raise exception 'this entry is archived; restore it to write here' using errcode='SGA02'; end if;
  return new;
end $$;
create trigger revisions_refuse_archived before insert on public.seed_revisions
  for each row execute function private.refuse_archived_writing();
revoke all on function private.refuse_archived_writing() from public,anon,authenticated;

-- save_entry: the garden and topic share locks are taken before the thought's
-- lock (the order above), its own archive refusal now includes the garden and
-- uses SGA02 with the specific message, and a caller that cannot see the
-- thought is refused before any lock. Otherwise as in web_thinking_garden.
create or replace function public.save_entry(p_seed_id uuid, p_entry_id uuid, p_revision_id uuid,
  p_body text, p_expected_revision_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.seeds; r public.seed_revisions; head_id uuid; n integer; v_garden uuid; v_plot uuid;
begin
  select garden_id,plot_id into v_garden,v_plot from public.seeds where id=p_seed_id and tenant_id=auth.uid();
  if not found then raise exception 'seed unavailable' using errcode='42501'; end if;
  perform 1 from public.gardens where id=v_garden for share;
  perform 1 from public.plots where id=v_plot for share;
  select * into s from public.seeds where id = p_seed_id for update;
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

-- ---------------------------------------------------------------------------
-- Blocker 7: dates and revision numbers belong to the database.
-- A person's own session can no longer set or move created_at on a garden,
-- topic, thought, entry or revision (entry and revision dates feed the tending
-- watermark and the "change over time" tier), nor updated_at, nor a topic's
-- permission_version. Column grants name exactly what the web writes; every
-- other column takes its default or is set by a trigger. No legitimate path
-- needed the withdrawn columns: the only one that wrote a date was import,
-- which now goes through import_thought.
-- ---------------------------------------------------------------------------
revoke insert,update on public.gardens,public.plots,public.seeds,public.entries from authenticated;
grant insert(id,tenant_id,name),update(name,status,archived_at) on public.gardens to authenticated;
grant insert(id,tenant_id,garden_id,name,ai_enabled,cross_pollinate),update(name,ai_enabled,cross_pollinate,archived_at) on public.plots to authenticated;
grant insert(id,tenant_id,garden_id,plot_id,title,position_x,position_y),update(plot_id,title,status,archived_at,position_x,position_y) on public.seeds to authenticated;
grant insert(id,tenant_id,garden_id,seed_id),update(archived_at) on public.entries to authenticated;
revoke insert on public.seed_revisions from authenticated;
grant insert(id,tenant_id,garden_id,seed_id,entry_id,revision_number,body,created_by) on public.seed_revisions to authenticated;

-- A revision's number is the next one for its thought, whatever an API caller
-- sends: a direct insert of 2147483647 used to succeed and made every later
-- save on that thought fail. SECURITY INVOKER on purpose: current_user is the
-- role running the insert, so privileged code (import_thought, an operator)
-- keeps the number it computed. Named to fire after revisions_refuse_archived,
-- which holds the thought's lock.
create function private.assign_revision_number() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in('authenticated','anon') then
    select coalesce(max(revision_number),0)+1 into new.revision_number from public.seed_revisions where seed_id=new.seed_id;
  end if;
  return new;
end $$;
create trigger revisions_sequence before insert on public.seed_revisions
  for each row execute function private.assign_revision_number();
revoke all on function private.assign_revision_number() from public,anon,authenticated;

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
-- a retry is a replay). Limits are per call, like the server's per-request
-- limits they replace; a thought may grow over several imports:
--   * title: not blank and at most 160 UTF-16 units after trimming;
--   * 1 to 500 entries, each an object with exactly entry_id, revision_id,
--     body and optionally date; any other key is refused;
--   * each body not blank and at most 20,000 UTF-16 units;
--   * each date null or a calendar date no later than tomorrow's date in UTC
--     (today's date somewhere on earth is at most that);
--   * title plus bodies at most 1,048,576 bytes of UTF-8, and the whole
--     payload as text at most that plus 256 bytes per entry for identifiers
--     and framing (a server action's request is capped at 1 MB).
-- What it will and will not do:
--   * The thought, if it exists, must be the caller's, in p_plot_id, and
--     active; its topic and garden must be active. Otherwise SGA02 or 42501.
--   * A NEW entry is created with its date: noon UTC of its day, or now if
--     that is still in the future, so no entry is ever dated after the moment
--     it was imported. Its text goes through save_entry.
--   * An entry whose revision already exists is a replay: it must be the same
--     entry, thought and text (else 22023), it is counted as skipped, and
--     NOTHING about it changes, including its date. An entry id that already
--     exists under any other revision is refused (22023). So this function
--     cannot move the date of, or add to, an entry it is not creating.
-- SECURITY DEFINER because the owner cannot write entries.created_at; every
-- statement is keyed to auth.uid().
-- Lock order: accounts, garden, topic, thought (then entries, in save_entry).
-- ---------------------------------------------------------------------------
create function public.import_thought(p_plot_id uuid,p_seed_id uuid,p_title text,p_entries jsonb) returns jsonb
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
  -- Serialise with pass preparation and deletion, which take this lock first.
  perform 1 from public.accounts where id=v_tenant for update;
  select * into p from public.plots where id=p_plot_id and tenant_id=v_tenant;
  if p.id is null then raise exception 'choose an active topic' using errcode='SGA02'; end if;
  select g.status into v_garden_status from public.gardens g where g.id=p.garden_id and g.tenant_id=v_tenant for share;
  select pl.archived_at into v_archived from public.plots pl where pl.id=p_plot_id for share;
  if v_garden_status is distinct from 'active' or v_archived is not null then
    raise exception 'choose an active topic' using errcode='SGA02';
  end if;
  select * into s from public.seeds where id=p_seed_id for update;
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

-- New functions and privileges reach the API only once PostgREST reloads its
-- schema cache. Delivered when this transaction commits.
notify pgrst, 'reload schema';

commit;

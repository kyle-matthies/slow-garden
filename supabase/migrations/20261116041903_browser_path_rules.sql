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
-- Lock order for writing, archiving, deleting and tending, everywhere:
--   public.accounts (pass preparation and deletion only), then gardens, then
--   plots, then seeds, then entries; then private.pass_inputs before
--   public.garden_passes. save_entry used to lock the thought first; it now
--   takes the garden and topic share locks before it.
-- A person's writing never waits on background processing:
--   * save_entry, create_seed, a new thought and import take only SHARE locks
--     on the garden and topic, and never the accounts row;
--   * pass preparation therefore takes SHARE, not UPDATE, on its topics. That
--     still excludes archiving a topic or changing its tending permission
--     (both need the row's update lock) and is compatible with writing;
--   * the scheduled nightly enqueue commits after each account, so the locks
--     it does hold (the accounts row, the month's budget row, topic share
--     locks) last for that account's own passes and no longer.
begin;

-- Fail fast instead of queueing. Several statements here need a brief strong
-- lock on a busy table (ADD CONSTRAINT on seed_revisions, CREATE TRIGGER,
-- GRANT). Waiting behind a long transaction would make every later write on
-- that table wait behind this migration. If a timeout fires the whole
-- migration rolls back and changes nothing: run it again.
set local lock_timeout='5s';
set local statement_timeout='120s';

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
-- A thought's topic (seeds.plot_id) is withdrawn too. The web has no move
-- action, and a direct UPDATE locks the thought before its garden and topic,
-- the reverse of the order above (it deadlocked against saves and topic
-- changes under load). Moving a thought needs an RPC that locks in order;
-- until one exists it is refused (42501). seeds_refuse_archived_parent still
-- covers UPDATE for privileged callers.
-- ---------------------------------------------------------------------------
revoke insert,update on public.gardens,public.plots,public.seeds,public.entries from authenticated;
grant insert(id,tenant_id,name),update(name,status,archived_at) on public.gardens to authenticated;
grant insert(id,tenant_id,garden_id,name,ai_enabled,cross_pollinate),update(name,ai_enabled,cross_pollinate,archived_at) on public.plots to authenticated;
grant insert(id,tenant_id,garden_id,plot_id,title,position_x,position_y),update(title,status,archived_at,position_x,position_y) on public.seeds to authenticated;
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
-- perform private.require_deletion_enabled(); delete_entry and delete_seed
-- also take the garden and topic locks before the thought. Bodies otherwise as in
-- 20261116010931_in_app_deletion.sql; grants are unchanged.
-- Deletion follows the same lock order as writing. delete_entry and
-- delete_seed used to lock the thought and then reach the passes while a topic
-- change held the topic and reached the same passes from the other side.
create function private.lock_seed_parents(p_tenant uuid,p_seed_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_garden uuid; v_plot uuid;
begin
  select garden_id,plot_id into v_garden,v_plot from public.seeds where id=p_seed_id and tenant_id=p_tenant;
  if not found then return; end if;
  perform 1 from public.gardens where id=v_garden for share;
  perform 1 from public.plots where id=v_plot for share;
end $$;
revoke all on function private.lock_seed_parents(uuid,uuid) from public,anon,authenticated;

-- Erasing a garden takes the garden, then its topics, before any pass. Body
-- otherwise as in 20261116010931_in_app_deletion.sql.
create or replace function private.erase_garden(p_tenant uuid,p_garden_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.gardens where id=p_garden_id and tenant_id=p_tenant for update;
  perform 1 from public.plots where tenant_id=p_tenant and garden_id=p_garden_id order by id for update;
  -- Passes first: their inputs, blooms and marks cascade, and source deletes below stay cheap.
  perform private.lock_pass_inputs(array(select id from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id));
  delete from public.garden_passes where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.seeds where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.plots where tenant_id=p_tenant and garden_id=p_garden_id;
  delete from public.gardens where tenant_id=p_tenant and id=p_garden_id;
end $$;
revoke all on function private.erase_garden(uuid,uuid) from public,anon,authenticated;

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
  -- Garden and topic before the thought (the lock order), then the thought:
  -- save_entry serialises on it; so does deletion.
  perform private.lock_seed_parents(v_tenant,v_seed);
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
  -- Garden and topic before the thought (the lock order).
  perform private.lock_seed_parents(v_tenant,p_seed_id);
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
-- Background processing must not hold a person's writing up.
-- ---------------------------------------------------------------------------
-- Pass preparation: the topic lock is FOR SHARE (it was FOR UPDATE, which
-- conflicts with the share lock a save now takes and made a save wait for the
-- whole enqueue transaction). SHARE still conflicts with the row update that
-- archives a topic or changes its permissions, so the permissions this pass
-- freezes cannot change under it. Two preparations for one account are still
-- serialised by the accounts row. Body otherwise as in 20261010004736_tending_tiers.sql.
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
  for p in select * from public.plots where id=any(new.plot_ids) order by id for share loop
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
    -- The watermark is the last completed pass's snapshot time (its created_at), not when it
    -- finished: writing saved while a pass was in flight was never in its snapshot.
    select max(created_at) into since from public.garden_passes where tenant_id=new.tenant_id and scope_key=scope and status='complete';
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

-- Invalidation takes a pass's input lock before its row, the order the worker,
-- deletion and allowlist removal already use. Bodies otherwise as before.
create or replace function private.invalidate_plot_passes() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.ai_enabled is distinct from new.ai_enabled or old.cross_pollinate is distinct from new.cross_pollinate or old.archived_at is distinct from new.archived_at then
    new.permission_version:=old.permission_version+1;
    perform private.lock_pass_inputs(array(select id from public.garden_passes where new.id=any(plot_ids) and status in('queued','processing','complete')));
    update public.garden_passes set status=case when status='complete' then 'withdrawn' else 'cancelled' end,finished_at=now()
      where new.id=any(plot_ids) and status in('queued','processing','complete');
  else new.permission_version:=old.permission_version; end if;
  return new;
end $$;
create or replace function private.invalidate_source_passes() returns trigger language plpgsql security definer set search_path='' as $$
declare key_name text:=case when tg_table_name='seeds' then 'seed_id' else 'entry_id' end; affected uuid[];
begin
  if tg_op='UPDATE' and old.archived_at is not distinct from new.archived_at then return new; end if;
  select array_agg(pass_id) into affected from private.pass_inputs i where exists(select 1 from jsonb_array_elements(i.snapshot) s where s->>key_name=old.id::text);
  perform private.lock_pass_inputs(affected);
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

-- Nightly enqueue, one account at a time. The work for one account is
-- private.enqueue_nightly_for; private.enqueue_nightly_passes keeps its
-- signature and result and still runs every account in the caller's
-- transaction (operator and test use). The schedule now calls a procedure that
-- COMMITs after each account, so no account's locks outlive its own passes.
create function private.enqueue_nightly_for(p_tenant uuid,p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; made integer:=0; last timestamptz;
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date; v_soft integer; v_used numeric;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  select soft_cap_cents into v_soft from private.ai_runtime where singleton;
  insert into private.ai_months(month) values(v_month) on conflict do nothing;
  if not exists(select 1 from public.accounts acc where acc.id=p_tenant and acc.tend_overnight and extract(hour from p_now at time zone acc.timezone)=2
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id)) then return 0; end if;
  if exists(select 1 from public.garden_passes where tenant_id=p_tenant and trigger='nightly' and created_at>p_now-interval '20 hours') then return 0; end if;
  for s in
    select pl.garden_id,array_agg(pl.id order by pl.id) as plot_ids
      from public.plots pl join public.gardens g on g.id=pl.garden_id and g.status='active'
      where pl.tenant_id=p_tenant and pl.ai_enabled and pl.archived_at is null
      group by pl.garden_id,case when pl.cross_pollinate then null else pl.id end
  loop
    exit when made>=p_per_tenant;
    -- Same watermark as prepare_pass: the last completed snapshot, not its finish time.
    select max(created_at) into last from public.garden_passes
      where tenant_id=p_tenant and scope_key=(select string_agg(x::text,',' order by x) from unnest(s.plot_ids) x) and status='complete';
    continue when not exists(select 1 from public.current_entries c join public.seeds sd on sd.id=c.seed_id
      where c.tenant_id=p_tenant and sd.plot_id=any(s.plot_ids) and sd.status='active' and c.archived_at is null
        and (last is null or greatest(c.created_at,c.revised_at)>last));
    -- Automatic passes pause at the soft cap (see 20261116023935_ai_tenant_allowlist.sql):
    -- checked before every pass, read without FOR UPDATE on purpose.
    select m.reserved_cents+m.spent_cents into v_used from private.ai_months m where m.month=v_month;
    if v_used>=v_soft then return made; end if;
    begin
      insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,trigger) values(gen_random_uuid(),p_tenant,s.garden_id,s.plot_ids,'nightly');
      made:=made+1;
    exception when sqlstate '55000' or sqlstate '22023' or sqlstate '42501' then
      -- Budget, in-progress, size or permission: leave this scope for another night.
      null;
    end;
  end loop;
  return made;
end $$;
revoke all on function private.enqueue_nightly_for(uuid,timestamptz,integer) from public,anon,authenticated;

create function private.nightly_accounts(p_now timestamptz) returns uuid[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(acc.id order by acc.id),'{}') from public.accounts acc
    where acc.tend_overnight and extract(hour from p_now at time zone acc.timezone)=2
      and exists(select 1 from private.ai_tenants t where t.tenant_id=acc.id);
$$;
revoke all on function private.nightly_accounts(timestamptz) from public,anon,authenticated;

create or replace function private.enqueue_nightly_passes(p_now timestamptz default now(),p_per_tenant integer default 6) returns integer
language plpgsql security definer set search_path='' as $$
declare a uuid; n integer:=0; v_month date:=date_trunc('month',now() at time zone 'UTC')::date; v_soft integer; v_used numeric;
begin
  if not (select enabled from private.ai_runtime where singleton) then return 0; end if;
  select soft_cap_cents into v_soft from private.ai_runtime where singleton;
  foreach a in array private.nightly_accounts(p_now) loop
    n:=n+private.enqueue_nightly_for(a,p_now,p_per_tenant);
    -- At or above the soft cap the run stops, as before.
    select m.reserved_cents+m.spent_cents into v_used from private.ai_months m where m.month=v_month;
    if v_used>=v_soft then return n; end if;
  end loop;
  return n;
end $$;
revoke all on function private.enqueue_nightly_passes(timestamptz,integer) from public,anon,authenticated;

-- The same gates as private.tick_nightly_enqueue: runtime on, nightly on, worker configured.
create function private.nightly_gates_open() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select enabled and nightly_enabled from private.ai_runtime where singleton),false)
    and private.garden_worker_url() is not null;
$$;
revoke all on function private.nightly_gates_open() from public,anon,authenticated,service_role;

-- What the schedule runs. A procedure because only a procedure can COMMIT
-- between accounts; for the same reason it is not SECURITY DEFINER and has no
-- SET clause (Postgres forbids transaction control in either), so every name
-- in it is schema-qualified and it is executable only by its owner, which is
-- also the role pg_cron runs the job as.
create procedure private.run_nightly_enqueue(p_now timestamptz default now())
language plpgsql as $$
declare a uuid; ids uuid[];
begin
  if not private.nightly_gates_open() then return; end if;
  ids:=private.nightly_accounts(p_now);
  commit;
  foreach a in array ids loop
    perform private.enqueue_nightly_for(a,p_now);
    commit;
  end loop;
end $$;
revoke all on procedure private.run_nightly_enqueue(timestamptz) from public,anon,authenticated,service_role;
select cron.schedule('slow-garden-nightly','7 * * * *','call private.run_nightly_enqueue()');

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
-- Lock order: garden, topic, thought (then entries, in save_entry). It does not
-- take the accounts row, so it never waits on pass preparation; deletion and
-- import exclude each other on the garden, topic or thought row they share.
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

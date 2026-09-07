begin;

create table public.plots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid(),
  garden_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  ai_enabled boolean not null default false,
  cross_pollinate boolean not null default false,
  permission_version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, tenant_id, garden_id),
  foreign key(garden_id, tenant_id) references public.gardens(id, tenant_id) on delete cascade
);
create index plots_garden_idx on public.plots(garden_id, tenant_id);
alter table public.seeds add column plot_id uuid;
alter table public.seeds add column title text not null default 'Untitled thought'
  check (char_length(btrim(title)) between 1 and 160);
insert into public.plots(id, tenant_id, garden_id, name)
select id, tenant_id, id, 'Unsorted' from public.gardens;
update public.seeds set plot_id = garden_id;
alter table public.seeds alter column plot_id set not null;
alter table public.seeds add foreign key(plot_id, tenant_id, garden_id)
  references public.plots(id, tenant_id, garden_id);
create index seeds_plot_idx on public.seeds(plot_id, tenant_id, garden_id);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid(),
  garden_id uuid not null,
  seed_id uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id, seed_id, tenant_id, garden_id),
  foreign key(seed_id, tenant_id, garden_id) references public.seeds(id, tenant_id, garden_id) on delete cascade
);
create index entries_seed_idx on public.entries(seed_id, tenant_id, garden_id);
insert into public.entries(id, tenant_id, garden_id, seed_id, created_at)
select id, tenant_id, garden_id, id, created_at from public.seeds;
alter table public.seed_revisions add column entry_id uuid;
-- Preserve every legacy revision; the existing immutable trigger forbids ordinary updates.
alter table public.seed_revisions disable trigger seed_revisions_reject_update;
update public.seed_revisions set entry_id = seed_id;
alter table public.seed_revisions enable trigger seed_revisions_reject_update;
alter table public.seed_revisions alter column entry_id set not null;
alter table public.seed_revisions add foreign key(entry_id, seed_id, tenant_id, garden_id)
  references public.entries(id, seed_id, tenant_id, garden_id) on delete cascade;
create index revisions_entry_idx on public.seed_revisions(entry_id, revision_number desc);

-- Keep the original create_seed API and direct legacy inserts compatible.
create function private.default_seed_plot() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.plot_id is null then
    insert into public.plots(id, tenant_id, garden_id, name)
      values(new.garden_id, new.tenant_id, new.garden_id, 'Unsorted') on conflict(id) do nothing;
    new.plot_id := new.garden_id;
  end if;
  return new;
end $$;
create trigger seeds_default_plot before insert on public.seeds
for each row execute function private.default_seed_plot();
create function private.default_revision_entry() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.entry_id is null then
    insert into public.entries(id, tenant_id, garden_id, seed_id)
      values(new.seed_id, new.tenant_id, new.garden_id, new.seed_id) on conflict(id) do nothing;
    new.entry_id := new.seed_id;
  end if;
  return new;
end $$;
create trigger revisions_default_entry before insert on public.seed_revisions
for each row execute function private.default_revision_entry();

alter table public.plots enable row level security;
alter table public.entries enable row level security;
create policy plots_own on public.plots for all to authenticated
  using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));
create policy entries_own on public.entries for all to authenticated
  using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));
revoke all on public.plots, public.entries from public, anon, authenticated;
grant select, insert, update on public.plots, public.entries to authenticated;

-- One latest revision per entry BEFORE caller pagination or search.
create view public.current_entries with (security_invoker = true) as
select distinct on (r.entry_id) r.id as revision_id, r.entry_id, r.seed_id, r.garden_id,
  r.tenant_id, r.body, r.revision_number, r.created_at as revised_at,
  e.created_at, e.archived_at
from public.seed_revisions r join public.entries e on e.id = r.entry_id
order by r.entry_id, r.revision_number desc;
revoke all on public.current_entries from public, anon;
grant select on public.current_entries to authenticated;

-- Caller-chosen UUIDs survive a lost response. Serialize on seed to detect stale edits.
create function public.save_entry(p_seed_id uuid, p_entry_id uuid, p_revision_id uuid,
  p_body text, p_expected_revision_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.seeds; r public.seed_revisions; head_id uuid; n integer;
begin
  select * into s from public.seeds where id = p_seed_id for update;
  if s.id is null or s.tenant_id <> auth.uid() then raise exception 'seed unavailable' using errcode='42501'; end if;
  select * into r from public.seed_revisions where id = p_revision_id;
  if r.id is not null then
    if r.entry_id <> p_entry_id or r.seed_id <> p_seed_id or r.body <> p_body then
      raise exception 'request identifier already used' using errcode='22023';
    end if;
    return r.id;
  end if;
  if s.status <> 'active' or exists(select 1 from public.plots where id=s.plot_id and archived_at is not null)
    then raise exception 'restore this thought before writing' using errcode='22023'; end if;
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
revoke all on function public.save_entry(uuid,uuid,uuid,text,uuid) from public, anon;
grant execute on function public.save_entry(uuid,uuid,uuid,text,uuid) to authenticated;
-- One SQL statement provides a consistent source export, beyond the Data API row cap.
create function public.export_garden_sources() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('schema','slow-garden-source-v2','exported_at',now(),
 'gardens',(select coalesce(jsonb_agg(g order by g.id),'[]') from public.gardens g),
 'plots',(select coalesce(jsonb_agg(p order by p.id),'[]') from public.plots p),
 'seeds',(select coalesce(jsonb_agg(s order by s.id),'[]') from public.seeds s),
 'entries',(select coalesce(jsonb_agg(e order by e.id),'[]') from public.entries e),
 'revisions',(select coalesce(jsonb_agg(r order by r.seed_id,r.revision_number),'[]') from public.seed_revisions r))
 where auth.uid() is not null;
$$;
revoke all on function public.export_garden_sources() from public,anon;
grant execute on function public.export_garden_sources() to authenticated;
commit;

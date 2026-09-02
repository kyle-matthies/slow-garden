begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.garden_status as enum ('active', 'archived');
create type public.seed_status as enum ('active', 'archived');

create table public.accounts (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_identity_matches_tenant check (id is not null),
  constraint accounts_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 120
  )
);

create table public.gardens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid() references public.accounts (id) on delete cascade,
  name text not null,
  status public.garden_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint gardens_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint gardens_archive_state check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  unique (id, tenant_id)
);

create table public.seeds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid(),
  garden_id uuid not null,
  status public.seed_status not null default 'active',
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint seeds_garden_tenant_fk
    foreign key (garden_id, tenant_id)
    references public.gardens (id, tenant_id)
    on delete cascade,
  constraint seeds_position_finite check (
    position_x not in ('Infinity'::double precision, '-Infinity'::double precision)
    and position_y not in ('Infinity'::double precision, '-Infinity'::double precision)
    and position_x <> 'NaN'::double precision
    and position_y <> 'NaN'::double precision
  ),
  constraint seeds_archive_state check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  unique (id, tenant_id, garden_id)
);

create table public.seed_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid(),
  garden_id uuid not null,
  seed_id uuid not null,
  revision_number integer not null,
  body text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint seed_revisions_seed_tenant_fk
    foreign key (seed_id, tenant_id, garden_id)
    references public.seeds (id, tenant_id, garden_id)
    on delete cascade,
  constraint seed_revisions_actor_is_tenant check (created_by = tenant_id),
  constraint seed_revisions_positive_number check (revision_number > 0),
  constraint seed_revisions_body_length check (char_length(btrim(body)) between 1 and 20000),
  unique (seed_id, revision_number)
);

create index gardens_tenant_status_idx on public.gardens (tenant_id, status, updated_at desc);
create index seeds_tenant_garden_status_idx on public.seeds (tenant_id, garden_id, status, updated_at desc);
create index seed_revisions_tenant_seed_number_idx
  on public.seed_revisions (tenant_id, seed_id, revision_number desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.reject_seed_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'seed revisions are immutable' using errcode = '55000';
end;
$$;

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function private.set_updated_at();

create trigger gardens_set_updated_at
before update on public.gardens
for each row execute function private.set_updated_at();

create trigger seeds_set_updated_at
before update on public.seeds
for each row execute function private.set_updated_at();

create trigger seed_revisions_reject_update
before update on public.seed_revisions
for each row execute function private.reject_seed_revision_mutation();

create function public.create_seed(
  p_garden_id uuid,
  p_body text,
  p_position_x double precision default 0,
  p_position_y double precision default 0
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid := auth.uid();
  v_seed_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.seeds (
    tenant_id,
    garden_id,
    position_x,
    position_y
  ) values (
    v_tenant_id,
    p_garden_id,
    p_position_x,
    p_position_y
  )
  returning id into v_seed_id;

  insert into public.seed_revisions (
    tenant_id,
    garden_id,
    seed_id,
    revision_number,
    body,
    created_by
  ) values (
    v_tenant_id,
    p_garden_id,
    v_seed_id,
    1,
    p_body,
    v_tenant_id
  );

  return v_seed_id;
end;
$$;

alter table public.accounts enable row level security;
alter table public.gardens enable row level security;
alter table public.seeds enable row level security;
alter table public.seed_revisions enable row level security;

create policy accounts_select_own
on public.accounts for select
to authenticated
using ((select auth.uid()) = id);

create policy accounts_insert_own
on public.accounts for insert
to authenticated
with check ((select auth.uid()) = id);

create policy accounts_update_own
on public.accounts for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy gardens_select_own
on public.gardens for select
to authenticated
using ((select auth.uid()) = tenant_id);

create policy gardens_insert_own
on public.gardens for insert
to authenticated
with check ((select auth.uid()) = tenant_id);

create policy gardens_update_own
on public.gardens for update
to authenticated
using ((select auth.uid()) = tenant_id)
with check ((select auth.uid()) = tenant_id);

create policy gardens_delete_own
on public.gardens for delete
to authenticated
using ((select auth.uid()) = tenant_id);

create policy seeds_select_own
on public.seeds for select
to authenticated
using ((select auth.uid()) = tenant_id);

create policy seeds_insert_own
on public.seeds for insert
to authenticated
with check ((select auth.uid()) = tenant_id);

create policy seeds_update_own
on public.seeds for update
to authenticated
using ((select auth.uid()) = tenant_id)
with check ((select auth.uid()) = tenant_id);

create policy seeds_delete_own
on public.seeds for delete
to authenticated
using ((select auth.uid()) = tenant_id);

create policy seed_revisions_select_own
on public.seed_revisions for select
to authenticated
using ((select auth.uid()) = tenant_id);

create policy seed_revisions_insert_own
on public.seed_revisions for insert
to authenticated
with check (
  (select auth.uid()) = tenant_id
  and (select auth.uid()) = created_by
);

revoke all on table public.accounts from anon, authenticated;
revoke all on table public.gardens from anon, authenticated;
revoke all on table public.seeds from anon, authenticated;
revoke all on table public.seed_revisions from anon, authenticated;

grant select, insert, update on table public.accounts to authenticated;
grant select, insert, update, delete on table public.gardens to authenticated;
grant select, insert, update, delete on table public.seeds to authenticated;
grant select, insert on table public.seed_revisions to authenticated;

revoke all on function public.create_seed(uuid, text, double precision, double precision)
  from public, anon;
grant execute on function public.create_seed(uuid, text, double precision, double precision)
  to authenticated;

commit;

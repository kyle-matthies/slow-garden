create index seeds_garden_tenant_idx
  on public.seeds (garden_id, tenant_id);

create index seed_revisions_seed_tenant_garden_idx
  on public.seed_revisions (seed_id, tenant_id, garden_id);

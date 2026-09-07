begin;
create index blooms_pass_fk_idx on public.blooms(pass_id,tenant_id,garden_id);
create index passes_garden_fk_idx on public.garden_passes(garden_id,tenant_id);
create index revisions_entry_fk_idx on public.seed_revisions(entry_id,seed_id,tenant_id,garden_id);
-- Explicitly document backend-only access. Other roles remain denied by default,
-- and the private schema is not exposed through the Data API.
create policy runtime_backend_only on private.ai_runtime for all to service_role using(true) with check(true);
create policy budget_backend_only on private.ai_months for all to service_role using(true) with check(true);
create policy snapshot_backend_only on private.pass_inputs for all to service_role using(true) with check(true);
commit;

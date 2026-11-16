-- Rollback-only synthetic verification. No private tenant bodies are queried.
-- Needs the migrations through 20261116061751_tending_followups.
--
-- Fail closed by construction. Everything that writes happens inside ONE
-- statement, in an inner block that always ends by raising and catching its own
-- signal, which undoes every write of that block whatever the client does with
-- transactions (a SQL editor, an agent's execute-SQL tool, a pooler, or psql
-- with or without ON_ERROR_STOP). Nothing is committed on success or on
-- failure, and no setting outside the block is touched:
--   * the runtime is switched on only inside that block, where no other session
--     can see it, and nothing reaches the worker or a provider;
--   * a failed check is an ordinary error from the statement, also undone.
-- The result row says "passed" only if the statement finished; after any error
-- it says FAILED.
select set_config('canary.result','',false) is not null as started;
do $canary$
declare
  a constant uuid:='98989898-9898-4989-8989-989898989891';
  b constant uuid:='98989898-9898-4989-8989-989898989892';
  garden constant uuid:='98989898-9898-4989-8989-989898989893';
  plot constant uuid:='98989898-9898-4989-8989-989898989894';
  seed constant uuid:='98989898-9898-4989-8989-989898989895';
  entry constant uuid:='98989898-9898-4989-8989-989898989896';
  pass constant uuid:='98989898-9898-4989-8989-98989898989a';
  made integer;
begin
  if exists(select 1 from auth.users where id in(a,b)) then raise exception 'canary accounts already exist'; end if;
  begin
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(a,'slow-garden-canary-a@example.test','{}','{}',now(),now()),
    (b,'slow-garden-canary-b@example.test','{}','{}',now(),now());

    -- Saving, idempotency, export and tenant isolation, as a signed-in account.
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',a::text,true);
    insert into public.gardens(id,name) values(garden,'Synthetic rollback garden');
    insert into public.plots(id,garden_id,name) values(plot,garden,'Synthetic plot');
    insert into public.seeds(id,garden_id,plot_id,title) values(seed,garden,plot,'Synthetic thought');
    perform public.save_entry(seed,entry,'98989898-9898-4989-8989-989898989897','Synthetic source only');
    perform public.save_entry(seed,entry,'98989898-9898-4989-8989-989898989897','Synthetic source only');
    perform public.save_entry(seed,entry,'98989898-9898-4989-8989-989898989898','Revised synthetic source','98989898-9898-4989-8989-989898989897');
    if (select count(*) from public.seed_revisions where entry_id=entry)<>2 then raise exception 'idempotency failed'; end if;
    if (select body from public.current_entries where entry_id=entry)<>'Revised synthetic source' then raise exception 'latest revision failed'; end if;
    if jsonb_array_length(public.export_garden_sources()->'revisions')<>2 then raise exception 'source export failed'; end if;
    if exists(select 1 from public.plots where id=plot and (ai_enabled or cross_pollinate)) then raise exception 'AI defaults failed'; end if;
    perform set_config('request.jwt.claim.sub',b::text,true);
    if exists(select 1 from public.current_entries where entry_id=entry) then raise exception 'cross-tenant read succeeded'; end if;
    begin
      perform public.save_entry(seed,entry,'98989898-9898-4989-8989-989898989899','Forbidden');
      raise exception 'cross-tenant write succeeded' using errcode='SGC01';
    exception when insufficient_privilege then null;
    end;
    reset role;

    -- Owner-only allowlist and transport freeze.
    update private.ai_runtime set enabled=true,model=coalesce(model,'synthetic-canary'),approved_at=coalesce(approved_at,now()) where singleton;
    update public.plots set ai_enabled=true where id=plot;
    if has_table_privilege('authenticated','private.ai_tenants','select,insert,update,delete') or has_table_privilege('anon','private.ai_tenants','select') then raise exception 'allowlist is exposed to an API role'; end if;
    if (select nightly_enabled from private.ai_runtime) and not exists(select 1 from private.ai_tenants) then raise exception 'nightly switch is on with an empty allowlist'; end if;
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',a::text,true);
    begin
      insert into public.garden_passes(id,garden_id,plot_ids) values(pass,garden,array[plot]);
      raise exception 'pass accepted for a tenant that is not allowlisted' using errcode='SGC01';
    exception when sqlstate '55000' then
      if sqlerrm<>'tending is not available for this account yet' then raise exception 'unexpected refusal: %',sqlerrm using errcode='SGC01'; end if;
    end;
    reset role;
    insert into private.ai_tenants(tenant_id,note) values(a,'rollback-only canary');

    -- Nightly path. The committing procedure must refuse to run here, before doing
    -- anything; its real run is scripts/hosted-nightly-canary.sql (runbook 3.12).
    -- The per-account enqueue it calls is exercised for the canary tenant only.
    update public.accounts set tend_overnight=true,timezone='UTC' where id=a;
    begin
      call private.run_nightly_enqueue();
      raise exception 'the nightly procedure ran inside a transaction' using errcode='SGC01';
    exception when sqlstate '25001' or sqlstate '2D000' then null;
    end;
    made:=private.enqueue_nightly_for(a,date_trunc('day',now() at time zone 'UTC')::timestamp at time zone 'UTC'+interval '2 hours 30 minutes');
    if made<>1 then raise exception 'nightly enqueue made % passes for the canary tenant, expected 1',made; end if;
    if (select count(*) from public.garden_passes p join private.pass_inputs i on i.pass_id=p.id
         where p.tenant_id=a and p.trigger='nightly' and i.cycle_date is not null and i.bloom_allowance=3)<>1 then
      raise exception 'the nightly pass was not stamped with its cycle and share'; end if;
    update public.garden_passes set status='cancelled' where tenant_id=a and trigger='nightly';

    -- An allowlisted account can invite a pass; another account still cannot.
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',a::text,true);
    insert into public.garden_passes(id,garden_id,plot_ids) values(pass,garden,array[plot]);
    perform set_config('request.jwt.claim.sub',b::text,true);
    begin
      insert into public.garden_passes(id,tenant_id,garden_id,plot_ids) values('98989898-9898-4989-8989-98989898989b',b,garden,array[plot]);
      raise exception 'second tenant created a pass' using errcode='SGC01';
    exception when sqlstate '55000' or insufficient_privilege then null;
    end;
    reset role;
    if (select count(*) from private.pass_inputs i where i.pass_id=pass and i.transport=(select transport from private.ai_runtime) and i.dispatches=0 and jsonb_array_length(i.snapshot)=1)<>1 then raise exception 'allowlisted pass was not prepared as expected'; end if;
    delete from private.ai_tenants where tenant_id=a;
    if (select status from public.garden_passes where id=pass)<>'cancelled' then raise exception 'removal from the allowlist did not cancel the pass'; end if;
    if not (select cleanup_pending from private.pass_inputs where pass_id=pass) then raise exception 'cancelled pass was not queued for cleanup'; end if;

    -- Every check passed. Undo everything this block did.
    raise exception 'canary complete' using errcode='SGC00';
  exception when sqlstate 'SGC00' then
    reset role;
  end;
  -- Proof that nothing was kept.
  if exists(select 1 from auth.users where id in(a,b)) or exists(select 1 from public.garden_passes where id=pass)
      or exists(select 1 from private.ai_tenants where tenant_id in(a,b)) then
    raise exception 'canary rows survived the rollback';
  end if;
  perform set_config('canary.result','hosted synthetic canary passed',false);
end $canary$;
select coalesce(nullif(current_setting('canary.result',true),''),'hosted synthetic canary FAILED: see the error above') as result;

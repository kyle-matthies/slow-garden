begin;

create function private.provision_account_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.provision_account_for_auth_user()
  from public, anon, authenticated;
grant execute on function private.provision_account_for_auth_user()
  to supabase_auth_admin;

create trigger auth_user_provision_account
after insert on auth.users
for each row execute function private.provision_account_for_auth_user();

insert into public.accounts (id)
select id
from auth.users
on conflict (id) do nothing;

commit;

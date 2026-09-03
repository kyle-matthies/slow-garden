begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'alice@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'bob@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.accounts),
  1::bigint,
  'Auth signup provisions Alice tenant account automatically'
);

select lives_ok(
  $$insert into public.gardens (id, tenant_id, name)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'Alice Garden'
    )$$,
  'Alice can create her garden'
);

select lives_ok(
  $$insert into public.seeds (id, tenant_id, garden_id)
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )$$,
  'Alice can create a seed in her garden'
);

select lives_ok(
  $$insert into public.seed_revisions (
      tenant_id,
      garden_id,
      seed_id,
      revision_number,
      body,
      created_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      1,
      'A private first thought.',
      '11111111-1111-4111-8111-111111111111'
    )$$,
  'Alice can append a revision to her seed'
);

select lives_ok(
  $$select public.create_seed(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'A second thought created atomically.'
    )$$,
  'Authenticated tenant can atomically create a seed and first revision'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*) from public.gardens),
  0::bigint,
  'Bob cannot read Alice gardens'
);

select throws_ok(
  $$insert into public.gardens (tenant_id, name)
    values ('11111111-1111-4111-8111-111111111111', 'Impersonated Garden')$$,
  '42501',
  null,
  'Bob cannot insert rows into Alice tenant'
);

select is(
  (select count(*) from public.accounts),
  1::bigint,
  'Bob sees only his automatically provisioned tenant account'
);

select throws_ok(
  $$insert into public.seeds (tenant_id, garden_id)
    values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )$$,
  '23503',
  null,
  'Composite foreign key blocks cross-tenant graph links'
);

select results_eq(
  $$update public.gardens
    set name = 'Stolen Garden'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    returning id$$,
  $$select null::uuid where false$$,
  'Bob cannot update Alice garden'
);

select ok(
  not has_table_privilege('anon', 'public.gardens', 'select'),
  'Anonymous users have no garden read privilege'
);

select ok(
  not has_table_privilege('authenticated', 'public.seed_revisions', 'update')
  and not has_table_privilege('authenticated', 'public.seed_revisions', 'delete'),
  'Authenticated users cannot update or delete immutable revisions'
);

reset role;

select lives_ok(
  $$delete from auth.users
    where id = '11111111-1111-4111-8111-111111111111'$$,
  'Deleting an account can erase its entire private graph'
);

select is(
  (
    select count(*)
    from public.seed_revisions
    where tenant_id = '11111111-1111-4111-8111-111111111111'
  ),
  0::bigint,
  'Account erasure cascades through private seed revisions'
);

select * from finish();
rollback;

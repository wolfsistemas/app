-- Cole no SQL Editor do Supabase e rode.

create extension if not exists "pgcrypto";

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text unique not null,
  name text not null,
  bio text default '',
  whatsapp text not null,
  pix_key text default '',
  instagram text default '',
  theme text default 'bosque',
  avatar_url text default '',
  cover_url text default '',
  plan text default 'free',
  links jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text default '',
  price numeric(10,2) not null default 0,
  compare_at numeric(10,2) default 0,
  category text default 'Geral',
  photo_url text default '',
  active boolean default true,
  sort int default 0
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_name text default '',
  items jsonb not null default '[]'::jsonb,
  note text default '',
  total numeric(10,2) not null default 0,
  status text default 'novo',
  created_at timestamptz default now()
);

create unique index if not exists stores_owner_id_key on public.stores (owner_id);

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.stores force row level security;
alter table public.products force row level security;
alter table public.orders force row level security;

do $$
declare r record;
begin
  for r in (
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('stores', 'products', 'orders')
  ) loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy stores_select_public
  on public.stores for select
  to anon, authenticated
  using (true);

create policy stores_insert_own
  on public.stores for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy stores_update_own
  on public.stores for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy stores_delete_own
  on public.stores for delete
  to authenticated
  using (auth.uid() = owner_id);

create policy products_select_public
  on public.products for select
  to anon, authenticated
  using (true);

create policy products_insert_own
  on public.products for insert
  to authenticated
  with check (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  );

create policy products_update_own
  on public.products for update
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  );

create policy products_delete_own
  on public.products for delete
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  );

create policy orders_insert_public
  on public.orders for insert
  to anon, authenticated
  with check (
    exists (select 1 from public.stores s where s.id = store_id)
  );

create policy orders_select_owner
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  );

create policy orders_update_owner
  on public.orders for update
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = store_id and s.owner_id = auth.uid()
    )
  );

grant usage on schema public to anon, authenticated;
grant select on table public.stores to anon, authenticated;
grant insert, update, delete on table public.stores to authenticated;
grant select on table public.products to anon, authenticated;
grant insert, update, delete on table public.products to authenticated;
grant insert on table public.orders to anon, authenticated;
grant select, update on table public.orders to authenticated;

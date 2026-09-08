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
  plan_expires_at timestamptz,
  order_counter int not null default 0,
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
  customer_phone text default '',
  code int,
  items jsonb not null default '[]'::jsonb,
  note text default '',
  total numeric(10,2) not null default 0,
  status text default 'novo',
  created_at timestamptz default now()
);

create unique index if not exists stores_owner_id_key on public.stores (owner_id);
create unique index if not exists orders_store_code_key on public.orders (store_id, code);

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

-- Código sequencial por loja (seguro contra corrida: lock da linha da loja)
create or replace function public.set_order_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code int;
begin
  update public.stores
     set order_counter = order_counter + 1
   where id = new.store_id
   returning order_counter into next_code;
  if next_code is null then
    raise exception 'store not found';
  end if;
  new.code := next_code;
  return new;
end
$$;

drop trigger if exists trg_order_code on public.orders;
create trigger trg_order_code
  before insert on public.orders
  for each row
  execute function public.set_order_code();

-- Visitante cria pedido via RPC e recebe o número de volta (sem SELECT anônimo)
create or replace function public.create_order(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_note text,
  p_total numeric
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.orders;
begin
  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'store not found';
  end if;
  insert into public.orders (store_id, customer_name, customer_phone, items, note, total, status)
  values (p_store_id, p_customer_name, p_customer_phone, coalesce(p_items, '[]'::jsonb), coalesce(p_note, ''), coalesce(p_total, 0), 'novo')
  returning * into rec;
  return rec;
end
$$;

revoke all on function public.create_order(uuid, text, text, jsonb, text, numeric) from public;
grant execute on function public.create_order(uuid, text, text, jsonb, text, numeric) to anon, authenticated;

-- Realtime: pedidos novos aparecem no painel sem refresh
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;

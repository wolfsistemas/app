-- Rode no SQL Editor do projeto (substitui as policies atuais).
-- Tabelas já precisam existir (rode schema.sql antes se ainda não rodou).

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

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

alter table public.stores force row level security;
alter table public.products force row level security;
alter table public.orders force row level security;

create unique index if not exists stores_owner_id_key on public.stores (owner_id);

-- Lojas: vitrine pública lê; só o dono autenticado grava.
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

-- Produtos: catálogo público; escrita só da loja do dono.
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

-- Pedidos: visitante cria; só o lojista lê/atualiza.
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

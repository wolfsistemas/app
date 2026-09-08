-- Migração para quem já rodou o schema.sql.
-- Rode no SQL Editor. Idempotente.

-- 1) Código sequencial do pedido por loja + expiração do plano
alter table public.stores add column if not exists order_counter int not null default 0;
alter table public.stores add column if not exists plan_expires_at timestamptz;

alter table public.orders add column if not exists code int;
alter table public.orders add column if not exists customer_phone text default '';

create unique index if not exists orders_store_code_key on public.orders (store_id, code);

-- 2) Trigger que numera o pedido (code = contador da loja + 1)
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

-- 3) Função segura para o visitante criar pedido e receber o número
-- (evita dar SELECT de orders para anônimos só para pegar o code)
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

-- 4) Realtime para a aba de pedidos
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

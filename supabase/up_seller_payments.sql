-- VitrineZap — A1: pagamento Pix na conta do vendedor (Mercado Pago OAuth)
-- Rode UMA vez no Supabase (SQL Editor). Aditivo; não apaga nada.
--
-- O que faz:
--   1. Colunas de pagamento no pedido (status/QR/vencimento) + token público.
--   2. Coluna stores.mp_connected (checagem pública, sem expor token).
--   3. Tabela privada store_payments com os tokens OAuth do vendedor.
--      Ela NÃO tem policy e NÃO dá grant para anon/authenticated: só o
--      service_role (usado pelo GAS) enxerga. Nunca vai para o front.
--   4. RPC get_order_public(p_token) para o comprador ver o próprio pedido
--      sem liberar SELECT anônimo em orders (evita enumerar pedidos).
--
-- Depois disso:
--   1. Atualize o GAS com o novo gas/all-in-one.js e publique "Nova versão".
--   2. No GAS, defina MP_CLIENT_ID, MP_CLIENT_SECRET e MP_REDIRECT_URI
--      (a mesma URL de redirecionamento cadastrada no app do Mercado Pago).

-- 1) Pedido: pagamento + handle público seguro
alter table public.orders add column if not exists payment_status text default 'pending';
alter table public.orders add column if not exists payment_method text default '';
alter table public.orders add column if not exists payment_code text default '';
alter table public.orders add column if not exists payment_qr text default '';
alter table public.orders add column if not exists payment_expires_at timestamptz;
alter table public.orders add column if not exists mp_payment_id text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists public_token text;

-- Backfill das linhas antigas e default para as novas (pgcrypto vem do schema.sql)
update public.orders
   set public_token = encode(gen_random_bytes(9), 'hex')
 where public_token is null;

alter table public.orders
  alter column public_token set default encode(gen_random_bytes(9), 'hex');

create unique index if not exists orders_public_token_key
  on public.orders (public_token);

-- 2) Sinal público de "loja com checkout conectado" (não expõe token)
alter table public.stores
  add column if not exists mp_connected boolean not null default false;

-- 3) Tokens OAuth do vendedor — privado
create table if not exists public.store_payments (
  store_id uuid primary key references public.stores(id) on delete cascade,
  provider text not null default 'mp',
  mp_user_id text,
  mp_access_token text,
  mp_refresh_token text,
  mp_public_key text default '',
  mp_token_expires_at timestamptz,
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.store_payments enable row level security;
alter table public.store_payments force row level security;

-- Sem policy = ninguém além do service_role acessa (ele ignora RLS).
revoke all on table public.store_payments from anon, authenticated;
grant all on table public.store_payments to service_role;

-- 4) RPC pública do pedido (busca por token aleatório, não por code sequencial)
create or replace function public.get_order_public(p_token text)
returns table (
  id uuid,
  store_id uuid,
  code int,
  status text,
  payment_status text,
  payment_code text,
  payment_qr text,
  payment_expires_at timestamptz,
  payment_method text,
  total numeric,
  items jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.id,
         o.store_id,
         o.code,
         o.status,
         o.payment_status,
         o.payment_code,
         o.payment_qr,
         o.payment_expires_at,
         o.payment_method,
         o.total,
         o.items,
         o.created_at
    from public.orders o
   where o.public_token = p_token
   limit 1
$$;

revoke all on function public.get_order_public(text) from public;
grant execute on function public.get_order_public(text) to anon, authenticated;

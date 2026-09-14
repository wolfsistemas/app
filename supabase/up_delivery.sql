-- VitrineZap — Fase 2: entrega/retirada, frete por região (CEP) e políticas de confiança.
-- Rode UMA vez no Supabase (SQL Editor). Aditivo; não apaga nada.
--
-- O que faz:
--   1. Configuração de entrega na loja (zonas por faixa de CEP, frete grátis,
--      pedido mínimo, prazo, retirada e política de trocas).
--   2. Dados de entrega no pedido (tipo, endereço, frete, subtotal, zona).
--   3. Função calc_delivery_fee(): recalcula o frete no SERVIDOR (sem confiar no front).
--   4. create_order() passa a calcular subtotal/frete no servidor e validar
--      pedido mínimo e cobertura da região.
--   5. get_order_public() devolve os novos campos para a página do pedido.
--
-- Formato da zona (stores.delivery_zones):
--   [{ "name": "Centro", "fee": 8.5, "cep_start": "01000000", "cep_end": "01999999" }]
--   - fee em reais; cep_start/cep_end de 8 dígitos (vazio = aberto dos dois lados).

-- 1) Configuração de entrega na loja
alter table public.stores add column if not exists delivery_enabled boolean not null default true;
alter table public.stores add column if not exists delivery_zones jsonb not null default '[]'::jsonb;
alter table public.stores add column if not exists free_delivery_above numeric(10,2) not null default 0;
alter table public.stores add column if not exists min_order numeric(10,2) not null default 0;
alter table public.stores add column if not exists delivery_time text not null default '';
alter table public.stores add column if not exists pickup_enabled boolean not null default true;
alter table public.stores add column if not exists pickup_address text not null default '';
alter table public.stores add column if not exists return_policy text not null default '';

-- 2) Dados de entrega no pedido
alter table public.orders add column if not exists subtotal numeric(10,2) not null default 0;
alter table public.orders add column if not exists delivery_fee numeric(10,2) not null default 0;
alter table public.orders add column if not exists delivery_type text not null default 'entrega';
alter table public.orders add column if not exists address jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists delivery_zone text not null default '';

-- 3) Frete recalculado no servidor a partir da config da loja + CEP.
--    covered=false significa "não entrego nessa região" (o front bloqueia).
create or replace function public.calc_delivery_fee(
  p_store_id uuid,
  p_cep text,
  p_subtotal numeric
)
returns table (fee numeric, zone text, covered boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores;
  zones jsonb;
  free_above numeric;
  cep text;
  cep_num bigint;
  z jsonb;
  z_start bigint;
  z_end bigint;
  zf numeric;
  zname text;
begin
  select * into s from public.stores where id = p_store_id;
  if not found then
    return query select 0::numeric, ''::text, true;
    return;
  end if;

  if not coalesce(s.delivery_enabled, true) then
    return query select 0::numeric, 'Entrega desativada'::text, true;
    return;
  end if;

  free_above := coalesce(s.free_delivery_above, 0);
  if free_above > 0 and coalesce(p_subtotal, 0) >= free_above then
    return query select 0::numeric, 'Frete grátis'::text, true;
    return;
  end if;

  zones := coalesce(s.delivery_zones, '[]'::jsonb);

  -- Sem zonas configuradas: frete combinado no WhatsApp (não bloqueia).
  if jsonb_array_length(zones) = 0 then
    return query select 0::numeric, ''::text, true;
    return;
  end if;

  cep := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  cep_num := case when length(cep) = 8 then cep::bigint else null end;

  if cep_num is not null then
    for z in select * from jsonb_array_elements(zones) loop
      zname := coalesce(z->>'name', '');
      zf := coalesce(nullif(regexp_replace(coalesce(z->>'fee', ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
      z_start := nullif(regexp_replace(coalesce(z->>'cep_start', ''), '\D', '', 'g'), '')::bigint;
      z_end := nullif(regexp_replace(coalesce(z->>'cep_end', ''), '\D', '', 'g'), '')::bigint;
      if (z_start is null or cep_num >= z_start) and (z_end is null or cep_num <= z_end) then
        return query select zf, zname, true;
        return;
      end if;
    end loop;
  end if;

  -- Zonas configuradas e CEP fora delas (ou CEP inválido): não entrega.
  return query select 0::numeric, ''::text, false;
end
$$;

revoke all on function public.calc_delivery_fee(uuid, text, numeric) from public;
grant execute on function public.calc_delivery_fee(uuid, text, numeric) to anon, authenticated;

-- 4) create_order recriada: subtotal/frete no servidor + validações.
drop function if exists public.create_order(uuid, text, text, jsonb, text, numeric);
drop function if exists public.create_order(uuid, text, text, jsonb, text, numeric, text);

create function public.create_order(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_note text,
  p_total numeric,
  p_customer_email text default '',
  p_delivery_type text default 'entrega',
  p_address jsonb default '{}'::jsonb,
  p_cep text default ''
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.orders;
  s public.stores;
  v_subtotal numeric := 0;
  v_fee numeric := 0;
  v_zone text := '';
  v_covered boolean := true;
  v_type text := case when coalesce(p_delivery_type, '') = 'retirada' then 'retirada' else 'entrega' end;
  it jsonb;
  cep text;
begin
  select * into s from public.stores where id = p_store_id;
  if not found then
    raise exception 'store not found';
  end if;

  -- Subtotal recalculado no servidor a partir dos itens (não confia no total do front).
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for it in select * from jsonb_array_elements(p_items) loop
      v_subtotal := v_subtotal + coalesce((it->>'price')::numeric, 0) * coalesce((it->>'qty')::numeric, 0);
    end loop;
  end if;
  if v_subtotal <= 0 then
    v_subtotal := coalesce(p_total, 0);
  end if;

  if coalesce(s.min_order, 0) > 0 and v_subtotal < s.min_order then
    raise exception 'min_order_not_met';
  end if;

  if v_type = 'retirada' then
    v_fee := 0;
    v_zone := 'Retirada na loja';
    v_covered := true;
  else
    cep := coalesce(nullif(p_cep, ''), coalesce(p_address->>'cep', ''));
    select f.fee, f.zone, f.covered into v_fee, v_zone, v_covered
      from public.calc_delivery_fee(p_store_id, cep, v_subtotal) f;
    if not v_covered then
      raise exception 'delivery_not_available';
    end if;
  end if;

  insert into public.orders (
    store_id, customer_name, customer_phone, customer_email, items, note,
    subtotal, delivery_fee, delivery_type, address, delivery_zone, total, status
  ) values (
    p_store_id,
    p_customer_name,
    coalesce(p_customer_phone, ''),
    coalesce(p_customer_email, ''),
    coalesce(p_items, '[]'::jsonb),
    coalesce(p_note, ''),
    v_subtotal,
    coalesce(v_fee, 0),
    v_type,
    coalesce(p_address, '{}'::jsonb),
    coalesce(v_zone, ''),
    v_subtotal + coalesce(v_fee, 0),
    'novo'
  )
  returning * into rec;
  return rec;
end
$$;

revoke all on function public.create_order(uuid, text, text, jsonb, text, numeric, text, text, jsonb, text) from public;
grant execute on function public.create_order(uuid, text, text, jsonb, text, numeric, text, text, jsonb, text) to anon, authenticated;

-- 5) get_order_public com os campos de entrega (muda o retorno: recriar).
drop function if exists public.get_order_public(text);

create function public.get_order_public(p_token text)
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
  subtotal numeric,
  delivery_fee numeric,
  delivery_type text,
  address jsonb,
  delivery_zone text,
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
         o.subtotal,
         o.delivery_fee,
         o.delivery_type,
         o.address,
         o.delivery_zone,
         o.total,
         o.items,
         o.created_at
    from public.orders o
   where o.public_token = p_token
   limit 1
$$;

revoke all on function public.get_order_public(text) from public;
grant execute on function public.get_order_public(text) to anon, authenticated;

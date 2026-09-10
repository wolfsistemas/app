-- VitrineZap — retomada do cliente: e-mail no pedido + aviso enviado
-- Rode UMA vez no Supabase (SQL Editor). Aditivo; não apaga nada.
--
-- O que faz:
--   1. Guarda o e-mail do cliente no pedido (opcional, preenchido no checkout).
--   2. Marca quando o e-mail de retomada já foi enviado (evita repetir).
--   3. Atualiza a RPC create_order para aceitar o e-mail.
--
-- Depois disso:
--   1. Atualize o GAS com o gas/all-in-one.js e publique "Nova versão".
--   2. Defina APP_URL no GAS (URL do site, ex.: https://wolfsistemas.github.io/app)
--      para que os e-mails incluam o link do pedido.

alter table public.orders add column if not exists customer_email text default '';
alter table public.orders add column if not exists customer_notified_at timestamptz;

-- create_order passa a aceitar p_customer_email (default '', então o
-- front antigo continua funcionando). A assinatura muda, então recriamos.
drop function if exists public.create_order(uuid, text, text, jsonb, text, numeric);

create function public.create_order(
  p_store_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_note text,
  p_total numeric,
  p_customer_email text default ''
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
  insert into public.orders (store_id, customer_name, customer_phone, customer_email, items, note, total, status)
  values (
    p_store_id,
    p_customer_name,
    p_customer_phone,
    coalesce(p_customer_email, ''),
    coalesce(p_items, '[]'::jsonb),
    coalesce(p_note, ''),
    coalesce(p_total, 0),
    'novo'
  )
  returning * into rec;
  return rec;
end
$$;

revoke all on function public.create_order(uuid, text, text, jsonb, text, numeric, text) from public;
grant execute on function public.create_order(uuid, text, text, jsonb, text, numeric, text) to anon, authenticated;

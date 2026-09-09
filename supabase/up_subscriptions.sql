-- VitrineZap — assinatura recorrente Mercado Pago
-- Rode UMA vez no Supabase (SQL Editor). Cria as colunas que guardam o
-- vínculo loja <-> assinatura MP criada pelo GAS.
--
-- Depois disso:
--   1. Atualize o GAS com o novo gas/all-in-one.js e publique "Nova versão".
--   2. No GAS, defina PAYMENT_PROVIDER=mp e MP_ACCESS_TOKEN (TEST-... se for sandbox).
--   3. Rode também a migração supabase/up_mp_plans.sql (coluna mp_plan_id).
--      O front usa checkout HOSPEDADO: o GAS devolve o init_point do plano e o
--      comprador paga na página do Mercado Pago — NÃO existe VITE_MP_PUBLIC_KEY.
--
-- Colunas são aditivas; não apaga nada.

alter table public.stores
  add column if not exists mp_subscription_id text;

alter table public.stores
  add column if not exists mp_subscription_status text;

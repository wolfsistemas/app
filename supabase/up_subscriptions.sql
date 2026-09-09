-- VitrineZap — assinatura recorrente Mercado Pago
-- Rode UMA vez no Supabase (SQL Editor). Cria as colunas que guardam o
-- vínculo loja <-> assinatura MP criada pelo GAS.
--
-- Depois disso:
--   1. Atualize o GAS com o novo gas/all-in-one.js e publique "Nova versão".
--   2. No GAS, defina PAYMENT_PROVIDER=mp e MP_ACCESS_TOKEN.
--   3. No .env.production do front, preencha VITE_MP_PUBLIC_KEY (chave pública).
--
-- Colunas são aditivas; não apaga nada.

alter table public.stores
  add column if not exists mp_subscription_id text;

alter table public.stores
  add column if not exists mp_subscription_status text;

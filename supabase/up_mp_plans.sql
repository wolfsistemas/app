-- VitrineZap — assinatura MP HOSPEDADA com plano (preapproval_plan + init_point)
-- Rode UMA vez no Supabase (SQL Editor). Cria a coluna que guarda o id do
-- plano (preapproval_plan) vinculado à loja. Os webhooks do MP trazem o
-- preapproval_plan_id e o GAS localiza a loja por mp_plan_id.
--
-- Depois disso:
--   1. Atualize o GAS com o novo gas/all-in-one.js e publique "Nova versão".
--   2. No GAS, defina PAYMENT_PROVIDER=mp, MP_ACCESS_TOKEN e (se testar)
--      MP_USE_SANDBOX=true.
--   3. O front NÃO usa VITE_MP_PUBLIC_KEY (sem Brick; checkout na página do MP):
--      o .env só precisa de VITE_BILLING_URL apontando para o GAS.
--
-- Coluna é aditiva; não apaga nada.

alter table public.stores
  add column if not exists mp_plan_id text;

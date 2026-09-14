# Runbook — Cobrança avulsa + assinatura recorrente no Mercado Pago (Edge Function + Supabase)

Guia de implementação para replicar em outro sistema sem sofrer. Referência canônica deste repo: `supabase/functions/api/` (o antigo Apps Script `gas/all-in-one.js` fica só como referência).

## 1. Conceito-chave (não pule)

- **Front NÃO tokeniza cartão.** Sem Brick, sem `card_token`, sem `VITE_MP_PUBLIC_KEY`.
- Modelo **HOSPEDADO COM PLANO**: o backend cria um `preapproval_plan` por cliente e devolve o `init_point`. A 1ª cobrança acontece na página do Mercado Pago. Isso destrava o sandbox (sem o erro "payer/collector both real or test").
- **Segurança sem assinatura secreta**: o webhook **só confia no id** e **re-busca o recurso na API do MP** com o token antes de ativar (a Edge Function até vê headers, mas mantemos o padrão conservador).
- **Ativação com 2 garantias**: webhook (principal) + `sync_subscription` (rede de segurança chamada quando o usuário volta do checkout).

## 2. Fluxos

### Assinatura mensal (recorrente no cartão)
1. Front: botão "Assinar" → `POST {action:'subscribe', store_id, redirect_url}`.
2. Edge Function `api` `handleSubscribeMp` → `ensureMpPlan`: cria `preapproval_plan` (ou reusa ativo) e grava `mp_plan_id` na loja. Devolve `{ok, url: init_point}`.
3. Front redireciona para `init_point`. Comprador paga a 1ª cobrança NA PÁGINA DO MP.
4. MP cria a assinatura (preapproval). Webhook `subscription_preapproval` com `status=authorized` → a função grava `mp_subscription_id/status` e ativa `plan=pro`, `plan_expires_at=+30d`.
5. Volta pro front em `?plano=ok` → chama `sync_subscription` (retries) → se webhook atrasou, ativa via API. Botão manual "Já assinei — verificar" cobre o resto.
6. Mensalidades seguintes: MP cobra sozinho; webhook `subscription_authorized_payment`/`payment` renova `plan_expires_at=+30d`.
7. Cancelamento: `PUT /preapproval/{id}` `{status:'canceled'}` → grava `mp_subscription_status`; **acesso continua até a data paga** (não revoga na hora).

### Pagamento avulso (1x, 30 dias, sem recorrência)
- `POST {action:'checkout', store_id, redirect_url}` → a função cria Checkout Pro (`POST /checkout/preferences`, `external_reference = store_id:timestamp`) → devolve URL → paga → webhook `payment` ativa +30d.

## 3. Supabase (colunas em `stores`)

```sql
plan text default 'free';
plan_expires_at timestamptz;
mp_subscription_id text;      -- vínculo loja <-> preapproval
mp_subscription_status text;  -- authorized | canceled | paused
mp_plan_id text;              -- id do preapproval_plan do MP
```

## 4. Edge Function `api` — Secrets

| Secret | Valor |
|---|---|
| `SUPABASE_URL` | automático (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | automático (**só no servidor, nunca no front**) |
| `PAYMENT_PROVIDER` | `mp` |
| `MP_ACCESS_TOKEN` | produção `APP_USR-...` / teste `TEST-...` |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | OAuth do lojista (Pix na conta dele) |
| `MP_REDIRECT_URI` | `https://<ref>.supabase.co/functions/v1/api?action=mp_callback` |
| `MP_USE_SANDBOX` | `true` só em teste (usar `sandbox_init_point`); **remover em produção** |
| `EMAIL_LOG` | e-mail que recebe os logs (default wolfsaasbr@gmail.com) |
| `RESEND_API_KEY` / `EMAIL_FROM` | e-mail transacional |
| `PLAN_PRICE_CENTS` | default `990` (R$ 9,90) |
| `APP_URL` / `PUBLIC_API_URL` | URL do site / URL pública da função |
| `IMGBB_API_KEY` | p/ upload (a chave nunca vai ao front) |
| `INFINITEPAY_HANDLE` | só se `PAYMENT_PROVIDER=infinitepay` |
| `PUSH_FUNCTION_URL` / `PUSH_SECRET` | push server-to-server |

- Deploy: `npx supabase@latest functions deploy api --project-ref <ref> --no-verify-jwt`. **A URL é estável** (não muda a cada deploy, ao contrário do Apps Script).
- Roteamento: POST `checkout` | `subscribe` | `cancel_subscription` | `sync_subscription` | `mp_connect` | `mp_status` | `mp_disconnect` | `create_pix` | `refund_payment` | `order_notify` | `push_test` | `upload` | `delete_account`; GET `ping` (retorna `{ok, provider, routes}`) e `?action=mp_callback` (OAuth).
- **Dedupe**: a tabela `processed_events` (unique) substitui a lista `MP_PROCESSED`. Rode `supabase/up_edge_api.sql`.

## 5. Webhooks no painel do MP (fácil de esquecer!)

- Cadastrar a URL da função (`.../functions/v1/api?wh=mp`) em **Webhooks**.
- **Eventos necessários**: os de "Planos e assinaturas" (`subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`, `preapproval`) + `payment` (pra avulso/1ª cobrança). No painel: "Eventos recomendados ... Planos e assinaturas".
- Fazer isso no **modo teste** E depois no **modo produção** (são separados).
- "Assinatura secreta" (`x-signature`) **não é usada** — o webhook só confia no id e re-busca o recurso.
- Evento de simulação do painel (ex.: `preapproval/123456`) retorna 404 na API → a função responde 200 silencioso (não é erro).

## 6. Regras de ouro do código do webhook

- **Dedupe com marcação tardia**: conferir se já processou no INÍCIO, mas só **marcar como processado DEPOIS de ativar com sucesso** no Supabase. Se marcar antes e o Supabase falhar, o retry do MP é engolido → cliente pagou e não ativou.
- `external_reference` da assinatura é `'plan:' + storeId` (UUID da loja). Webhooks do MP ecoam esse valor → **extrair a loja pelo prefixo `plan:`**.
- Falha = `throw` → a função devolve HTTP 500 → MP reenvia. Nunca retornar 200 sem ter processado.
- Sempre re-buscar o recurso (`GET /v1/payments/{id}`, `/preapproval/{id}`, `/authorized_payments/{id}`) antes de ativar.

## 7. Front (.env)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # público, pode ir pro build
VITE_API_URL=https://<ref>.supabase.co/functions/v1/api   # backend único (Edge Function)
```

- Sem `VITE_API_URL` → esconde botões de pagamento (modo demonstração).
- `mpBillingAvailable()` (GET na função) decide se mostra "Assinar recorrente" (provider=mp) ou só avulso.
- Volta do checkout: `?plano=ok` → `sync_subscription` com tentativas/intervalos + refresh.
- R$ e centavos: no **front e no preapproval** cuidado — MP usa **reais (float)** em `preapproval_plan.transaction_amount` e **centavos** no InfinitePay.

## 8. Checklist produção

1. `MP_ACCESS_TOKEN` = **APP_USR-...** e `MP_USE_SANDBOX` **removido/vazio**.
2. Deploy final da Edge Function `api` com todos os secrets (incluindo `MP_CLIENT_SECRET` e `RESEND_API_KEY`).
3. Painel MP → Webhooks → **Modo de produção**: mesma URL (`?wh=mp`) + eventos "Planos e assinaturas".
4. Build do front com `VITE_API_URL` apontando para a função de produção (não a de teste).
5. Renovações mensais dependem do webhook ativo (recorrência/cobrança em si é automática do MP).
6. (Recomendado) Rotacionar `VAPID_PRIVATE_KEY` e `UPLOAD_TOKEN` antes de vender.

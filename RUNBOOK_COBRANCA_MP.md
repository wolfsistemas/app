# Runbook — Cobrança avulsa + assinatura recorrente no Mercado Pago (Apps Script + Supabase)

Guia de implementação para replicar em outro sistema sem sofrer. Referência canônica deste repo: `gas/all-in-one.js`.

## 1. Conceito-chave (não pule)

- **Front NÃO tokeniza cartão.** Sem Brick, sem `card_token`, sem `VITE_MP_PUBLIC_KEY`.
- Modelo **HOSPEDADO COM PLANO**: o backend cria um `preapproval_plan` por cliente e devolve o `init_point`. A 1ª cobrança acontece na página do Mercado Pago. Isso destrava o sandbox (sem o erro "payer/collector both real or test").
- **Segurança sem assinatura secreta**: Apps Script não expõe header `x-signature`. Em vez disso, o webhook **só confia no id** e **re-busca o recurso na API do MP** com o token antes de ativar.
- **Ativação com 2 garantias**: webhook (principal) + `sync_subscription` (rede de segurança chamada quando o usuário volta do checkout).

## 2. Fluxos

### Assinatura mensal (recorrente no cartão)
1. Front: botão "Assinar" → `POST {action:'subscribe', store_id, redirect_url}`.
2. GAS `handleSubscribeMp` → `ensureMpPlan`: cria `preapproval_plan` (ou reusa ativo) e grava `mp_plan_id` na loja. Devolve `{ok, url: init_point}`.
3. Front redireciona para `init_point`. Comprador paga a 1ª cobrança NA PÁGINA DO MP.
4. MP cria a assinatura (preapproval). Webhook `subscription_preapproval` com `status=authorized` → GAS grava `mp_subscription_id/status` e ativa `plan=pro`, `plan_expires_at=+30d`.
5. Volta pro front em `?plano=ok` → chama `sync_subscription` (retries) → se webhook atrasou, ativa via API. Botão manual "Já assinei — verificar" cobre o resto.
6. Mensalidades seguintes: MP cobra sozinho; webhook `subscription_authorized_payment`/`payment` renova `plan_expires_at=+30d`.
7. Cancelamento: `PUT /preapproval/{id}` `{status:'canceled'}` → grava `mp_subscription_status`; **acesso continua até a data paga** (não revoga na hora).

### Pagamento avulso (1x, 30 dias, sem recorrência)
- `POST {action:'checkout', store_id, redirect_url}` → GAS cria Checkout Pro (`POST /checkout/preferences`, `external_reference = store_id:timestamp`) → devolve URL → paga → webhook `payment` ativa +30d.

## 3. Supabase (colunas em `stores`)

```sql
plan text default 'free';
plan_expires_at timestamptz;
mp_subscription_id text;      -- vínculo loja <-> preapproval
mp_subscription_status text;  -- authorized | canceled | paused
mp_plan_id text;              -- id do preapproval_plan do MP
```

## 4. GAS (`gas/all-in-one.js`) — Script Properties

| Property | Valor |
|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE` | service_role (**só aqui, nunca no front**) |
| `PAYMENT_PROVIDER` | `mp` |
| `MP_ACCESS_TOKEN` | produção `APP_USR-...` / teste `TEST-...` |
| `MP_USE_SANDBOX` | `true` só em teste (usar `sandbox_init_point`); **remover em produção** |
| `EMAIL_LOG` | e-mail que recebe os logs (default wolfsaasbr@gmail.com) |
| `PLAN_PRICE_CENTS` | default `990` (R$ 9,90) |
| `UPLOAD_TOKEN` | token de upload (opcional) |
| `IMGBB_API_KEY` | p/ upload (opcional) |
| `INFINITEPAY_HANDLE` | só se `PAYMENT_PROVIDER=infinitepay` |
| `MP_PROCESSED` | **NÃO mexer** — cache interno do dedupe, escrito via código |

- Deploy: Web app, *Execute as: Me*, *Who has access: Anyone*. **Ao atualizar, use "Nova versão" no MESMO deployment** — criar deployment novo muda a URL e quebra `.env` + webhook do MP.
- Roteamento: POST `checkout` | `subscribe` | `cancel_subscription` | `sync_subscription` | `upload` | evento de webhook. GET retorna `{ok, service, provider, routes}` (usado pelo front p/ saber se é MP).

## 5. Webhooks no painel do MP (fácil de esquecer!)

- Cadastrar a URL do GAS (`.../exec`) em **Webhooks**.
- **Eventos necessários**: os de "Planos e assinaturas" (`subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`, `preapproval`) + `payment` (pra avulso/1ª cobrança). No painel: "Eventos recomendados ... Planos e assinaturas".
- Fazer isso no **modo teste** E depois no **modo produção** (são separados).
- "Assinatura secreta" (`x-signature`) **não é usada** — Apps Script não enxerga headers.
- Evento de simulação do painel (ex.: `preapproval/123456`) retorna 404 na API → GAS responde 200 silencioso (não é erro).

## 6. Regras de ouro do código do webhook

- **Dedupe com marcação tardia**: conferir se já processou no INÍCIO, mas só **marcar como processado DEPOIS de ativar com sucesso** no Supabase. Se marcar antes e o Supabase falhar, o retry do MP é engolido → cliente pagou e não ativou.
- `external_reference` da assinatura é `'plan:' + storeId` (UUID da loja). Webhooks do MP ecoam esse valor → **extrair a loja pelo prefixo `plan:`**.
- Falha = `throw` → Apps Script devolve HTTP 500 → MP reenvia. Nunca retornar 200 sem ter processado.
- Sempre re-buscar o recurso (`GET /v1/payments/{id}`, `/preapproval/{id}`, `/authorized_payments/{id}`) antes de ativar.

## 7. Front (.env)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # público, pode ir pro build
VITE_BILLING_URL=https://script.google.com/macros/s/SEU_GAS/exec   # mesma URL do VITE_UPLOAD_URL se projeto único
VITE_UPLOAD_URL=...                 # igual à billing se all-in-one
VITE_UPLOAD_TOKEN=...               # igual ao UPLOAD_TOKEN do GAS
```

- Sem `VITE_BILLING_URL` → esconde botões de pagamento (modo demonstração).
- `mpBillingAvailable()` (GET no GAS) decide se mostra "Assinar recorrente" (provider=mp) ou só avulso.
- Volta do checkout: `?plano=ok` → `sync_subscription` com tentativas/intervalos + refresh.
- R$ e centavos: no **front e no preapproval** cuidado — MP usa **reais (float)** em `preapproval_plan.transaction_amount` e **centavos** no InfinitePay.

## 8. Checklist produção

1. `MP_ACCESS_TOKEN` = **APP_USR-...** e `MP_USE_SANDBOX` **removido/vazio**.
2. Colar GAS final e publicar **Nova versão no mesmo deployment**.
3. Painel MP → Webhooks → **Modo de produção**: mesma URL + eventos "Planos e assinaturas".
4. Build do front com `VITE_BILLING_URL` apontando pro GAS de produção (não o de teste).
5. Renovações mensais dependem do webhook ativo (recorrência/cobrança em si é automática do MP).
6. (Recomendado) Rotacionar `VITE_UPLOAD_TOKEN` exposto no repo antes de vender.

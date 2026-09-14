# VitrineZap

SaaS de **bio link + catálogo** para quem vende no WhatsApp.

O cliente abre o link da bio, escolhe as peças e o pedido cai formatado no zap do lojista.

## Stack (sem backend ligado 24h)

- Front estático (Vite + React) no GitHub Pages / Cloudflare Pages
- Auth, Postgres e Realtime no **Supabase**
- Backend (cobrança, Pix, webhooks, upload, e-mail): **Edge Functions do Supabase** (a função `api` é o backend único; `push-notify` cuida do push)
- Pagamento: **InfinitePay** ou **Mercado Pago** (troca por secret `PAYMENT_PROVIDER`)
- E-mail transacional via **Resend**
- PWA instalável + analytics leve (Umami)

Sem VPS. O browser fala direto com o Supabase; o que precisa de segredo (tokens, webhook, upload) roda nas Edge Functions.

## O que já está no MVP

- Landing e planos (grátis / Plano Loja R$ 9,90 por 30 dias ou assinatura mensal recorrente)
- Cadastro, login e onboarding da loja
- Recuperação de senha por e-mail
- Vitrine pública por slug (`/ana-atelier` é a demo)
- Bio com botões (Instagram e links)
- Carrinho e pedido no WhatsApp com **código sequencial por loja**
- Painel: produtos, pedidos (tempo real com som), tema, PIX, plano
- Limite de 8 produtos no plano grátis
- Marca VitrineZap no rodapé do plano free (removida no Loja)
- Checkout avulso via link (InfinitePay / Mercado Pago) + **assinatura mensal recorrente (Mercado Pago hospedado com plano, cancele quando quiser)**
- **Pix com confirmação automática** no Plano Loja: o lojista conecta a conta do Mercado Pago e o dinheiro cai direto nele (sem custódia)
- **Entrega por região/CEP** (ViaCEP), retirada na loja, frete grátis, pedido mínimo e política de trocas
- **E-mails HTML** (Resend) de pedido, pagamento, envio e retomada + selos de confiança na vitrine

## Como rodar

```bash
npm install
npm run dev
```

Sem `.env`, o app usa **modo local** (dados no navegador + loja demo).

## Ligar o Supabase

1. Crie um projeto no Supabase.
2. No SQL Editor, rode nesta ordem: `supabase/schema.sql`, `supabase/rls.sql`, `supabase/storage.sql`.
3. Se já existiam tabelas, rode também a migração `supabase/up_orders_v2.sql` (código do pedido, telefone do cliente, expiração de plano e realtime). Para assinatura recorrente (Mercado Pago), rode também `supabase/up_subscriptions.sql` e `supabase/up_mp_plans.sql`. Para o Pix na conta do vendedor (OAuth), rode `supabase/up_seller_payments.sql`. Para o e-mail de retomada do cliente, rode `supabase/up_order_notify.sql`. Para a entrega por região/CEP e as políticas da loja, rode `supabase/up_delivery.sql`. Para a idempotência dos webhooks, rode `supabase/up_edge_api.sql`.
4. Em Authentication > Providers, deixe e-mail/senha ligado. Ligue **Confirm email** e cole os templates em PT-BR de `supabase/email-templates/` (veja o README da pasta). Em dev, se quiser testar rápido, pode desligar o Confirm email.
5. Em Authentication > URL configuration: Site URL e Redirect URLs apontando para o endereço do app (`https://wolfsistemas.github.io/app/**`).
6. Copie `.env.example` para `.env` e preencha URL + anon key. Em produção, preencha também `VITE_API_URL` em `.env.production`.
7. Faça o deploy das Edge Functions e configure os secrets (veja **Backend (Edge Functions)** abaixo).

## Backend (Edge Functions)

Todo o backend com segredo roda em **Edge Functions** do Supabase. A função `api` é um roteador único: o front manda `POST` com `{ action, ...payload }` (e `GET` para o callback OAuth do Mercado Pago e para o `ping`).

```bash
# Função principal (API) — sem verificação de JWT (cada ação valida o que precisa)
npx supabase@latest functions deploy api --project-ref <ref> --no-verify-jwt

# Função de push (protegida por x-push-secret)
npx supabase@latest functions deploy push-notify --project-ref <ref> --no-verify-jwt
```

Secrets da função `api`:

| Secret | Para que serve |
| --- | --- |
| `PAYMENT_PROVIDER` | `infinitepay` (padrão) ou `mp` |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | OAuth do lojista (Pix na conta dele) |
| `MP_ACCESS_TOKEN` | Assinatura do plano (seu token MP) |
| `MP_REDIRECT_URI` | `https://<ref>.supabase.co/functions/v1/api?action=mp_callback` |
| `PLAN_PRICE_CENTS` | Preço do plano (padrão `990`) |
| `APP_URL` | URL do site (links em e-mail/back_urls) |
| `PUBLIC_API_URL` | URL pública da função (usada em `notification_url`/webhooks) |
| `PUSH_FUNCTION_URL` / `PUSH_SECRET` | Chamada server-to-server para a `push-notify` |
| `IMGBB_API_KEY` | Upload de fotos (a chave nunca vai ao front) |
| `RESEND_API_KEY` / `EMAIL_FROM` | E-mail transacional (Resend) |
| `EMAIL_LOG` | Cópia/notificação interna (ex.: `wolfsaasbr@gmail.com`) |
| `INFINITEPAY_HANDLE` | Handle da InfinitePay (quando `PAYMENT_PROVIDER=infinitepay`) |

Webhooks ficam na própria `api`: `?wh=mp` (Mercado Pago) e `?wh=infinitepay`. A idempotência usa a tabela `processed_events` (rode `supabase/up_edge_api.sql`).

No front, `VITE_API_URL` aponta para `https://<ref>.supabase.co/functions/v1/api`. Sem essa variável, o painel esconde os botões de cobrança e o upload cai no fallback.

## Fotos

O upload nunca expõe a chave no front:

1. **Dev**: Vite envia para `/api/upload` (proxy do Vite) e a chave ImgBB fica no `.env` local.
2. **Produção com `VITE_API_URL`**: o front envia `action=upload` para a Edge Function `api`, que guarda a `IMGBB_API_KEY` no servidor e exige usuário autenticado (ou `UPLOAD_TOKEN`).
3. **Sem `VITE_API_URL`**: o usuário logado envia para o bucket público **`fotos`** do Supabase Storage (fallback).

Álbum: a API do ImgBB **não coloca a foto num álbum**. Dá para organizar depois no site (ibb.co), mas não no upload.

## Entrega, frete e retirada

Cada loja configura a entrega no painel (aba **Vitrine**, seção "Entrega e retirada"):

- **Faço entrega** (`delivery_enabled`), **Prazo** (`delivery_time`)
- **Frete grátis acima de** (`free_delivery_above`) e **Pedido mínimo** (`min_order`)
- **Retirada na loja** (`pickup_enabled`, `pickup_address`)
- **Regiões por faixa de CEP** (`delivery_zones`): `[{ "name": "Centro", "fee": 8.5, "cep_start": "01000000", "cep_end": "01999999" }]`
- **Política de trocas** (`return_policy`), mostrada na página do pedido

No checkout, o cliente escolhe **Entrega** ou **Retirada**, informa o CEP (autopreenchido pelo **ViaCEP**) e o frete aparece na hora.

O frete **é recalculado no servidor** pela função `calc_delivery_fee()` dentro da RPC `create_order` — o front só exibe uma prévia com a mesma regra (não dá para burlar o valor). Regras:

- Sem zonas cadastradas: frete **combinado no WhatsApp** (não bloqueia o pedido).
- Com zonas: se o CEP não bate em nenhuma faixa, o pedido é recusado (`delivery_not_available`).
- Frete grátis e pedido mínimo são validados no banco.

Rode a migração `supabase/up_delivery.sql` (adiciona as colunas, a função de frete e atualiza `create_order`/`get_order_public`).

## E-mails transacionais (Resend)

Os e-mails são enviados pela Edge Function (templates HTML em `supabase/functions/api/_shared/email.ts`):

- **Pedido recebido** (`created`, uma vez) e **Pix pendente/retomada**
- **Pagamento confirmado** (`paid`) — disparado pelo webhook
- **Pedido enviado** (`shipped`) — quando o lojista marca "Enviado"
- **Pix expirado** (`expired`) — retomada de carrinho na página do pedido

O lojista também recebe aviso de pedido pago (e-mail + push). Configure `RESEND_API_KEY` e `EMAIL_FROM`.

## Assinatura (Plano Loja)

1. O painel mostra o botão de assinar quando `VITE_API_URL` está configurado (`mpBillingAvailable()` faz um `GET` na Edge Function e checa `provider=mp`).
2. A Edge Function `api` (`action=checkout` ou `action=subscribe`) cria o link de pagamento e devolve a URL do checkout — o valor fica fixo em R$ 9,90/30 dias, com `order_nsu` no formato `store_id:timestamp` para o webhook identificar a loja.
3. Na confirmação, o provedor chama o webhook (`?wh=mp` ou `?wh=infinitepay`), que marca `plan = pro` com `plan_expires_at = agora + 30 dias` e confirma lendo a loja de volta.
4. Sem `VITE_API_URL`, o painel oferece apenas um botão de demonstração (sem cobrança).

### Trocar o provedor (sem mexer no app)

Na Edge Function, mude o secret `PAYMENT_PROVIDER`:

- `infinitepay` (padrão) — usa `INFINITEPAY_HANDLE` (sua InfiniteTag, ex.: `maiconvss`, sem o `$`)
- `mp` — usa `MP_ACCESS_TOKEN` (Access Token do Mercado Pago); opcional `MP_USE_SANDBOX=true` para testar em sandbox

### Assinatura recorrente no cartão (Mercado Pago) — modelo HOSPEDADO com plano

Com o provedor em `mp`, o painel oferece **"Assinar · R$ 9,90/mês"**: cobrança mensal automática, sem fidelidade (cancele quando quiser). Usamos o modelo **"com plano associado"**: a Edge Function cria um `preapproval_plan` por loja e redireciona para a **página do Mercado Pago** (`init_point`), onde o comprador paga a 1ª cobrança. Isso destrava o sandbox: o MP não exige pareamento comprador/cobrador no servidor e dá para testar com usuário/cartão de teste sem gastar.

Passos:

1. **Edge Function**: deploy da `api` com `PAYMENT_PROVIDER=mp` + `MP_ACCESS_TOKEN`.
2. **Supabase**: rode `supabase/up_subscriptions.sql` e depois `supabase/up_mp_plans.sql` (adicionam `mp_subscription_id`, `mp_subscription_status` e `mp_plan_id` na `stores`).
3. **Front**: basta `VITE_API_URL` apontando para a função. **Não existe `VITE_MP_PUBLIC_KEY`** (não usamos Brick/tokenização no front — o checkout é a página hospedada do MP).

Para testar **sem pagar** (sandbox): defina `MP_USE_SANDBOX=true` com um `MP_ACCESS_TOKEN` **TEST-...** e abra o link de assinatura; entre na conta do **usuário de teste** que aparece na própria tela de credenciais do MP (bloco "Dados das credenciais de teste" — usuário `TESTUSER...` + senha) e pague com **cartão de teste**. Em produção use `MP_ACCESS_TOKEN` **APP_USR-...** (sem `MP_USE_SANDBOX`).

Como funciona:

- O front pede "assinar" e a Edge Function cria/pega o plano da loja (`POST /preapproval_plan`, **sem** `card_token_id`/`payer_email`) e devolve o `init_point`.
- O comprador paga a 1ª cobrança na página do Mercado Pago. Quando o MP cria a assinatura, o webhook `subscription_preapproval` (status `authorized`) ativa o plano +30 dias e grava o vínculo loja <-> assinatura via `preapproval_plan_id` ↔ `mp_plan_id`.
- A cada mensalidade paga, `subscription_authorized_payment`/`payment` renova `plan_expires_at` por +30 dias. Eventos de assinatura cancelada/pausada só atualizam o status — **o acesso continua até a data já paga**.
- No painel, quem assinou vê "Cancelar assinatura recorrente" (`action=cancel_subscription`).

Observação: recorrência automática exige **cartão** (a 1ª cobrança pode ser no cartão; Pix avulso continua como alternativa de 30 dias).

Secrets comuns: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `EMAIL_LOG` (padrão: wolfsaasbr@gmail.com).

## Recebimento Pix na conta do vendedor (A1, sem custódia)

O **Plano Loja** conecta a conta do Mercado Pago do lojista via **OAuth**. A partir daí, o Pix do pedido é criado **na conta do vendedor** (o dinheiro nunca passa pelo VitrineZap) e o pedido é confirmado **automaticamente** pelo webhook. O plano grátis continua só com a chave PIX manual.

### Configurar o app no Mercado Pago

No painel de developers, na aplicação:

- Tipo de solução: **Pagamentos online**
- Plataforma de e-commerce: **Não**
- Produto: **Checkout Transparente > API Pagamentos**
- Redirect URL: `https://<ref>.supabase.co/functions/v1/api?action=mp_callback` (a mesma de `MP_REDIRECT_URI`)
- PKCE: **Não**
- Permissões: **read + write + offline access**

### Secrets da Edge Function

`MP_CLIENT_ID`, `MP_CLIENT_SECRET` (segredo — só no servidor), `MP_REDIRECT_URI` (a mesma URL cadastrada). O `MP_ACCESS_TOKEN` continua sendo o seu token (assinatura do plano); o token do vendedor fica no banco (`store_payments`, privada, só `service_role`). Defina também `APP_URL` (URL do site, ex.: `https://wolfsistemas.github.io/app`) para que os e-mails incluam o link do pedido.

### Fluxo

1. Lojista clica em **Conectar Mercado Pago** no painel (`action=mp_connect`) e autoriza no MP.
2. A Edge Function troca o `code` pelo `access_token` do vendedor no `GET ?action=mp_callback`, grava em `store_payments` e marca `stores.mp_connected`.
3. No checkout, `action=create_pix` cria o Pix com o token do vendedor e guarda o QR/copia-e-cola no pedido (exige o `public_token` do pedido).
4. O MP chama o webhook (`?wh=mp`); a função identifica a loja pelo `body.user_id`, re-busca o pagamento com o token do vendedor e marca `payment_status = paid`.
5. A página pública `/pedido/<public_token>` mostra o status (polling) e o lojista recebe e-mail.
6. O cliente acompanha o pedido na mesma página (recebido, em preparo, enviado, entregue) e fala com a loja pelo WhatsApp; se o Pix vencer, ele gera um novo ali mesmo (`action=create_pix` com `renew`).
7. No painel, o lojista vê o **pagamento** (Pago/Aguardando) e avança a **situação** (aceitar, enviar, confirmar entrega). Cancelar um pedido pago dispara o **estorno** na conta dele (`action=refund_payment`).
8. Retomada do cliente: se ele informar o e-mail no checkout, recebe o link do pedido (`action=order_notify` / `create_pix`); e a vitrine guarda os pedidos recentes no aparelho, com o atalho **Meus pedidos recentes**.

### Testar

1. Rode `supabase/up_seller_payments.sql`, `supabase/up_order_notify.sql` e `supabase/up_edge_api.sql`.
2. Deploy da Edge Function `api` e configure os secrets (incluindo `MP_CLIENT_SECRET` e `RESEND_API_KEY`).
3. Força uma loja de teste para o plano: `update stores set plan='pro' where id='<id>';`
4. No painel, conecte a **sua** conta MP, monte um pedido na vitrine, gere o Pix e pague (valor mínimo). Confira o pedido virando "pago" e o e-mail.
5. Pix no sandbox é limitado: o caminho confiável é testar em produção com valor baixo.

## Notificações push (PWA) do lojista

Avisa o lojista no navegador (mesmo com o painel fechado) quando um pedido é pago. É grátis e não depende de WhatsApp. A chave pública VAPID vai no front (`VITE_VAPID_PUBLIC_KEY`); a privada fica só na Edge Function.

### 1. Banco

Rode `supabase/up_push.sql` (tabela `push_subscriptions` + RLS por dono).

### 2. Edge Function (envio)

A função `supabase/functions/push-notify` faz o envio com a lib `web-push`.

```bash
# Gere um par de chaves VAPID (guarde a privada só no Supabase)
npx web-push generate-vapid-keys

# Deploy (sem verificação de JWT — protegida por x-push-secret)
supabase functions deploy push-notify --no-verify-jwt

# Secrets
supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:seu@email.com
supabase secrets set PUSH_SECRET=<um-segredo-forte>
```

Também dá para criar/editar a função pelo painel do Supabase (Edge Functions), desligando "Enforce JWT".

### 3. Front

`VITE_VAPID_PUBLIC_KEY` = a chave **pública** (em `.env` e `.env.production`). O botão **Ativar alertas** fica no painel, aba **Plano**.

### 4. Backend

A própria Edge Function `api` chama a `push-notify` (server-to-server) quando um pedido é pago, usando os secrets `PUSH_FUNCTION_URL` (URL da Edge Function) e `PUSH_SECRET` (o mesmo do passo 2). Não há mais Apps Script no caminho.

### Observações

- **iPhone**: só funciona se o lojista adicionar o VitrineZap à tela de início (iOS 16.4+). No Android e no desktop funciona direto.
- No checkout do PWA, a permissão é por aparelho; ative em cada um que quiser receber.
- Se parar de chegar, desative e ative de novo no painel.

## Legal, suporte e marca

Antes de vender, preencha os dados da empresa e do suporte (variáveis públicas, vão para o bundle):

- `VITE_COMPANY_NAME` — nome que aparece no rodapé e nos Termos.
- `VITE_COMPANY_DOC` — CNPJ ou CPF (vazio esconde).
- `VITE_COMPANY_CITY` — cidade/UF.
- `VITE_SUPPORT_EMAIL` — e-mail de suporte (rodapé e páginas legais).
- `VITE_SUPPORT_WHATSAPP` — só dígitos com DDI (ex.: `5511999999999`); vazio esconde o botão.

O que já existe no app:

- Páginas **`/termos`** e **`/privacidade`** (rotas dedicadas, com rodapé).
- Rodapé compartilhado com links de produto, legal e suporte.
- No cadastro, é obrigatório marcar o aceite dos Termos e da Política; o aceite é gravado nos metadados do usuário (`terms_accepted_at`, `terms_version`).
- Slugs `termos`, `privacidade`, `suporte` e `contato` ficam reservados (não podem virar nome de loja).

Importante: os textos legais são modelos e **não substituem a revisão de um advogado**. Ajuste
conforme o seu tipo de empresa (MEI, LTDA, pessoa física) e sua operação real. Ao revisar, atualize
`TERMS_VERSION` em `src/lib/site.js`.

## Confirmação de e-mail e exclusão de conta (LGPD)

### Confirmação de e-mail

Com **Confirm email** ligado no Supabase, o cadastro mostra a tela "Confirme seu e-mail" e o usuário só
entra depois de clicar no link. O front reenvia o link (`supabase.auth.resend`, tipo `signup`).

- Templates em PT-BR: `supabase/email-templates/` (confirm signup, reset password, magic link, change
  email, invite). Cole cada um no Dashboard > Authentication > Email Templates.
- Para produção, configure um **SMTP próprio** (Resend, Brevo, SendGrid, SES) com SPF/DKIM — o SMTP
  padrão do Supabase tem limite baixo e cai em spam. Detalhes no README da pasta.

### Exclusão de conta

No painel, aba **Plano**, o lojista pode excluir a conta e os dados definitivamente:

1. O cliente apaga as fotos do usuário no Supabase Storage (`deleteAllMyPhotos` em `src/lib/upload.js`).
2. Chama a Edge Function com `action=delete_account`, que valida o dono (JWT) e remove o **usuário de auth** via
   Admin API. As chaves estrangeiras usam `ON DELETE CASCADE` (`auth.users → stores → products/orders/
   store_payments/push_subscriptions`), então o banco fica limpo.
3. A sessão é encerrada e o usuário volta para a home.

O botão pede confirmação dupla (aviso + digitar `EXCLUIR`). A Política de Privacidade documenta o fluxo
(seção 7).

## OG e SEO das vitrines

Como o app é uma SPA, robôs do WhatsApp/Google não executam JavaScript e só veriam um preview
genérico. Para resolver, o build **pré-renderiza uma página por loja** com Open Graph, Twitter Card,
canonical, JSON-LD, além de `sitemap.xml` e `robots.txt`.

- Script: `scripts/prerender-og.mjs` (roda no `npm run build:pages`, após o `vite build`).
- Ele lê as lojas públicas do Supabase (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) e gera
  `dist/<slug>/index.html` com as meta tags da loja (nome, bio, imagem).
- Imagem usada: avatar da loja, capa, ou a foto do primeiro produto; se não houver, o ícone do app.
- `VITE_SITE_URL` (sem barra final) define canonical/sitemap/OG absolutos. Ex.: `https://wolfsistemas.github.io/app`.
- No CI, o workflow roda a cada push **e todo dia às 06:17 UTC** (cron), para atualizar lojas novas.

Testar localmente:

```bash
GITHUB_PAGES=true npm run build:pages
```

Observação: a página OG de uma loja nova só aparece depois do próximo build (push) ou do cron diário,
porque não há servidor para gerar em tempo real. Quando houver domínio, basta ajustar `VITE_SITE_URL`
(e a `base` do `vite.config.js` se o app sair de `/app/`).

## GitHub Pages

O site publica em `https://wolfsistemas.github.io/app/` a cada push na `main`.

1. Repo **Settings > Pages**: Source = **Deploy from a branch**, branch `gh-pages`, pasta `/ (root)`.
2. Rode os SQLs listados acima (bucket de fotos incluso).
3. Coloque o logo em `public/logo.png`. Sem o arquivo, o app usa a letra "V" como fallback.

## Estrutura

```text
src/pages        landing, auth, painel, vitrine pública
src/lib          supabase, api, billing, payments, delivery, upload, whatsapp, auth
src/components   foto, analytics
supabase/        schema SQL + RLS + migrações
supabase/functions/api         backend único (router: cobrança, Pix, webhooks, upload, conta)
supabase/functions/push-notify envio de push (VAPID)
gas/             legado (Apps Script) — mantido só como referência da migração
public/          manifest PWA, service worker e ícones
```

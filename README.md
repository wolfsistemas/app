# VitrineZap

SaaS de **bio link + catálogo** para quem vende no WhatsApp.

O cliente abre o link da bio, escolhe as peças e o pedido cai formatado no zap do lojista.

## Stack (sem backend ligado 24h)

- Front estático (Vite + React) no GitHub Pages / Cloudflare Pages
- Auth, Postgres e Realtime no **Supabase**
- Pagamento e webhook de plano: **InfinitePay** ou **Mercado Pago** (troca por property no GAS) + **Google Apps Script**
- PWA instalável + analytics leve (Umami)

Sem VPS. O browser fala direto com o Supabase.

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

## Como rodar

```bash
npm install
npm run dev
```

Sem `.env`, o app usa **modo local** (dados no navegador + loja demo).

## Ligar o Supabase

1. Crie um projeto no Supabase.
2. No SQL Editor, rode nesta ordem: `supabase/schema.sql`, `supabase/rls.sql`, `supabase/storage.sql`.
3. Se já existiam tabelas, rode também a migração `supabase/up_orders_v2.sql` (código do pedido, telefone do cliente, expiração de plano e realtime). Para assinatura recorrente (Mercado Pago), rode também `supabase/up_subscriptions.sql` e `supabase/up_mp_plans.sql`. Para o Pix na conta do vendedor (OAuth), rode `supabase/up_seller_payments.sql`.
4. Em Authentication > Providers, deixe e-mail/senha ligado. Para testar rápido, desligue **Confirm email**.
5. Em Authentication > URL configuration: Site URL e Redirect URLs apontando para o endereço do app (`https://wolfsistemas.github.io/app/**`).
6. Copie `.env.example` para `.env` e preencha URL + anon key.

## Fotos

O upload nunca expõe a chave no front:

1. **Dev**: Vite envia para `/api/upload` (proxy) e a chave ImgBB fica no `.env` local.
2. **Produção com `VITE_UPLOAD_URL`**: envia para o Apps Script (`gas/upload.js`). A chave fica no Script Properties; o token `VITE_UPLOAD_TOKEN` (mesmo valor da propriedade `UPLOAD_TOKEN` do GAS) trava o endpoint.
3. **Sem `VITE_UPLOAD_URL`**: o usuário logado envia para o bucket público **`fotos`** do Supabase Storage (fallback).

Álbum: a API do ImgBB **não coloca a foto num álbum**. Dá para organizar depois no site (ibb.co), mas não no upload.

## Assinatura (Plano Loja)

1. O painel mostra o botão de assinar quando `VITE_BILLING_URL` aponta para o GAS (`gas/all-in-one.js`).
2. O GAS cria o link de pagamento e devolve a URL do checkout — o valor fica fixo em R$ 9,90/30 dias, com `order_nsu` no formato `store_id:timestamp` para o webhook identificar a loja.
3. Na confirmação, o provedor chama o webhook (a própria URL do GAS), que marca `plan = pro` com `plan_expires_at = agora + 30 dias` e confirma lendo a loja de volta.
4. Sem `VITE_BILLING_URL`, o painel oferece apenas um botão de demonstração (sem cobrança).

### Trocar o provedor (sem mexer no app)

No GAS, mude a property `PAYMENT_PROVIDER` (e crie nova versão do deploy):

- `infinitepay` (padrão) — usa `INFINITEPAY_HANDLE` (sua InfiniteTag, ex.: `maiconvss`, sem o `$`)
- `mp` — usa `MP_ACCESS_TOKEN` (Access Token do Mercado Pago); opcional `MP_USE_SANDBOX=true` para testar em sandbox

### Assinatura recorrente no cartão (Mercado Pago) — modelo HOSPEDADO com plano

Com o provedor em `mp`, o painel oferece **"Assinar · R$ 9,90/mês"**: cobrança mensal automática, sem fidelidade (cancele quando quiser). Usamos o modelo **"com plano associado"**: o GAS cria um `preapproval_plan` por loja e redireciona para a **página do Mercado Pago** (`init_point`), onde o comprador paga a 1ª cobrança. Isso destrava o sandbox: o MP não exige pareamento comprador/cobrador no servidor e dá para testar com usuário/cartão de teste sem gastar.

Passos:

1. **GAS**: cole o novo `gas/all-in-one.js`, publique "Nova versão" e defina `PAYMENT_PROVIDER=mp` + `MP_ACCESS_TOKEN`.
2. **Supabase**: rode `supabase/up_subscriptions.sql` e depois `supabase/up_mp_plans.sql` (adicionam `mp_subscription_id`, `mp_subscription_status` e `mp_plan_id` na `stores`).
3. **Front**: basta `VITE_BILLING_URL` apontando para o GAS. **Não existe mais `VITE_MP_PUBLIC_KEY`** (não usamos Brick/tokenização no front — o checkout é a página hospedada do MP, e a chave pública ficou sem uso e foi removida dos `.env`).

Para testar **sem pagar** (sandbox): defina `MP_USE_SANDBOX=true` no GAS com um `MP_ACCESS_TOKEN` **TEST-...** e abra o link de assinatura; entre na conta do **usuário de teste** que aparece na própria tela de credenciais do MP (bloco "Dados das credenciais de teste" — usuário `TESTUSER...` + senha) e pague com **cartão de teste**. Em produção use `MP_ACCESS_TOKEN` **APP_USR-...** (sem `MP_USE_SANDBOX`).

Como funciona:

- O front pede "assinar" e o GAS cria/pega o plano da loja (`POST /preapproval_plan`, **sem** `card_token_id`/`payer_email`) e devolve o `init_point`.
- O comprador paga a 1ª cobrança na página do Mercado Pago. Quando o MP cria a assinatura, o webhook `subscription_preapproval` (status `authorized`) ativa o plano +30 dias e grava o vínculo loja <-> assinatura via `preapproval_plan_id` ↔ `mp_plan_id`.
- A cada mensalidade paga, `subscription_authorized_payment`/`payment` renova `plan_expires_at` por +30 dias. Eventos de assinatura cancelada/pausada só atualizam o status — **o acesso continua até a data já paga**.
- No painel, quem assinou vê "Cancelar assinatura recorrente" (PUT `/preapproval/{id}`).

Observação: recorrência automática exige **cartão** (a 1ª cobrança pode ser no cartão; Pix avulso continua como alternativa de 30 dias).

Properties comuns: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `EMAIL_LOG` (padrão: wolfsaasbr@gmail.com).

## Recebimento Pix na conta do vendedor (A1, sem custódia)

O **Plano Loja** conecta a conta do Mercado Pago do lojista via **OAuth**. A partir daí, o Pix do pedido é criado **na conta do vendedor** (o dinheiro nunca passa pelo VitrineZap) e o pedido é confirmado **automaticamente** pelo webhook. O plano grátis continua só com a chave PIX manual.

### Configurar o app no Mercado Pago

No painel de developers, na aplicação:

- Tipo de solução: **Pagamentos online**
- Plataforma de e-commerce: **Não**
- Produto: **Checkout Transparente > API Pagamentos**
- Redirect URL: a URL `/exec` do GAS (a mesma de `MP_REDIRECT_URI`)
- PKCE: **Não**
- Permissões: **read + write + offline access**

### Script Properties no GAS

`MP_CLIENT_ID`, `MP_CLIENT_SECRET` (segredo — só aqui), `MP_REDIRECT_URI` (a mesma URL cadastrada). O `MP_ACCESS_TOKEN` continua sendo o seu token (assinatura do plano); o token do vendedor fica no banco (`store_payments`, privada, só `service_role`).

### Fluxo

1. Lojista clica em **Conectar Mercado Pago** no painel (`action=mp_connect`) e autoriza no MP.
2. O GAS troca o `code` pelo `access_token` do vendedor (`doGet` com `?code&state`), grava em `store_payments` e marca `stores.mp_connected`.
3. No checkout, `action=create_pix` cria o Pix com o token do vendedor e guarda o QR/copia-e-cola no pedido.
4. O MP chama o webhook (`payment`); o GAS identifica a loja pelo `body.user_id`, re-busca o pagamento com o token do vendedor e marca `payment_status = paid`.
5. A página pública `/pedido/<public_token>` mostra o status (polling) e o lojista recebe e-mail.
6. O cliente acompanha o pedido na mesma página (recebido, em preparo, enviado, entregue) e fala com a loja pelo WhatsApp; se o Pix vencer, ele gera um novo ali mesmo (`action=create_pix` com `renew`).
7. No painel, o lojista vê o **pagamento** (Pago/Aguardando) e avança a **situação** (aceitar, enviar, confirmar entrega). Cancelar um pedido pago dispara o **estorno** na conta dele (`action=refund_payment`).

### Testar

1. Rode `supabase/up_seller_payments.sql`.
2. Preencha as properties no GAS e publique **"Nova versão"** (mesmo deploy).
3. Força uma loja de teste para o plano: `update stores set plan='pro' where id='<id>';`
4. No painel, conecte a **sua** conta MP, monte um pedido na vitrine, gere o Pix e pague (valor mínimo). Confira o pedido virando "pago" e o e-mail.
5. Pix no sandbox é limitado: o caminho confiável é testar em produção com valor baixo.

## GitHub Pages

O site publica em `https://wolfsistemas.github.io/app/` a cada push na `main`.

1. Repo **Settings > Pages**: Source = **Deploy from a branch**, branch `gh-pages`, pasta `/ (root)`.
2. Rode os SQLs listados acima (bucket de fotos incluso).
3. Coloque o logo em `public/logo.png`. Sem o arquivo, o app usa a letra "V" como fallback.

## Estrutura

```text
src/pages        landing, auth, painel, vitrine pública
src/lib          supabase, billing, upload, whatsapp, auth
src/components   foto, analytics
supabase/        schema SQL + RLS + migração de pedidos
gas/             upload ImgBB e webhook de cobrança
public/          manifest PWA, service worker e ícones
```

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
- Checkout avulso via link (InfinitePay / Mercado Pago) + **assinatura recorrente no cartão (Mercado Pago, cancele quando quiser)**

## Como rodar

```bash
npm install
npm run dev
```

Sem `.env`, o app usa **modo local** (dados no navegador + loja demo).

## Ligar o Supabase

1. Crie um projeto no Supabase.
2. No SQL Editor, rode nesta ordem: `supabase/schema.sql`, `supabase/rls.sql`, `supabase/storage.sql`.
3. Se já existiam tabelas, rode também a migração `supabase/up_orders_v2.sql` (código do pedido, telefone do cliente, expiração de plano e realtime). Para assinatura recorrente (Mercado Pago), rode também `supabase/up_subscriptions.sql`.
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

### Assinatura recorrente no cartão (Mercado Pago)

Com o provedor em `mp`, o painel oferece **"Assinar com cartão · R$ 9,90/mês"**: cobrança mensal automática, sem fidelidade (cancele quando quiser). Passos:

1. **GAS**: cole o novo `gas/all-in-one.js`, publique "Nova versão" e defina `PAYMENT_PROVIDER=mp` + `MP_ACCESS_TOKEN`.
2. **Supabase**: rode `supabase/up_subscriptions.sql` (adiciona `mp_subscription_id` e `mp_subscription_status` na `stores`).
3. **Front**: preencha `VITE_MP_PUBLIC_KEY` (chave **pública** do Mercado Pago, de Suas integrações > sua aplicação) no `.env.production` e faça o build/CI. Sem essa chave, o botão de assinatura fica oculto e só aparece o pagamento avulso.

Como funciona:

- O front abre um modal com o **CardPayment Brick** (cartão nunca passa pelo seu servidor; o Mercado Pago tokeniza).
- O GAS cria um `preapproval` (status `authorized`) com cobrança mensal de R$ 9,90. O plano é ativado na criação (cartão já validado pelo MP).
- A cada mensalidade paga, o webhook renova `plan_expires_at` por +30 dias. Eventos de `preapproval` (cancelado/pausado) só atualizam o status — **o acesso continua até a data já paga**.
- No painel, quem assinou vê "Cancelar assinatura recorrente" (PUT `/preapproval/{id}`).

Observação: recorrência automática exige **cartão**. O pagamento avulso via link (Pix/cartão) continua disponível como alternativa.

Properties comuns: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `EMAIL_LOG` (padrão: wolfsaasbr@gmail.com).

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

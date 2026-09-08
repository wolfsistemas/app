# VitrineZap

SaaS de **bio link + catálogo** para quem vende no WhatsApp.

O cliente abre o link da bio, escolhe as peças e o pedido cai formatado no zap do lojista.

## Stack (sem backend ligado 24h)

- Front estático (Vite + React) no GitHub Pages / Cloudflare Pages
- Auth, Postgres e Realtime no **Supabase**
- Pagamento e webhook de plano: **InfinitePay** + **Google Apps Script**
- PWA instalável + analytics leve (Umami)

Sem VPS. O browser fala direto com o Supabase.

## O que já está no MVP

- Landing e planos (grátis / Plano Loja R$ 19,90 por 30 dias)
- Cadastro, login e onboarding da loja
- Recuperação de senha por e-mail
- Vitrine pública por slug (`/ana-atelier` é a demo)
- Bio com botões (Instagram e links)
- Carrinho e pedido no WhatsApp com **código sequencial por loja**
- Painel: produtos, pedidos (tempo real com som), tema, PIX, plano
- Limite de 8 produtos no plano grátis
- Marca VitrineZap no rodapé do plano free (removida no Loja)
- Checkout InfinitePay + expiração de plano por webhook

## Como rodar

```bash
npm install
npm run dev
```

Sem `.env`, o app usa **modo local** (dados no navegador + loja demo).

## Ligar o Supabase

1. Crie um projeto no Supabase.
2. No SQL Editor, rode nesta ordem: `supabase/schema.sql`, `supabase/rls.sql`, `supabase/storage.sql`.
3. Se já existiam tabelas, rode também a migração `supabase/up_orders_v2.sql` (código do pedido, telefone do cliente, expiração de plano e realtime).
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

1. O painel mostra o botão de assinar quando `VITE_BILLING_URL` aponta para o GAS (`gas/billing-webhook.js`).
2. O GAS chama a InfinitePay (`POST /links`, autenticado pelo handle) e devolve a URL do checkout — o valor fica fixo em R$ 19,90/30 dias.
3. Na confirmação, o webhook da InfinitePay chama o mesmo GAS, que verifica a assinatura e marca `plan = pro` com `plan_expires_at = agora + 30 dias`.
4. Sem `VITE_BILLING_URL`, o painel oferece apenas um botão de demonstração (sem cobrança).

Properties do GAS de billing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `INFINITEPAY_HANDLE`, `INFINITEPAY_SECRET` (opcional).

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

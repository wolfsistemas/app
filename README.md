# VitrineZap

SaaS de **bio link + catálogo** para quem vende no WhatsApp.

O cliente abre o link da bio, escolhe as peças e o pedido cai formatado no zap do lojista.

## Stack (sem backend ligado 24h)

- Front estático (Vite + React) no GitHub Pages / Cloudflare Pages
- Auth, Postgres e Storage no **Supabase**
- Webhook de pagamento (opcional): **Supabase Edge Function** ou **Google Apps Script**

Sem VPS. O browser fala direto com o Supabase.

## O que já está no MVP

- Landing e planos (grátis / R$ 19,90)
- Cadastro, login e onboarding da loja
- Vitrine pública por slug (`/ana-atelier` é a demo)
- Bio com botões (Instagram e links)
- Carrinho e pedido no WhatsApp
- Painel: produtos, pedidos, tema, PIX
- Limite de 15 produtos no plano grátis
- Marca VitrineZap no rodapé do plano free

## Como rodar

```bash
npm install
npm run dev
```

Sem `.env`, o app usa **modo local** (dados no navegador + loja demo).

## Ligar o Supabase

1. Crie um projeto no Supabase.
2. Cole e rode `supabase/schema.sql` no SQL Editor.
3. Se a loja já existia e o INSERT falhou, rode também `supabase/rls.sql` (troca as policies).
4. Em Authentication > Providers, deixe e-mail/senha ligado. Para testar rápido, desligue **Confirm email**. Sem sessão JWT o RLS bloqueia o INSERT.
5. Copie `.env.example` para `.env` e preencha URL + anon key.

## Fotos (ImgBB)

A chave do ImgBB **não vai no front**. O browser manda a imagem compactada para `/api/upload` (dev) ou para o GAS (produção). Só o link entra no Postgres.

Álbum: a API do ImgBB **não coloca a foto num álbum**. Dá para organizar depois no site (ibb.co), mas não no upload.

Produção (GitHub Pages / Cloudflare):

1. Cole `gas/upload.js` num Apps Script.
2. Script properties: `IMGBB_API_KEY`.
3. Deploy como Web App (Anyone).
4. No `.env` de build:

```bash
VITE_UPLOAD_URL=https://script.google.com/macros/s/.../exec
```

## GitHub Pages

O site publica em `https://wolfsistemas.github.io/app/` a cada push na `main`.

1. Repo **Settings > Pages**: Source = **Deploy from a branch**, branch `gh-pages`, pasta `/ (root)`.
2. No Supabase: Authentication > URL configuration
   - Site URL: `https://wolfsistemas.github.io/app`
   - Redirect URLs: `https://wolfsistemas.github.io/app/**`
3. Rode `supabase/rls.sql` se ainda não rodou.
4. Foto por arquivo no Pages só funciona depois do GAS (`VITE_UPLOAD_URL`). Até lá, cole o link da imagem.

## Como vender

1. Lojista cria a vitrine grátis e cola o link na bio.
2. Cliente pede pelo catálogo.
3. No 16º produto (ou no botão Plano), sobe para R$ 19,90/mês.
4. Checkout (Mercado Pago/Stripe) chama o webhook em `gas/billing-webhook.js` ou uma Edge Function e marca `stores.plan = pro`.

## Estrutura

```text
src/pages        landing, auth, painel, vitrine pública
src/lib          supabase, localStorage, whatsapp, auth
supabase/        schema SQL + RLS
gas/             webhook opcional de pagamento
```

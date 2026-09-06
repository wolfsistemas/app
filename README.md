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
- Limite de 8 produtos no plano grátis
- Marca VitrineZap no rodapé do plano free (removida no Loja)

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

## Fotos

O upload é resolvido em três níveis, sempre sem chave no front:

1. **Dev**: Vite envia para `/api/upload` (proxy) e a chave ImgBB fica no `.env` local.
2. **`VITE_UPLOAD_URL`** definido no build: envia para um Apps Script (`gas/upload.js`), chave no Script Properties.
3. **Sem `VITE_UPLOAD_URL`** (padrão do GitHub Pages): o próprio usuário logado envia para o bucket público **`fotos`** do Supabase Storage.

Álbum: a API do ImgBB **não coloca a foto num álbum**. Dá para organizar depois no site (ibb.co), mas não no upload.

## GitHub Pages

O site publica em `https://wolfsistemas.github.io/app/` a cada push na `main`.

1. Repo **Settings > Pages**: Source = **Deploy from a branch**, branch `gh-pages`, pasta `/ (root)`.
2. No Supabase: Authentication > URL configuration
   - Site URL: `https://wolfsistemas.github.io/app`
   - Redirect URLs: `https://wolfsistemas.github.io/app/**`
3. No SQL Editor rode nesta ordem: `supabase/schema.sql`, `supabase/rls.sql` e `supabase/storage.sql` (cria o bucket de fotos). Se já rodou os dois primeiros, rode só o `storage.sql`.
4. Coloque o logo em `public/logo.png`. Sem o arquivo, o app usa a letra "V" como fallback (mantém a identidade sem quebrar o layout).

## Como vender

1. Lojista cria a vitrine grátis e cola o link na bio.
2. Cliente pede pelo catálogo.
3. No 9º produto (ou no botão Plano), sobe para R$ 19,90/mês.
4. Checkout (Mercado Pago/Stripe) chama o webhook em `gas/billing-webhook.js` ou uma Edge Function e marca `stores.plan = pro`.

## Estrutura

```text
src/pages        landing, auth, painel, vitrine pública
src/lib          supabase, localStorage, whatsapp, auth
supabase/        schema SQL + RLS
gas/             webhook opcional de pagamento
```

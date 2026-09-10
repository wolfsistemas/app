-- VitrineZap — Notificações push (PWA) para o lojista
-- Rode UMA vez no Supabase (SQL Editor). Aditivo; não apaga nada.
--
-- Guarda as assinaturas de push de cada aparelho do lojista. O envio é feito
-- pela Edge Function `push-notify` (service_role). O front só grava/apaga a
-- assinatura da própria loja.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text default '',
  created_at timestamptz default now()
);

create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

-- Dono da loja pode ver/criar/atualizar/apagar as assinaturas da própria loja.
drop policy if exists push_select_own on public.push_subscriptions;
create policy push_select_own
  on public.push_subscriptions for select
  to authenticated
  using (exists (
    select 1 from public.stores s
    where s.id = push_subscriptions.store_id and s.owner_id = auth.uid()
  ));

drop policy if exists push_insert_own on public.push_subscriptions;
create policy push_insert_own
  on public.push_subscriptions for insert
  to authenticated
  with check (exists (
    select 1 from public.stores s
    where s.id = push_subscriptions.store_id and s.owner_id = auth.uid()
  ));

drop policy if exists push_update_own on public.push_subscriptions;
create policy push_update_own
  on public.push_subscriptions for update
  to authenticated
  using (exists (
    select 1 from public.stores s
    where s.id = push_subscriptions.store_id and s.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.stores s
    where s.id = push_subscriptions.store_id and s.owner_id = auth.uid()
  ));

drop policy if exists push_delete_own on public.push_subscriptions;
create policy push_delete_own
  on public.push_subscriptions for delete
  to authenticated
  using (exists (
    select 1 from public.stores s
    where s.id = push_subscriptions.store_id and s.owner_id = auth.uid()
  ));

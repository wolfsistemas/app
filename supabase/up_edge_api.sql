-- Migração para a API em Edge Functions (substitui o GAS).
-- Rode no SQL Editor do Supabase.

-- Idempotência de webhooks: substitui a lista MP_PROCESSED do GAS.
-- Só o service_role acessa (bypassa RLS); nenhuma policy é criada.
create table if not exists public.processed_events (
  key text primary key,
  created_at timestamptz not null default now()
);

create index if not exists processed_events_created_at_idx
  on public.processed_events (created_at);

alter table public.processed_events enable row level security;

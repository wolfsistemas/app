-- Rode no SQL Editor. Cria o bucket público "fotos" e libera upload do próprio usuário.
-- Necessário para o GitHub Pages subir imagens sem GAS/ImgBB.

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos read public" on storage.objects;
create policy "fotos read public"
  on storage.objects for select
  using (bucket_id = 'fotos');

drop policy if exists "fotos insert own" on storage.objects;
create policy "fotos insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fotos'
    and coalesce((storage.foldername(name))[1], '') = (auth.uid())::text
  );

drop policy if exists "fotos update own" on storage.objects;
create policy "fotos update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'fotos'
    and coalesce((storage.foldername(name))[1], '') = (auth.uid())::text
  );

drop policy if exists "fotos delete own" on storage.objects;
create policy "fotos delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'fotos'
    and coalesce((storage.foldername(name))[1], '') = (auth.uid())::text
  );

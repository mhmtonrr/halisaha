-- Geri bildirim: Ayarlar > "Geri Bildirim Gönder". Kullanıcı sadece kendi adına ekler ve kendi gönderdiklerini okur;
-- tüm kayıtlar veritabanından (service role / panel) okunur.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  category text not null default 'genel' check (category in ('genel', 'hata', 'oneri')),
  message text not null check (char_length(btrim(message)) between 5 and 1000),
  created_at timestamptz not null default now()
);
create index on public.feedback (created_at desc);
alter table public.feedback enable row level security;
create policy "geri bildirim: kendi adına ekler" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());
create policy "geri bildirim: kendi gönderdiklerini okur" on public.feedback
  for select to authenticated using (user_id = auth.uid());

-- Profil tasarımı (Obsidian Pitch) için eksik alanlar. Sadece ekleme yapar.
--  * boy/kilo/müsait günler/dondurma: profiles'ta (kartta ve aramada herkese görünür, kişi kendi satırını düzenler)
--  * doğum tarihi: ÖZEL, ayrı tabloda (profiles giriş yapan herkese okunur); birth_year buradan eşitlenir
--  * engellenenler: sadece engelleyen görür

alter table public.profiles
  add column height_cm smallint check (height_cm between 120 and 230),
  add column weight_kg smallint check (weight_kg between 30 and 200),
  add column available_days smallint[] not null default '{}'
    check (available_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  add column frozen_at timestamptz;

-- Doğum tarihi (özel)
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  birth_date date check (birth_date >= date '1940-01-01')
);
alter table public.profile_private enable row level security;
create policy "özel bilgi: sadece kendisi okur" on public.profile_private
  for select to authenticated using (user_id = auth.uid());
create policy "özel bilgi: sadece kendisi ekler" on public.profile_private
  for insert to authenticated with check (user_id = auth.uid());
create policy "özel bilgi: sadece kendisi günceller" on public.profile_private
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.sync_birth_year() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set birth_year = case when new.birth_date is null then null else extract(year from new.birth_date)::smallint end
  where id = new.user_id
    and (new.birth_date is null or extract(year from new.birth_date) between 1940 and 2020);
  return null;
end $$;
create trigger profile_private_birth_year after insert or update of birth_date on public.profile_private
  for each row execute function public.sync_birth_year();

-- Engellenenler: oyuncu veya (herkese açık) takım
create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_user_id uuid references public.profiles (id) on delete cascade,
  blocked_group_id uuid references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((blocked_user_id is null) <> (blocked_group_id is null)),
  check (blocked_user_id is null or blocked_user_id <> blocker_id)
);
create unique index user_blocks_user_uq on public.user_blocks (blocker_id, blocked_user_id) where blocked_user_id is not null;
create unique index user_blocks_group_uq on public.user_blocks (blocker_id, blocked_group_id) where blocked_group_id is not null;
alter table public.user_blocks enable row level security;
create policy "engel: sadece engelleyen okur" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy "engel: sadece kendi adına ekler" on public.user_blocks
  for insert to authenticated with check (
    blocker_id = auth.uid()
    and (blocked_group_id is null or exists (select 1 from public.groups g where g.id = blocked_group_id and g.kind = 'team'))
  );
create policy "engel: sadece engelleyen kaldırır" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

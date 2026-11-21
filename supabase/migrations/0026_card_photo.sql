-- Kart fotoğrafı: arka planı tarayıcıda kaldırılmış şeffaf görsel, Storage'daki "avatars" deposunda.
-- Dosya yolu: <user_id>/<dosya>. Herkes okur (kart herkese görünür), sadece sahibi yazar/siler.
-- Tür (webp/png) ve boyut (en çok 512 KB) depo ayarıyla sunucuda doğrulanır.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars sahibi okur" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars sahibi yükler" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars sahibi değiştirir" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars sahibi siler" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Adres sadece kişinin kendi klasöründeki herkese açık dosyayı gösterebilir (başka siteye/kişiye işaret edemez).
create or replace function public.photo_url_ok(p text, uid uuid) returns boolean
language sql immutable as $$
  select p is null or (
    char_length(p) <= 300
    and p ~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/' || uid::text || '/[A-Za-z0-9._-]+(\?v=[0-9]+)?$')
  )
$$;

alter table public.profiles add column photo_url text check (public.photo_url_ok(photo_url, id));
-- group_players.photo_url profilin kopyasıdır (card_name gibi): eklemede doldurulur, profil değişince eşitlenir.
alter table public.group_players add column photo_url text;

create or replace function public.fill_player_photo_url() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    select photo_url into new.photo_url from profiles where id = new.user_id;
  else
    new.photo_url := null;
  end if;
  return new;
end $$;

create trigger group_players_photo_url before insert or update of user_id, photo_url on public.group_players
  for each row execute function public.fill_player_photo_url();

create or replace function public.sync_photo_url() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update group_players set photo_url = new.photo_url where user_id = new.id;
  return null;
end $$;

create trigger profiles_photo_url after update of photo_url on public.profiles
  for each row when (old.photo_url is distinct from new.photo_url)
  execute function public.sync_photo_url();

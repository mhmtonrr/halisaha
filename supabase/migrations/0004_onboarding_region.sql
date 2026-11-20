-- İlk girişte sorulan profil bilgileri: bölge (il/ilçe) ve doğum yılı.
-- Bölge, ileride bölgesel organizasyonlar ve halısaha keşfi için temel olacak.
-- Sadece ekleme yapar.

alter table public.profiles
  add column city text check (char_length(city) between 2 and 40),
  add column district text check (char_length(district) between 2 and 40),
  add column birth_year smallint check (birth_year between 1940 and 2020),
  add column onboarded_at timestamptz;

create index on public.profiles (city, district);

-- Parametre listesi değiştiği için eski fonksiyonu kaldırıp yenisini oluşturuyoruz.
-- Yeni parametrelerin varsayılan değeri olduğu için eski istemci çağrıları da çalışır.
drop function public.update_my_profile(text, text, text[], text, integer, text);

create function public.update_my_profile(
  p_display_name text,
  p_position text,
  p_secondary text[],
  p_foot text,
  p_shirt integer,
  p_bio text,
  p_city text default null,
  p_district text default null,
  p_birth_year integer default null,
  p_complete_onboarding boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(p_display_name);
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'İsim 2-40 karakter olmalı';
  end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then
    raise exception 'Geçersiz mevki';
  end if;
  if p_complete_onboarding and (nullif(btrim(p_city), '') is null) then
    raise exception 'İl seçmelisiniz';
  end if;

  update profiles
     set display_name = v_name,
         preferred_position = p_position,
         secondary_positions = coalesce(
           array(select distinct x from unnest(p_secondary) x
                 where x is distinct from p_position), '{}'),
         preferred_foot = p_foot,
         shirt_number = p_shirt,
         bio = nullif(btrim(p_bio), ''),
         -- Bölge alanları gönderilmediyse (eski istemci) mevcut değer korunur
         city = coalesce(nullif(btrim(p_city), ''), city),
         district = case when p_city is null then district else nullif(btrim(p_district), '') end,
         birth_year = case when p_city is null then birth_year else p_birth_year end,
         onboarded_at = case when p_complete_onboarding then coalesce(onboarded_at, now()) else onboarded_at end
   where id = auth.uid();

  update group_players
     set display_name = v_name,
         position = p_position
   where user_id = auth.uid();
end;
$$;

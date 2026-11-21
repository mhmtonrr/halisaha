-- Oyuncu aramasında görünme: varsayılan açık (kullanıcı kararı), Ayarlar'dan kapatılabilir.
-- Kapalıysa kişi Keşfet oyuncu aramasında ve ana sayfadaki "öne çıkanlar"da listelenmez;
-- profil bağlantısı (/oyuncu/ID) ve takım kadrosundaki görünürlüğü etkilenmez.
alter table public.profiles
  add column discoverable boolean not null default true;

create index profiles_city_idx on public.profiles (city) where discoverable;

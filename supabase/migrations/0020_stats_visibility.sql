-- Oyuncunun istatistik ve maç geçmişini kimin görebileceği: 'teammates' (varsayılan: en az bir ortak grup/takımı
-- olanlar) veya 'public' (giriş yapmış herkes). Kart (rating, yetenekler, bölge) her zaman görünür; sadece
-- istatistik ve maç geçmişi bu ayara bağlıdır. Kullanıcı kendi satırını mevcut "kendi profilini düzenle" politikasıyla günceller.
alter table public.profiles
  add column stats_visibility text not null default 'teammates'
  check (stats_visibility in ('teammates', 'public'));

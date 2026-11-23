-- Davet/maç kartlı grup silinemiyordu (inceleme 2026-11-23):
-- grup silinince group_invites/match_polls/matches basamaklı silinir, dm_messages'taki
-- invite_id/poll_id/match_id "on delete set null" ile boşalır, ama shape kısıtı bu alanları
-- zorunlu tutuyordu → delete_group, disband_team ve geçici takım temizliği hata veriyordu.
-- Kısıt artık bağlantısı kopmuş kartı kabul eder; mesaj geçmişte kalır, arayüz "artık geçerli değil" gösterir.
-- Kartlar yalnızca RPC'lerle eklenir (doğrudan insert yetkisi yok), RPC'ler bağlantıyı hep doldurur.
alter table public.dm_messages drop constraint dm_messages_shape_check;
alter table public.dm_messages
  add constraint dm_messages_shape_check check (
    kind in ('text', 'invite')
    or (kind = 'match' and card is not null)
  );

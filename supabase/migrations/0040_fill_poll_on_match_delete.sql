-- "Adam ara" çağrısı açılmış maç silinemiyordu: match_polls.match_id "on delete set null" ile boşalıyor,
-- ama match_polls_fill_shape adam aramada match_id istiyor → maç silme/teklif iptali hata veriyordu.
-- Adam arama maçsız anlamsız: maç silinmeden önce ona bağlı adam arama çağrıları silinir
-- (yanıtlar basamaklı gider; sohbetteki kartlar 0039 ile "artık yok" olarak kalır).
-- Çağrı başka bir grupta (toplulukta) olabilir; silen kişinin oradaki yetkisine bakılmaz → security definer.
create function public.delete_fill_polls_of_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from match_polls where match_id = old.id and purpose = 'fill';
  return old;
end;
$$;
revoke all on function public.delete_fill_polls_of_match() from public, anon, authenticated;

create trigger matches_delete_fill_polls
  before delete on public.matches
  for each row execute function public.delete_fill_polls_of_match();

-- Kadrodaki oyuncunun daveti (onay bekleyen, source = 'invite') reddedilirse davet edilen engellenmez (kullanıcı kararı
-- 2026-11-27): yalnızca davet düşer (kart iptal olur), kişi ilan/bağlantıyla kendisi başvurabilir.
-- Kendi başvurusu reddedilen kişi için 'rejected' (engel) aynen sürer.
create or replace function public.decide_application(p_match uuid, p_user uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Başvurulara sadece maçı yönetenler karar verir'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  select * into v_e from match_entries where match_id = p_match and user_id = p_user;
  if v_e.status is distinct from 'pending' then raise exception 'Bekleyen başvuru bulunamadı'; end if;
  if not p_accept then
    if v_e.source = 'invite' then
      delete from match_entries where id = v_e.id;
    else
      update match_entries set status = 'rejected', updated_at = now() where id = v_e.id;
    end if;
    return 'rejected';
  end if;
  if public.match_roster_count(p_match) < v_m.capacity then
    perform public.put_in_roster(v_m, p_user, v_e.position);
    update match_entries set added_by = auth.uid(), queued_at = null, updated_at = now() where id = v_e.id;
    return 'in';
  end if;
  update match_entries set status = 'reserve', queued_at = now(), added_by = auth.uid(), updated_at = now() where id = v_e.id;
  return 'reserve';
end;
$$;

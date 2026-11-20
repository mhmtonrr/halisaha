-- Oyuncu kendi mevkisini, yönetici herkesinkini değiştirebilir.
-- group_players üzerinde üyelere genel update izni vermiyoruz (rolünü admin yapabilirdi).
create function public.set_player_position(p_player_id uuid, p_position text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player group_players;
begin
  select * into v_player from group_players where id = p_player_id;
  if v_player is null then
    raise exception 'Oyuncu bulunamadı';
  end if;
  if v_player.user_id is distinct from auth.uid() and not public.is_group_admin(v_player.group_id) then
    raise exception 'Sadece kendi mevkinizi değiştirebilirsiniz';
  end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then
    raise exception 'Geçersiz mevki';
  end if;
  update group_players set position = p_position where id = p_player_id;
end;
$$;

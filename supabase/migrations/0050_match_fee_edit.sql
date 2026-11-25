-- Saha ücretini sonradan değiştirme; davet bağlantısında ücret ve onay bekleyen rakip. Eski kodla uyumlu.

create function public.set_match_fee(p_match uuid, p_fee integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Saha ücretini sadece maçı yöneten değiştirir'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın ücreti artık değiştirilemez'; end if;
  if p_fee is not null and p_fee not between 1 and 100000 then raise exception 'Saha ücreti 1 ile 100000 TL arasında olmalı'; end if;
  update matches set fee_per_person = p_fee where id = p_match;
  -- Bekleyen teklifteki ücret notu da güncel kalsın
  update match_challenges set fee_note = case when p_fee is not null then 'Kişi başı ' || p_fee || ' TL' end
   where from_match_id = p_match and status = 'pending';
end;
$$;
revoke all on function public.set_match_fee(uuid, integer) from public, anon;
grant execute on function public.set_match_fee(uuid, integer) to authenticated;

create or replace function public.match_by_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_m matches;
  v_g groups;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select m.* into v_m from match_codes c join matches m on m.id = c.match_id where c.code = public.norm_invite(p_code);
  if v_m.id is null then return null; end if;
  select * into v_g from groups where id = v_m.group_id;
  return jsonb_build_object(
    'match_id', v_m.id, 'group_id', v_g.id, 'group_name', v_g.name, 'group_kind', v_g.kind, 'group_color', v_g.color,
    'city', v_g.city, 'district', v_g.district, 'status', v_m.status::text, 'kind', v_m.kind,
    'played_at', v_m.played_at, 'time_tbd', v_m.time_tbd, 'venue', v_m.venue, 'team_size', v_m.team_size,
    'capacity', v_m.capacity, 'roster_count', v_m.roster_count, 'reserve_count', v_m.reserve_count,
    'opponent_name', v_m.opponent_name, 'note', v_m.note,
    'fee_per_person', v_m.fee_per_person,
    'pending_rival', (select g2.name from match_challenges c join groups g2 on g2.id = c.to_group_id where c.from_match_id = v_m.id and c.status = 'pending' limit 1),
    'my_status', (select status from match_entries where match_id = v_m.id and user_id = auth.uid()),
    'is_member', public.is_group_member(v_g.id),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', gp.display_name, 'position', coalesce(mp.position, gp.position), 'guest', gp.user_id is null,
               'overall', ur.overall, 'photo_url', gp.photo_url) order by gp.display_name)
        from match_players mp join group_players gp on gp.id = mp.player_id
        left join user_ratings ur on ur.user_id = gp.user_id
       where mp.match_id = v_m.id), '[]'::jsonb));
end;
$$;

-- Bekleyen başvuran / katılma isteği gönderen kişiyi karar verecek olan inceleyebilsin.

-- Ben, p_user'ın onay bekleyen başvurusuna (maç) veya katılma isteğine (takım/grup) karar verebiliyor muyum?
-- Başvuru karara bağlanınca, geri çekilince veya maç kapanınca kendiliğinden false olur.
create or replace function public.is_my_applicant(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_entries e join matches m on m.id = e.match_id
     where e.user_id = p_user and e.status = 'pending' and m.status::text in ('gathering', 'planned')
       and public.can_manage_match(m.id)
  ) or exists (
    select 1 from group_join_requests r
     where r.user_id = p_user and r.status = 'pending' and public.is_group_admin(r.group_id)
  )
$$;

revoke all on function public.is_my_applicant(uuid) from public, anon;
grant execute on function public.is_my_applicant(uuid) to authenticated;

-- 0044'teki tanım; tek fark: katılma isteklerine genel puan (overall) ve mevki (position)
create or replace function public.pending_requests(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := public.is_group_admin(p_group);
  v_creator boolean := public.can_create_match(p_group);
begin
  if not (v_admin or v_creator) then raise exception 'Bekleyen istekleri sadece yetkililer görür'; end if;
  return jsonb_build_object(
    'joins', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'name', p.display_name, 'photo_url', p.photo_url,
                                          'city', p.city, 'district', p.district, 'message', r.message, 'created_at', r.created_at,
                                          'overall', ur.overall, 'position', p.preferred_position)
                       order by r.created_at)
        from group_join_requests r join profiles p on p.id = r.user_id
        left join user_ratings ur on ur.user_id = r.user_id
       where r.group_id = p_group and r.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
    'listings', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'match_id', l.match_id, 'group_id', g.id, 'group_name', g.name,
                                          'played_at', m.played_at, 'time_tbd', m.time_tbd, 'venue', m.venue,
                                          'capacity', m.capacity, 'roster_count', m.roster_count, 'positions', l.positions,
                                          'note', l.note, 'by', pr.display_name, 'created_at', l.created_at)
                       order by l.created_at)
        from match_listings l join matches m on m.id = l.match_id join groups g on g.id = m.group_id
        left join profiles pr on pr.id = l.created_by
       where l.target_group_id = p_group and l.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
    'proposals', case when v_creator then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'by', pr.display_name, 'play_on', x.play_on, 'starts_at', x.starts_at,
                                          'venue', x.venue, 'note', x.note, 'created_at', x.created_at)
                       order by x.created_at)
        from match_proposals x left join profiles pr on pr.id = x.proposed_by
       where x.group_id = p_group and x.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object('match_id', e.match_id, 'user_id', e.user_id, 'name', p.display_name,
                                          'photo_url', p.photo_url, 'source', e.source, 'position', e.position, 'note', e.note,
                                          'played_at', m.played_at, 'time_tbd', m.time_tbd, 'created_at', e.updated_at)
                       order by e.updated_at)
        from match_entries e join matches m on m.id = e.match_id join profiles p on p.id = e.user_id
       where m.group_id = p_group and e.status = 'pending' and m.status::text in ('gathering', 'planned')
         and public.can_manage_match(m.id)), '[]'::jsonb)
  );
end;
$$;

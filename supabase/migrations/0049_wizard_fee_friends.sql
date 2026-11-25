-- Maç ayarla sihirbazı: saha ücreti (kişi başı), takım dışı arkadaşı doğrudan kadroya yazma, bekleyen rakibin görünmesi.
-- Eski kodla uyumlu: create_match_v2 yeni parametresi varsayılanlı.

alter table public.matches
  add column fee_per_person integer check (fee_per_person between 1 and 100000);

drop function public.create_match_v2(uuid, date, time, smallint, text, text, text, text, smallint, boolean, uuid[], jsonb, boolean);

create function public.create_match_v2(
  p_group uuid, p_day date, p_time time, p_team_size smallint, p_kind text,
  p_opponent text default null, p_venue text default null, p_note text default null, p_capacity smallint default null,
  p_with_me boolean default true, p_confirmed uuid[] default '{}', p_guests jsonb default '[]', p_announce boolean default true,
  p_fee integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_kind text := public.group_kind(p_group);
  v_when timestamptz;
  v_cap smallint;
  v_id uuid;
  v_m matches;
  v_u uuid;
  v_g jsonb;
  v_gp uuid;
  v_pos text;
  v_count integer;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  if not public.can_create_match(p_group) then raise exception 'Bu grupta maç ayarlama yetkin yok'; end if;
  if p_kind = 'internal' and v_kind <> 'community' then
    raise exception 'Takım sadece rakibe karşı oynar';
  elsif p_kind = 'external' and v_kind <> 'team' then
    raise exception 'Grupta maç kendi aramızda oynanır; rakibe karşı oynamak için takım kur';
  elsif p_kind not in ('internal', 'external') then
    raise exception 'Geçersiz maç türü';
  end if;
  if p_team_size is null or p_team_size not between 5 and 11 then raise exception 'Kişi sayısı 5 ile 11 arasında olmalı'; end if;
  if p_day is null or p_day < public.istanbul_today() then raise exception 'Maç günü bugün veya sonrası olmalı'; end if;
  v_when := case when p_time is null then (p_day + time '12:00') at time zone 'Europe/Istanbul'
                 else (p_day + p_time) at time zone 'Europe/Istanbul' end;
  if p_time is not null and v_when <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  v_cap := coalesce(p_capacity, case when p_kind = 'internal' then p_team_size * 2 else p_team_size end);
  if v_cap not between 2 and 30 then raise exception 'Kadro 2 ile 30 kişi arasında olmalı'; end if;
  if p_kind = 'external' and p_opponent is not null and char_length(btrim(p_opponent)) = 1 then
    raise exception 'Rakip adı en az 2 karakter olmalı';
  end if;
  if p_fee is not null and p_fee not between 1 and 100000 then raise exception 'Saha ücreti 1 ile 100000 TL arasında olmalı'; end if;
  if jsonb_array_length(coalesce(p_guests, '[]')) > 0 and not public.is_group_admin(p_group) then
    raise exception 'Misafiri sadece kaptan veya yetkili ekler';
  end if;
  if (coalesce(array_length(p_confirmed, 1), 0) + (case when p_with_me then 1 else 0 end)
     + jsonb_array_length(coalesce(p_guests, '[]'))) > v_cap then
    raise exception 'Seçilen oyuncular kadro sayısını aşıyor';
  end if;

  insert into matches (group_id, played_at, time_tbd, venue, created_by, kind, opponent_name, team_size,
                       capacity, open_to_members, note, status, fee_per_person)
  values (p_group, v_when, p_time is null, nullif(btrim(p_venue), ''), v_me, p_kind,
          case when p_kind = 'external' then nullif(left(btrim(p_opponent), 60), '') end, p_team_size,
          v_cap, coalesce(p_announce, true), nullif(left(btrim(p_note), 300), ''), 'gathering', p_fee)
  returning * into v_m;
  v_id := v_m.id;

  if p_with_me then
    perform public.put_in_roster(v_m, v_me, null);
    update match_entries set source = 'member' where match_id = v_id and user_id = v_me;
  end if;
  foreach v_u in array coalesce(p_confirmed, '{}') loop
    if v_u = v_me then continue; end if;
    -- Üyeler ve (takım dışından) sadece arkadaşlarım doğrudan kadroya yazılır
    if not exists (select 1 from group_players where group_id = p_group and user_id = v_u and left_at is null and not is_loan)
       and (not public.are_friends(v_me, v_u) or public.dm_blocked(v_me, v_u)) then
      raise exception 'Kadroya sadece üyeler ve arkadaşların eklenir';
    end if;
    perform public.put_in_roster(v_m, v_u, null);
    update match_entries set source = 'organizer', added_by = v_me where match_id = v_id and user_id = v_u;
  end loop;
  for v_g in select * from jsonb_array_elements(coalesce(p_guests, '[]')) loop
    if char_length(btrim(coalesce(v_g->>'name', ''))) < 2 then raise exception 'Misafir adı en az 2 karakter olmalı'; end if;
    v_pos := nullif(v_g->>'position', '');
    if v_pos is not null and v_pos not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
    insert into group_players (group_id, display_name, position) values (p_group, left(btrim(v_g->>'name'), 40), v_pos)
    returning id into v_gp;
    insert into match_players (match_id, player_id, team, position, is_goalkeeper)
    values (v_id, v_gp, 'A', v_pos, coalesce(v_pos = 'GK', false));
    update match_entries set added_by = v_me where match_id = v_id and player_id = v_gp;
  end loop;

  v_count := public.match_roster_count(v_id);
  if v_count >= v_cap and p_time is not null and (p_kind = 'internal' or v_m.opponent_name is not null) then
    update matches set status = 'planned', confirmed_at = now() where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_match_v2(uuid, date, time, smallint, text, text, text, text, smallint, boolean, uuid[], jsonb, boolean, integer) from public, anon;
grant execute on function public.create_match_v2(uuid, date, time, smallint, text, text, text, text, smallint, boolean, uuid[], jsonb, boolean, integer) to authenticated;

-- Teklif gönderilmiş ama henüz kabul edilmemiş rakip: maçı görebilen herkes adını görür (teklifin kendisi iki takıma özel kalır)
create function public.match_pending_rivals(p_ids uuid[])
returns table (match_id uuid, group_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select c.from_match_id, g.id, g.name
    from match_challenges c
    join groups g on g.id = c.to_group_id
   where c.from_match_id = any(p_ids) and c.status = 'pending' and public.can_view_match(c.from_match_id)
$$;
revoke all on function public.match_pending_rivals(uuid[]) from public, anon;
grant execute on function public.match_pending_rivals(uuid[]) to authenticated;

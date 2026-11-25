-- Yeniden tasarım 2b (kullanıcı kararları 2026-11-25): gruba/takıma katılma isteği, Keşfet'te grup listesi,
-- yetkililer için bekleyen istekler, rakip takımla maçtan teklif + karşı teklif + tarih değişikliği.
--  * groups.discoverable: topluluk Keşfet'te listelenir (varsayılan kapalı). Takımlar zaten herkese açık.
--  * groups.join_requests_open: katılma isteği alınır mı; boş = varsayılan (toplulukta AÇIK, takımda KAPALI).
--    Toplulukta istek için ayrıca Keşfet'te görünür olmalı. Kodla/bağlantıyla doğrudan giriş aynen kalır.
--  * Teklif artık mevcut maçtan gider (create_challenge_v2); kabulde rakibe toplanan maç açılır. Bekleyen teklifte sıra
--    kimdeyse (awaiting_group_id) o kabul/ret/karşı teklif yapar. Bağlı maçta tarih değişikliği karşı tarafın onayıyla.

-- ---------------------------------------------------------------------------
-- 1) Keşfet / katılma isteği ayarları
-- ---------------------------------------------------------------------------
alter table public.groups
  add column discoverable boolean not null default false,
  add column join_requests_open boolean;
grant select (discoverable, join_requests_open) on public.groups to authenticated;

create or replace function public.accepts_join_requests(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups g
     where g.id = p_group and g.archived_at is null and not g.is_temporary
       and coalesce(g.join_requests_open, g.kind = 'community')
       and (g.kind = 'team' or g.discoverable)
  )
$$;

create or replace function public.set_group_discovery(p_group uuid, p_discoverable boolean, p_requests_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'Bu ayarı sadece kaptan veya yetkili değiştirir'; end if;
  update groups
     set discoverable = case when kind = 'community' then coalesce(p_discoverable, discoverable) else discoverable end,
         join_requests_open = coalesce(p_requests_open, join_requests_open)
   where id = p_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Katılma istekleri
-- ---------------------------------------------------------------------------
create table public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text check (char_length(message) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index group_join_requests_one_pending on public.group_join_requests (group_id, user_id) where status = 'pending';
create index on public.group_join_requests (user_id, created_at desc);
alter table public.group_join_requests enable row level security;
create policy "katılma isteğini görür" on public.group_join_requests
  for select to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id));
-- Yazma sadece RPC

create or replace function public.request_join(p_group uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  if not public.accepts_join_requests(p_group) then raise exception 'Bu grup/takım şu an katılma isteği almıyor'; end if;
  if exists (select 1 from group_players where group_id = p_group and user_id = v_me and left_at is null and not is_loan) then
    raise exception 'Zaten üyesin';
  end if;
  if exists (select 1 from group_join_requests where group_id = p_group and user_id = v_me and status = 'pending') then
    raise exception 'İsteğin zaten bekliyor';
  end if;
  if exists (select 1 from group_join_requests where group_id = p_group and user_id = v_me and status = 'declined'
              and decided_at > now() - interval '7 days') then
    raise exception 'İsteğin yakın zamanda reddedildi; bir hafta sonra tekrar deneyebilirsin';
  end if;
  if (select count(*) from group_join_requests where user_id = v_me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Bugün çok fazla istek gönderdin, yarın tekrar dene';
  end if;
  insert into group_join_requests (group_id, user_id, message)
  values (p_group, v_me, nullif(left(btrim(p_message), 200), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancel_join_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update group_join_requests set status = 'cancelled'
   where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Bekleyen istek bulunamadı'; end if;
end;
$$;

create or replace function public.decide_join_request(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_r group_join_requests;
begin
  select * into v_r from group_join_requests where id = p_id for update;
  if v_r.id is null then raise exception 'İstek bulunamadı'; end if;
  if not public.is_group_admin(v_r.group_id) then raise exception 'İsteğe sadece kaptan veya yetkili karar verir'; end if;
  if v_r.status <> 'pending' then raise exception 'Bu istek zaten sonuçlandı'; end if;
  update group_join_requests
     set status = case when p_accept then 'accepted' else 'declined' end, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  if p_accept then
    -- join_group ile aynı: ödünç/ayrılmış satır varsa üyeye döner
    insert into group_players (group_id, user_id, display_name, position)
    select v_r.group_id, v_r.user_id, display_name, preferred_position from profiles where id = v_r.user_id
    on conflict (group_id, user_id) do update
      set is_loan = false,
          role = case when group_players.left_at is not null then 'member' else group_players.role end,
          left_at = null;
  end if;
end;
$$;

-- Keşfet: takımlar + Keşfet'te görünen topluluklar (güvenli alanlar)
create or replace function public.discover_groups(p_city text default null, p_district text default null, p_kind text default null)
returns table (
  group_id uuid, name text, kind text, city text, district text, description text, color text,
  member_count integer, accepts_requests boolean, is_member boolean, my_request text
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.kind, g.city, g.district, g.description, g.color,
         (select count(*)::int from group_players gp where gp.group_id = g.id and gp.user_id is not null
            and gp.left_at is null and not gp.is_loan),
         public.accepts_join_requests(g.id),
         public.is_group_member(g.id),
         (select r.status from group_join_requests r where r.group_id = g.id and r.user_id = auth.uid()
           order by r.created_at desc limit 1)
    from groups g
   where g.archived_at is null and not g.is_temporary
     and (g.kind = 'team' or g.discoverable)
     and (p_kind is null or g.kind = p_kind)
     and (p_city is null or g.city = p_city)
     and (p_district is null or g.district = p_district)
   order by g.name
   limit 100
$$;

-- ---------------------------------------------------------------------------
-- 3) Bekleyen istekler (yetkililer)
-- ---------------------------------------------------------------------------
-- Grubun bekleyenleri; her bölüm sadece karar verebilene dolu döner
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
                                          'city', p.city, 'district', p.district, 'message', r.message, 'created_at', r.created_at)
                       order by r.created_at)
        from group_join_requests r join profiles p on p.id = r.user_id
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

-- Ana sayfa "Yapılacaklar": yönettiğim gruplardaki bekleyen sayıları
create or replace function public.my_pending_counts()
returns table (group_id uuid, group_name text, joins integer, listings integer, proposals integer, applications integer)
language sql stable security definer set search_path = public as $$
  select g.id, g.name,
         case when public.is_group_admin(g.id) then
           (select count(*)::int from group_join_requests r where r.group_id = g.id and r.status = 'pending') else 0 end,
         case when public.is_group_admin(g.id) then
           (select count(*)::int from match_listings l where l.target_group_id = g.id and l.status = 'pending') else 0 end,
         (select count(*)::int from match_proposals x where x.group_id = g.id and x.status = 'pending'),
         (select count(*)::int from match_entries e join matches m on m.id = e.match_id
           where m.group_id = g.id and e.status = 'pending' and m.status::text in ('gathering', 'planned')
             and public.can_manage_match(m.id))
    from groups g
    join group_players me on me.group_id = g.id and me.user_id = auth.uid() and me.left_at is null and not me.is_loan
   where me.role in ('captain', 'admin', 'organizer')
$$;

-- ---------------------------------------------------------------------------
-- 4) Teklif: maçtan, karşı teklif, tarih değişikliği
-- ---------------------------------------------------------------------------
alter table public.match_challenges
  add column from_match_id uuid references public.matches (id) on delete cascade,
  add column proposed_tbd boolean not null default false,
  add column awaiting_group_id uuid references public.groups (id) on delete cascade,
  -- Kabul edilmiş maçta bekleyen tarih değişikliği
  add column pending_at timestamptz,
  add column pending_tbd boolean,
  add column pending_venue text check (char_length(pending_venue) <= 80),
  add column pending_by uuid references public.profiles (id) on delete set null,
  -- Son karşı teklifi yapan (rakibin maçı onun adına açılır)
  add column countered_by uuid references public.profiles (id) on delete set null;
update public.match_challenges set awaiting_group_id = to_group_id where status = 'pending';

create or replace function public.day_time_ts(p_day date, p_time time)
returns timestamptz language sql stable as $$
  select (p_day + coalesce(p_time, time '12:00')) at time zone 'Europe/Istanbul'
$$;

create or replace function public.create_challenge_v2(p_match uuid, p_to uuid, p_message text default null, p_fee text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.is_group_admin(v_m.group_id) then raise exception 'Teklifi sadece takımın kaptanı veya yetkilisi gönderir'; end if;
  if v_m.kind <> 'external' or public.group_kind(p_to) is distinct from 'team' or p_to = v_m.group_id then
    raise exception 'Teklif sadece başka bir takıma gönderilir';
  end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then raise exception 'Bu maç için teklif gönderilemez'; end if;
  if v_m.challenge_id is not null then raise exception 'Bu maç zaten bir rakiple bağlı'; end if;
  if exists (select 1 from match_challenges where from_match_id = p_match and status = 'pending') then
    raise exception 'Bu maç için bekleyen bir teklif var; önce onu geri çek';
  end if;
  if (select count(*) from match_challenges where from_group_id = v_m.group_id and to_group_id = p_to and status = 'pending') >= 3 then
    raise exception 'Bu takıma zaten bekleyen teklifleriniz var';
  end if;
  insert into match_challenges (from_group_id, to_group_id, created_by, proposed_at, proposed_tbd, venue, fee_note, message,
                                team_size, from_match_id, awaiting_group_id)
  values (v_m.group_id, p_to, auth.uid(), v_m.played_at, v_m.time_tbd, v_m.venue,
          nullif(left(btrim(p_fee), 120), ''), nullif(left(btrim(p_message), 300), ''), coalesce(v_m.team_size, 7), p_match, p_to)
  returning id into v_id;
  return v_id;
end;
$$;

-- Sırası gelen taraf tarihi/sahayı değiştirip geri yollar
create or replace function public.counter_challenge(p_challenge uuid, p_day date, p_time time, p_venue text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge for update;
  if v_c.id is null then raise exception 'Teklif bulunamadı'; end if;
  if v_c.status <> 'pending' then raise exception 'Bu teklif artık bekleyen değil'; end if;
  if not public.is_group_admin(coalesce(v_c.awaiting_group_id, v_c.to_group_id)) then
    raise exception 'Karşı teklifi sadece sırası gelen takımın kaptanı veya yetkilisi yapar';
  end if;
  if p_day is null or p_day < public.istanbul_today() then raise exception 'Maç günü bugün veya sonrası olmalı'; end if;
  if p_time is not null and public.day_time_ts(p_day, p_time) <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  update match_challenges
     set proposed_at = public.day_time_ts(p_day, p_time), proposed_tbd = p_time is null,
         venue = coalesce(nullif(left(btrim(p_venue), 80), ''), venue),
         awaiting_group_id = case when coalesce(awaiting_group_id, to_group_id) = to_group_id then from_group_id else to_group_id end,
         countered_by = case when coalesce(awaiting_group_id, to_group_id) = to_group_id then auth.uid() else countered_by end
   where id = p_challenge;
end;
$$;

-- Kabul/ret: sırası gelen taraf. Maçtan gelen teklifte gönderenin maçı bağlanır, rakibe toplanan maç açılır.
create or replace function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
  v_from_name text;
  v_to_name text;
  v_m_from uuid;
  v_m_to uuid;
  v_awaiting uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if not found then raise exception 'Teklif bulunamadı'; end if;
  v_awaiting := coalesce(v_c.awaiting_group_id, v_c.to_group_id);
  if not public.is_group_admin(v_awaiting) then
    raise exception 'Teklife sadece sırası gelen takımın kaptanı veya yetkilisi yanıt verir';
  end if;
  if v_c.status <> 'pending' then raise exception 'Bu teklif zaten yanıtlandı'; end if;

  if not p_accept then
    update match_challenges set status = 'declined', responded_by = auth.uid(), responded_at = now() where id = p_challenge_id;
    return null;
  end if;

  if (case when v_c.proposed_tbd then (v_c.proposed_at at time zone 'Europe/Istanbul')::date < public.istanbul_today()
           else v_c.proposed_at < now() end) then
    raise exception 'Teklif edilen zaman geçti';
  end if;
  select name into v_from_name from groups where id = v_c.from_group_id;
  select name into v_to_name from groups where id = v_c.to_group_id;

  if v_c.from_match_id is not null then
    select id into v_m_from from matches where id = v_c.from_match_id and status::text in ('gathering', 'planned') for update;
    if v_m_from is null then raise exception 'Teklifin maçı artık açık değil'; end if;
    update matches
       set opponent_name = v_to_name, opponent_group_id = v_c.to_group_id, challenge_id = v_c.id,
           played_at = v_c.proposed_at, time_tbd = v_c.proposed_tbd, venue = v_c.venue
     where id = v_m_from;
    insert into matches (group_id, played_at, time_tbd, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id,
                         team_size, capacity, open_to_members, status)
    values (v_c.to_group_id, v_c.proposed_at, v_c.proposed_tbd, v_c.venue,
            case when v_awaiting = v_c.to_group_id then auth.uid()
                 else coalesce(v_c.countered_by, (select created_by from groups where id = v_c.to_group_id)) end,
            'external', v_from_name, v_c.from_group_id, v_c.id, v_c.team_size, v_c.team_size, true, 'gathering')
    returning id into v_m_to;
  else
    -- Eski teklif (Keşfet "Meydan Oku"): iki takımda da maç açılır (0011 gibi)
    insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id, team_size)
    values (v_c.from_group_id, v_c.proposed_at, v_c.venue, v_c.created_by, 'external', v_to_name, v_c.to_group_id, v_c.id, v_c.team_size)
    returning id into v_m_from;
    insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id, team_size)
    values (v_c.to_group_id, v_c.proposed_at, v_c.venue, auth.uid(), 'external', v_from_name, v_c.from_group_id, v_c.id, v_c.team_size)
    returning id into v_m_to;
  end if;

  update match_challenges
     set status = 'accepted', responded_by = auth.uid(), responded_at = now(), awaiting_group_id = null
   where id = p_challenge_id;
  return case when public.is_group_member(v_c.to_group_id) then v_m_to else v_m_from end;
end;
$$;

-- Bağlı maçta tarih/saha değişikliği: bir taraf önerir, diğeri onaylar
create or replace function public.propose_reschedule(p_challenge uuid, p_day date, p_time time, p_venue text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
  v_side uuid;
begin
  select * into v_c from match_challenges where id = p_challenge for update;
  if v_c.id is null or v_c.status <> 'accepted' then raise exception 'Kabul edilmiş teklif bulunamadı'; end if;
  if public.is_group_admin(v_c.from_group_id) then v_side := v_c.from_group_id;
  elsif public.is_group_admin(v_c.to_group_id) then v_side := v_c.to_group_id;
  else raise exception 'Tarih değişikliğini sadece iki takımın kaptanı veya yetkilisi önerir';
  end if;
  if not exists (select 1 from matches where challenge_id = p_challenge and status::text in ('gathering', 'planned')) then
    raise exception 'Bu maç artık değiştirilemez';
  end if;
  if p_day is null or p_day < public.istanbul_today() then raise exception 'Maç günü bugün veya sonrası olmalı'; end if;
  if p_time is not null and public.day_time_ts(p_day, p_time) <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  if p_time is null and exists (select 1 from matches where challenge_id = p_challenge and status::text = 'planned') then
    raise exception 'Kesinleşmiş maçın saati belli olmalı';
  end if;
  update match_challenges
     set pending_at = public.day_time_ts(p_day, p_time), pending_tbd = p_time is null,
         pending_venue = nullif(left(btrim(p_venue), 80), ''), pending_by = auth.uid(),
         awaiting_group_id = case when v_side = from_group_id then to_group_id else from_group_id end
   where id = p_challenge;
end;
$$;

create or replace function public.respond_reschedule(p_challenge uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge for update;
  if v_c.id is null or v_c.status <> 'accepted' or v_c.pending_at is null then raise exception 'Bekleyen tarih değişikliği yok'; end if;
  if not public.is_group_admin(v_c.awaiting_group_id) then
    raise exception 'Tarih değişikliğine sadece karşı takımın kaptanı veya yetkilisi yanıt verir';
  end if;
  if p_accept then
    update matches
       set played_at = v_c.pending_at, time_tbd = coalesce(v_c.pending_tbd, false),
           venue = coalesce(v_c.pending_venue, venue),
           free_withdraw_until = case when status::text = 'planned' then now() + interval '24 hours' else free_withdraw_until end
     where challenge_id = p_challenge and status::text in ('gathering', 'planned');
    update match_challenges set proposed_at = v_c.pending_at, proposed_tbd = coalesce(v_c.pending_tbd, false),
           venue = coalesce(v_c.pending_venue, venue) where id = p_challenge;
  end if;
  update match_challenges
     set pending_at = null, pending_tbd = null, pending_venue = null, pending_by = null, awaiting_group_id = null
   where id = p_challenge;
end;
$$;

-- Bağlı maçın saati rakiple birlikte belirlenir: kesinleştirme sadece anlaşılan saatle
create or replace function public.confirm_match(p_match uuid, p_starts_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_count integer;
  v_min integer;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer kesinleştirir'; end if;
  if v_m.status::text <> 'gathering' then raise exception 'Bu maç toplanma aşamasında değil'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  if v_m.challenge_id is not null and (v_m.time_tbd or p_starts_at <> v_m.played_at) then
    raise exception 'Rakiple bağlı maçın saati önce rakiple anlaşılarak belirlenir';
  end if;
  if v_m.kind = 'external' and v_m.opponent_name is null and v_m.opponent_group_id is null then
    raise exception 'Kesinleştirmeden önce rakibi belirle';
  end if;
  v_count := public.match_roster_count(p_match);
  v_min := case when v_m.kind = 'internal' then 4 else 2 end;
  if v_count < v_min then raise exception 'Kesinleştirmek için kadroda en az % kişi olmalı', v_min; end if;
  update matches set status = 'planned', played_at = p_starts_at, time_tbd = false, confirmed_at = now() where id = p_match;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'accepts_join_requests(uuid)', 'set_group_discovery(uuid, boolean, boolean)', 'request_join(uuid, text)',
    'cancel_join_request(uuid)', 'decide_join_request(uuid, boolean)', 'discover_groups(text, text, text)',
    'pending_requests(uuid)', 'my_pending_counts()', 'create_challenge_v2(uuid, uuid, text, text)',
    'counter_challenge(uuid, date, time, text)', 'respond_challenge(uuid, boolean)',
    'propose_reschedule(uuid, date, time, text)', 'respond_reschedule(uuid, boolean)', 'confirm_match(uuid, timestamptz)',
    'day_time_ts(date, time)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

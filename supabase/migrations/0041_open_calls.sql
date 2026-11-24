-- Maça Çağır + herkese açık adam arama (yol haritası 6.4, kullanıcı kararları 2026-11-24)
--
--  * Kişisel davet: organizatör çağrı kartını sohbetten gönderince (share_match_card) alıcı poll_invites'a yazılır;
--    davetli üye olmasa da çağrıyı görür ve yanıt verir. Grubun toplama çağrısında seçilirse topluluğa ödünç yazılır.
--  * Herkese açık adam arama: match_polls.is_public (sadece purpose='fill'). Giriş yapmış herkes görür ve başvurur;
--    liste open_fill_polls RPC'si ile (özel grubun tablosu açılmaz, sadece güvenli alanlar döner).
--  * Gizlilik (kullanıcı kararı): özel grubun maçına dışarıdan gelen ödünç oyuncu SADECE oynadığı maçı görür
--    (maç, kadro, sonuçlar, o maçtaki oyuncuların kartları) + grubun adı. Grubun diğer maçları, oyuncu listesi, sohbeti kapalı.
-- Sadece ekleme/genişletme: yayındaki eski kod yeni sütunu bilmeden çalışır.

-- ---------------------------------------------------------------------------
-- 1) Yapılar
-- ---------------------------------------------------------------------------
alter table public.match_polls
  add column is_public boolean not null default false,
  add constraint match_polls_public_fill check (not is_public or purpose = 'fill');
create index on public.match_polls (is_public, status) where is_public;

create table public.poll_invites (
  poll_id uuid not null references public.match_polls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create index on public.poll_invites (user_id);
alter table public.poll_invites enable row level security;
-- Yazma sadece share_match_card üzerinden

-- Daha önce gönderilmiş çağrı kartları da çalışsın: alıcıyı davetli say
insert into public.poll_invites (poll_id, user_id, invited_by, created_at)
select m.poll_id, case when t.user_a = m.author_id then t.user_b else t.user_a end, m.author_id, min(m.created_at)
  from public.dm_messages m
  join public.dm_threads t on t.id = m.thread_id
  join public.match_polls p on p.id = m.poll_id
 where m.kind = 'match' and m.poll_id is not null and m.author_id is not null
 group by m.poll_id, case when t.user_a = m.author_id then t.user_b else t.user_a end, m.author_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2) Yardımcılar
-- ---------------------------------------------------------------------------
-- Çağrıyı görebilir/yanıtlayabilir: üye, davetli, herkese açık adam arama veya zaten yanıt vermiş
create or replace function public.can_view_poll(p_poll_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_polls p
     where p.id = p_poll_id
       and (public.is_group_member(p.group_id)
            or (p.is_public and p.purpose = 'fill')
            or exists (select 1 from poll_invites i where i.poll_id = p.id and i.user_id = auth.uid())
            or exists (select 1 from poll_responses r where r.poll_id = p.id and r.user_id = auth.uid()))
  )
$$;

-- Bu maçın kadrosundayım (ödünç dahil)
create or replace function public.is_match_participant(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_players mp join group_players gp on gp.id = mp.player_id
     where mp.match_id = p_match_id and gp.user_id = auth.uid()
  )
$$;

-- Bu oyuncu satırıyla aynı maçta oynadım
create or replace function public.is_co_player(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_players a
      join match_players b on b.match_id = a.match_id
      join group_players me on me.id = b.player_id
     where a.player_id = p_player_id and me.user_id = auth.uid()
  )
$$;

-- Grupta (ödünç dahil) aktif satırım var: grubun adını görürüm
create or replace function public.has_group_row(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players where group_id = p_group_id and user_id = auth.uid() and left_at is null
  )
$$;

do $$
declare
  f text;
begin
  foreach f in array array['can_view_poll(uuid)', 'is_match_participant(uuid)', 'is_co_player(uuid)', 'has_group_row(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Görünürlük politikaları
-- ---------------------------------------------------------------------------
drop policy "üyeler çağrıları görür" on public.match_polls;
create policy "çağrıyı görür" on public.match_polls
  for select to authenticated using (public.can_view_poll(id));

drop policy "üyeler yanıtları görür" on public.poll_responses;
create policy "yanıtları görür" on public.poll_responses
  for select to authenticated
  using (public.is_group_member(public.poll_group(poll_id)) or user_id = auth.uid() or public.can_manage_poll(poll_id));

create policy "davetini ve yönetici davetleri görür" on public.poll_invites
  for select to authenticated using (user_id = auth.uid() or public.can_manage_poll(poll_id));

drop policy "grubu/takımı görür" on public.groups;
create policy "grubu/takımı görür" on public.groups
  for select to authenticated
  using (public.is_group_visible(id) or created_by = auth.uid() or public.has_group_row(id));

drop policy "oyuncuları görür" on public.group_players;
create policy "oyuncuları görür" on public.group_players
  for select to authenticated
  using (public.is_group_visible(group_id) or user_id = auth.uid() or public.is_co_player(id));

drop policy "maçları görür" on public.matches;
create policy "maçları görür" on public.matches
  for select to authenticated using (public.is_group_visible(group_id) or public.is_match_participant(id));

drop policy "kadroyu görür" on public.match_players;
create policy "kadroyu görür" on public.match_players
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)) or public.is_match_participant(match_id));

drop policy "sonuçları görür" on public.match_results;
create policy "sonuçları görür" on public.match_results
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)) or public.is_match_participant(match_id));

drop policy "ratingleri görür" on public.player_ratings;
create policy "ratingleri görür" on public.player_ratings
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
     where gp.id = player_id and (public.is_group_visible(gp.group_id) or public.is_co_player(gp.id))
  ));

drop policy "yetenekleri gör" on public.player_skills;
create policy "yetenekleri gör" on public.player_skills
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
     where gp.id = player_id and (public.is_group_visible(gp.group_id) or public.is_co_player(gp.id))
  ));

drop policy "kartı gör" on public.user_ratings;
create policy "kartı gör" on public.user_ratings
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
     where gp.user_id = user_ratings.user_id and (public.is_group_visible(gp.group_id) or public.is_co_player(gp.id))
  ));

drop policy "yetenekleri gör" on public.user_skills;
create policy "yetenekleri gör" on public.user_skills
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
     where gp.user_id = user_skills.user_id and (public.is_group_visible(gp.group_id) or public.is_co_player(gp.id))
  ));

-- ---------------------------------------------------------------------------
-- 4) Adam arama: herkese açık seçeneği (eski imza kalır; yeni parametre sonda)
-- ---------------------------------------------------------------------------
create or replace function public.set_poll_public(p_poll uuid, p_public boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
begin
  select * into v_p from match_polls where id = p_poll;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll) then raise exception 'Bunu sadece çağrıyı açan kişi veya yetkililer yapar'; end if;
  if v_p.purpose <> 'fill' then raise exception 'Sadece adam arama herkese açılır'; end if;
  if v_p.status <> 'open' then raise exception 'Bu adam arama açık değil'; end if;
  update match_polls set is_public = coalesce(p_public, false) where id = p_poll;
end;
$$;
revoke all on function public.set_poll_public(uuid, boolean) from public, anon;
grant execute on function public.set_poll_public(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Yanıt: üye yerine "görebilen" (üye, davetli, herkese açık adam arama)
-- ---------------------------------------------------------------------------
create or replace function public.respond_poll(p_poll uuid, p_answer text, p_position text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
  v_r poll_responses;
  v_m matches;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_p from match_polls where id = p_poll;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_view_poll(p_poll) then raise exception 'Bu çağrıya sadece üyeler ve çağrılanlar yanıt verir'; end if;
  if p_answer not in ('yes', 'maybe', 'no') then raise exception 'Geçersiz yanıt'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
  if v_p.play_on < public.istanbul_today() then raise exception 'Bu çağrının günü geçti'; end if;
  if v_p.match_id is not null then
    select * into v_m from matches where id = v_p.match_id;
  end if;
  -- Açık çağrı yanıtlanır; kesinleşmiş toplama çağrısına da (maç planlıyken) geç gelen yedek olarak yazılır
  if not (v_p.status = 'open'
          or (v_p.status in ('converted', 'filled') and v_m.status = 'planned')) then
    raise exception 'Bu çağrı yanıtlara kapandı';
  end if;
  select * into v_r from poll_responses where poll_id = p_poll and user_id = auth.uid();
  if v_m.id is not null and exists (
    select 1 from match_players mp join group_players gp on gp.id = mp.player_id
     where mp.match_id = v_m.id and gp.user_id = auth.uid()
  ) then
    if p_answer <> 'yes' then
      raise exception 'Maçın kadrosundasın; çekilmek için maç ekranından çekilme iste';
    end if;
    if v_r.status is distinct from 'selected' then
      raise exception 'Zaten maçın kadrosundasın';
    end if;
  end if;
  if v_r.status = 'selected' and p_answer <> 'yes' then
    raise exception 'Kadrodasın; çekilmek için maç ekranından çekilme iste';
  end if;
  if v_r.status = 'rejected' and p_answer = 'yes' then
    raise exception 'Organizatör bu maç için başka oyuncu seçti';
  end if;

  insert into poll_responses (poll_id, user_id, answer, position, note, status)
  values (p_poll, auth.uid(), p_answer, p_position, nullif(btrim(p_note), ''),
          case when p_answer = 'yes' and v_p.status <> 'open' then 'reserve' end)
  on conflict (poll_id, user_id) do update
    set answer = excluded.answer,
        position = excluded.position,
        note = excluded.note,
        status = case
          when poll_responses.status in ('selected', 'rejected') then poll_responses.status
          when excluded.answer <> 'yes' then null
          when v_p.status <> 'open' then 'reserve'
          else poll_responses.status end,
        responded_at = case when poll_responses.answer = 'yes' and excluded.answer = 'yes'
                            then poll_responses.responded_at else now() end;
end;
$$;

-- Yanıtlayanlar: üye ve yönetici hepsini, dışarıdan gelen sadece kendini görür
create or replace function public.poll_responders(p_poll uuid)
returns table (
  user_id uuid, display_name text, answer text, chosen_position text, preferred_position text, note text,
  status text, responded_at timestamptz, overall integer, played integer, no_shows integer
)
language sql stable security definer set search_path = public as $$
  select r.user_id, p.display_name, r.answer, r.position, p.preferred_position, r.note, r.status, r.responded_at,
         coalesce(ur.overall, 65)::int,
         case when public.can_manage_poll(p_poll) then
           (select count(*)::int from match_players mp
              join group_players gp on gp.id = mp.player_id
              join matches m on m.id = mp.match_id
             where gp.user_id = r.user_id and m.status in ('voting', 'closed')) end,
         case when public.can_manage_poll(p_poll) then
           (select count(*)::int from match_no_shows n where n.user_id = r.user_id) end
    from poll_responses r
    join profiles p on p.id = r.user_id
    left join user_ratings ur on ur.user_id = r.user_id
   where r.poll_id = p_poll
     and (public.is_group_member(public.poll_group(p_poll)) or public.can_manage_poll(p_poll) or r.user_id = auth.uid())
   order by r.responded_at
$$;

-- ---------------------------------------------------------------------------
-- 6) Kesinleştirme: kendi aramızda maçta davetli (üye olmayan) topluluğa ödünç yazılır
-- ---------------------------------------------------------------------------
create or replace function public.finalize_poll(
  p_poll uuid, p_starts_at timestamptz, p_venue text, p_team_size smallint, p_kind text,
  p_team uuid default null, p_opponent text default null, p_roster jsonb default '[]', p_new_team text default null,
  p_guests jsonb default '[]'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
  v_group uuid;
  v_match uuid;
  v_e jsonb;
  v_user uuid;
  v_resp poll_responses;
  v_guest poll_guests;
  v_gp uuid;
  v_pos text;
  v_count integer := jsonb_array_length(coalesce(p_roster, '[]')) + jsonb_array_length(coalesce(p_guests, '[]'));
  v_team uuid := p_team;
  v_city text;
  v_district text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_p from match_polls where id = p_poll for update;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll) then raise exception 'Kadroyu sadece çağrıyı açan kişi veya yetkililer kesinleştirir'; end if;
  if v_p.purpose <> 'gather' or v_p.status <> 'open' then raise exception 'Bu çağrı kesinleştirilemez'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  if p_team_size is not null and p_team_size not between 5 and 11 then raise exception 'Kişi sayısı 5 ile 11 arasında olmalı'; end if;

  if p_kind = 'internal' then
    if public.group_kind(v_p.group_id) is distinct from 'community' then
      raise exception 'Kendi aramızda maç sadece toplulukta kurulur; takım rakibe karşı oynar';
    end if;
    if v_count < 4 then raise exception 'Kendi aramızda maç için en az 4 oyuncu seçin'; end if;
    v_group := v_p.group_id;
  elsif p_kind = 'external' then
    if char_length(btrim(coalesce(p_new_team, ''))) > 0 then
      if char_length(btrim(p_new_team)) < 2 then raise exception 'Takım adı en az 2 karakter olmalı'; end if;
      if (select count(*) from groups where created_by = auth.uid() and is_temporary and archived_at is null) >= 5 then
        raise exception 'En fazla 5 açık geçici takımın olabilir; eskilerden birini seç veya dağıt';
      end if;
      select city, district into v_city, v_district from groups where id = v_p.group_id;
      if v_city is null then
        select city, district into v_city, v_district from profiles where id = auth.uid();
      end if;
      if v_city is null then raise exception 'Hızlı takım için önce profilinden il seç'; end if;
      insert into groups (name, created_by, kind, city, district, is_temporary)
      values (left(btrim(p_new_team), 60), auth.uid(), 'team', v_city, v_district, true)
      returning id into v_team;
    elsif v_team is not null and exists (select 1 from groups where id = v_team and is_temporary and archived_at is not null)
          and public.is_group_captain(v_team) then
      update groups set archived_at = null where id = v_team;
    end if;
    if v_team is null or public.group_kind(v_team) is distinct from 'team' then
      raise exception 'Rakibe karşı maç için bir takım seçin';
    end if;
    if not public.can_create_match(v_team) then
      raise exception 'Bu takımda maç kurma yetkin yok';
    end if;
    if char_length(btrim(coalesce(p_opponent, ''))) < 2 then raise exception 'Rakip takımın adını yazın'; end if;
    if v_count < 2 then raise exception 'En az 2 oyuncu seçin'; end if;
    v_group := v_team;
  else
    raise exception 'Geçersiz maç türü';
  end if;

  insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, team_size)
  values (v_group, p_starts_at, nullif(btrim(p_venue), ''), auth.uid(), p_kind,
          case when p_kind = 'external' then left(btrim(p_opponent), 60) end, p_team_size)
  returning id into v_match;

  for v_e in select * from jsonb_array_elements(coalesce(p_roster, '[]')) loop
    v_user := (v_e->>'user_id')::uuid;
    select * into v_resp from poll_responses where poll_id = p_poll and user_id = v_user;
    if v_resp.poll_id is null or v_resp.answer = 'no' or v_resp.status = 'rejected' then
      raise exception 'Kadroya sadece "geliyorum" veya "belki" diyenler seçilir';
    end if;
    if p_kind = 'internal'
       and not exists (select 1 from group_players
                        where group_id = v_group and user_id = v_user and left_at is null and not is_loan)
       and not exists (select 1 from poll_invites where poll_id = p_poll and user_id = v_user) then
      raise exception 'Seçilen bir oyuncu artık topluluğun üyesi değil';
    end if;
    select coalesce(v_resp.position, preferred_position) into v_pos from profiles where id = v_user;
    if coalesce((v_e->>'gk')::boolean, false) then v_pos := 'GK'; end if;
    v_gp := public.ensure_match_player(v_group, v_user, v_pos);
    insert into match_players (match_id, player_id, team, position, is_goalkeeper)
    values (v_match, v_gp,
            case when p_kind = 'external' then 'A' when v_e->>'team' = 'B' then 'B' else 'A' end,
            v_pos, coalesce(v_pos = 'GK', false))
    on conflict (match_id, player_id) do nothing;
    update poll_responses set status = 'selected', answer = 'yes' where poll_id = p_poll and user_id = v_user;
  end loop;

  for v_e in select * from jsonb_array_elements(coalesce(p_guests, '[]')) loop
    select * into v_guest from poll_guests where id = (v_e->>'id')::uuid and poll_id = p_poll for update;
    if v_guest.id is null then raise exception 'Seçilen misafir bu çağrıda yok'; end if;
    if v_guest.player_id is not null then raise exception 'Aynı misafir iki kez seçilemez'; end if;
    v_pos := case when coalesce((v_e->>'gk')::boolean, false) then 'GK' else v_guest.position end;
    insert into group_players (group_id, display_name, position)
    values (v_group, v_guest.name, v_pos)
    returning id into v_gp;
    insert into match_players (match_id, player_id, team, position, is_goalkeeper)
    values (v_match, v_gp,
            case when p_kind = 'external' then 'A' when v_e->>'team' = 'B' then 'B' else 'A' end,
            v_pos, coalesce(v_pos = 'GK', false));
    update poll_guests set player_id = v_gp where id = v_guest.id;
  end loop;

  update poll_responses set status = 'reserve'
   where poll_id = p_poll and answer = 'yes' and status is null;
  update match_polls
     set status = 'converted', match_id = v_match, starts_at = p_starts_at, venue = nullif(btrim(p_venue), ''),
         team_size = p_team_size, capacity = v_count
   where id = p_poll;
  return v_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Davet kartı: çağrı kartı alıcıyı davetli yapar
-- ---------------------------------------------------------------------------
create or replace function public.share_match_card(p_user_id uuid, p_type text, p_ref uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_group groups;
  v_card jsonb;
  v_body text;
  v_thread uuid;
  v_id bigint;
  v_when timestamptz;
  v_venue text;
  v_poll match_polls;
  v_match matches;
  v_label text;
begin
  if v_me is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_user_id is null or p_user_id = v_me or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Geçersiz kişi';
  end if;
  if public.dm_blocked(v_me, p_user_id) then
    raise exception 'Bu kişiye davet gönderilemiyor';
  end if;

  if p_type = 'poll' then
    select * into v_poll from match_polls where id = p_ref;
    if not found or v_poll.status not in ('open', 'converted') then
      raise exception 'Çağrı bulunamadı veya kapalı';
    end if;
    select * into v_group from groups where id = v_poll.group_id;
    v_when := coalesce(v_poll.starts_at, v_poll.play_on::timestamp at time zone 'Europe/Istanbul'); v_venue := v_poll.venue;
    v_label := case when v_poll.purpose = 'fill' then 'Adam aranıyor' else 'Maç çağrısı' end;
    v_card := jsonb_build_object('type', 'poll', 'capacity', v_poll.capacity, 'purpose', v_poll.purpose,
      'positions', to_jsonb(v_poll.positions), 'time_tbd', v_poll.starts_at is null);
  elsif p_type = 'match' then
    select * into v_match from matches where id = p_ref;
    if not found or v_match.status <> 'planned' then
      raise exception 'Maç bulunamadı veya artık planlı değil';
    end if;
    select * into v_group from groups where id = v_match.group_id;
    v_when := v_match.played_at; v_venue := v_match.venue;
    v_label := 'Maç';
    v_card := jsonb_build_object('type', 'match', 'opponent', v_match.opponent_name, 'team_size', v_match.team_size);
  else
    raise exception 'Geçersiz davet türü';
  end if;

  if not (public.is_group_admin(v_group.id)
          or (p_type = 'poll' and public.can_manage_poll(p_ref))
          or (p_type = 'match' and public.can_manage_match(p_ref))) then
    raise exception 'Davet göndermek için kaptan, yetkili veya maçı kuran kişi olmalısınız';
  end if;

  if (select count(*) from dm_messages where author_id = v_me and kind = 'match' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Bugün çok fazla davet gönderdin, yarın tekrar dene';
  end if;

  v_card := v_card || jsonb_build_object(
    'group_id', v_group.id, 'group_name', v_group.name, 'group_kind', v_group.kind,
    'starts_at', v_when, 'venue', v_venue);
  v_body := '⚽ ' || v_label || ': ' || v_group.name || ' · ' || public.chat_tr_date(v_when) || coalesce(' · ' || v_venue, '');

  v_thread := public.start_dm(p_user_id);
  if exists (
    select 1 from dm_messages
     where thread_id = v_thread and kind = 'match' and created_at > now() - interval '1 day'
       and ((p_type = 'poll' and poll_id = p_ref) or (p_type = 'match' and match_id = p_ref))
  ) then
    raise exception 'Bu daveti bu kişiye zaten gönderdin';
  end if;

  insert into dm_messages (thread_id, author_id, kind, body, card, poll_id, match_id)
  values (v_thread, v_me, 'match', left(v_body, 300), v_card,
          case when p_type = 'poll' then p_ref end,
          case when p_type = 'match' then p_ref end)
  returning id into v_id;
  update dm_threads set last_message_at = now(), last_author_id = v_me, last_body = left(v_body, 80) where id = v_thread;

  if p_type = 'poll' then
    insert into poll_invites (poll_id, user_id, invited_by) values (p_ref, p_user_id, v_me)
    on conflict (poll_id, user_id) do nothing;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Herkese açık adam aramalar ve tek çağrının özeti (özel grup tablosu açılmadan güvenli alanlar)
-- ---------------------------------------------------------------------------
-- Bölge: grubun il/ilçesi, grupta yoksa çağrıyı açanın profilinden
create or replace function public.poll_overview(p_ids uuid[])
returns table (
  poll_id uuid, group_id uuid, group_name text, group_kind text, city text, district text, purpose text, status text,
  is_public boolean, play_on date, starts_at timestamptz, venue text, team_size smallint, needed smallint, taken integer,
  positions text[], note text, match_id uuid, match_kind text, opponent_name text, created_by uuid, organizer_name text,
  my_answer text, my_status text, is_member boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, g.id, g.name, g.kind, coalesce(g.city, pr.city), case when g.city is null then pr.district else g.district end,
         p.purpose, p.status, p.is_public, p.play_on, p.starts_at, p.venue, p.team_size, p.capacity,
         (select count(*)::int from poll_responses r where r.poll_id = p.id and r.status = 'selected'),
         p.positions, p.note, p.match_id, m.kind, m.opponent_name, p.created_by, pr.display_name,
         me.answer, me.status, public.is_group_member(g.id)
    from match_polls p
    join groups g on g.id = p.group_id
    left join profiles pr on pr.id = p.created_by
    left join matches m on m.id = p.match_id
    left join poll_responses me on me.poll_id = p.id and me.user_id = auth.uid()
   where p.id = any(p_ids) and public.can_view_poll(p.id)
$$;

-- Herkese açık, açık, gelecekteki adam aramalar (bölge süzgeci isteğe bağlı; ilçe büyük/küçük harf duyarsız)
create or replace function public.open_fill_polls(p_city text default null, p_district text default null)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id
    from match_polls p
    join groups g on g.id = p.group_id
    join matches m on m.id = p.match_id
    left join profiles pr on pr.id = p.created_by
   where p.is_public and p.purpose = 'fill' and p.status = 'open'
     and p.play_on >= public.istanbul_today() and m.status = 'planned' and m.played_at > now()
     and g.archived_at is null
     and (p_city is null or coalesce(g.city, pr.city) = p_city)
     and (p_district is null or lower(case when g.city is null then pr.district else g.district end) = lower(btrim(p_district)))
   order by m.played_at
   limit 100
$$;

revoke all on function public.poll_overview(uuid[]) from public, anon;
grant execute on function public.poll_overview(uuid[]) to authenticated;
revoke all on function public.open_fill_polls(text, text) from public, anon;
grant execute on function public.open_fill_polls(text, text) to authenticated;

-- Birleşik çağrı (kullanıcı kararları, 2. parça). Eski "üye çağrısı" (otomatik maç, %70), yetkili elle onayı ve
-- oyuncu ilanı (player_listings) tek yapıda birleşir: match_polls.
--
--  * purpose = 'gather' (toplama): maç kurulmadan "kimler gelir?". Zorunlu tek şey gün (play_on); saat, saha,
--    kişi sayısı, karar zamanı (decide_by), not isteğe bağlı. Organizatör finalize_poll ile kadroyu toplu kesinleştirir:
--    kendi aramızda (çağrının topluluğunda) veya rakibe karşı (organizatörün maç açabildiği bir takımda; takım üyesi
--    olmayanlar o takıma ödünç yazılır). Seçilmeyen "geliyorum"cular yedek olur; yedeği kadroya organizatör alır.
--  * purpose = 'fill' (adam ara): planlanmış maçın eksiği. capacity = aranan kişi; başvuranları organizatör tek tek
--    kabul eder (accept_responder). Çağrı maçın kendi grubunda veya organizatörün maç açabildiği bir toplulukta açılır.
--  * group_id = çağrının yayınlandığı yer (kimler görür ve yanıtlar). Maçın sahibi grubu matches.group_id'dir.
--  * Yanıt artık hesaba bağlı (poll_responses.user_id): topluluk üyesi takımın üyesi olmadan takımın çağrısına yanıt verir.
--  * Kurucu/yetkili dışındakiler aynı grupta en fazla 3 açık çağrı.
-- Eski açık çağrılar kapanır; ilanlar ve başvurular silinir (ödünç oyuncular ve maçlar kalır).

-- ---------------------------------------------------------------------------
-- 1) Eski yapıların kaldırılması
-- ---------------------------------------------------------------------------
drop trigger if exists close_listings_on_match_change on public.matches;
drop trigger if exists release_loan_on_roster_removal on public.match_players;
drop function if exists public.close_listings_on_match_change();
drop function if exists public.release_loan_on_roster_removal();
drop function if exists public.create_listing(uuid, smallint, text[], smallint, text);
drop function if exists public.close_listing(uuid);
drop function if exists public.apply_listing(uuid, text, text);
drop function if exists public.withdraw_application(uuid);
drop function if exists public.decide_application(uuid, uuid, boolean);
drop function if exists public.listing_applicants(uuid);
drop function if exists public.create_member_poll(uuid, timestamptz, text, smallint, timestamptz, text);
drop function if exists public.set_poll_approval(uuid, uuid, boolean);
drop function if exists public.approve_first_responders(uuid);
drop function if exists public.respond_poll(uuid, text);

-- Davet kartı: ilan türü kalkar
delete from public.dm_messages where kind = 'match' and listing_id is not null and poll_id is null and match_id is null;
alter table public.dm_messages drop constraint dm_messages_shape_check;
alter table public.dm_messages drop column listing_id;
alter table public.dm_messages
  add constraint dm_messages_shape_check check (
    kind = 'text'
    or (kind = 'invite' and invite_id is not null)
    or (kind = 'match' and card is not null and (poll_id is not null or match_id is not null))
  );

drop table public.listing_applications;
drop table public.player_listings;
drop function if exists public.listing_group(uuid);

-- ---------------------------------------------------------------------------
-- 2) Çağrı tablosu
-- ---------------------------------------------------------------------------
update public.match_polls set status = 'closed' where status = 'open';

alter table public.match_polls
  add column purpose text not null default 'gather' check (purpose in ('gather', 'fill')),
  add column play_on date,
  add column positions text[] not null default '{}' check (positions <@ array['GK', 'DEF', 'MID', 'FWD']);
update public.match_polls set play_on = (starts_at at time zone 'Europe/Istanbul')::date;
alter table public.match_polls
  alter column play_on set not null,
  alter column starts_at drop not null,
  alter column capacity drop not null,
  alter column capacity drop default,
  drop column auto_match;
alter table public.match_polls rename column deadline to decide_by;
alter table public.match_polls drop constraint match_polls_status_check;
alter table public.match_polls
  add constraint match_polls_status_check check (status in ('open', 'filled', 'closed', 'converted')),
  add constraint match_polls_fill_shape check (purpose <> 'fill' or (match_id is not null and capacity between 1 and 10));
create index on public.match_polls (match_id);
create index on public.match_polls (group_id, status);

-- ---------------------------------------------------------------------------
-- 3) Yanıtlar: hesaba bağlı
-- ---------------------------------------------------------------------------
alter table public.poll_responses
  add column user_id uuid references public.profiles (id) on delete cascade,
  add column position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  add column note text check (char_length(note) <= 200),
  -- null: bekliyor; selected: kadroda; reserve: yedek; rejected: organizatör almadı; withdrawn: kadrodan çıktı
  add column status text check (status in ('selected', 'reserve', 'rejected', 'withdrawn'));
update public.poll_responses r set user_id = gp.user_id from public.group_players gp where gp.id = r.player_id;
delete from public.poll_responses where user_id is null;
update public.poll_responses set status = 'selected' where approved;
alter table public.poll_responses drop constraint poll_responses_pkey;
alter table public.poll_responses
  drop column approved,
  drop column player_id,
  alter column user_id set not null,
  add primary key (poll_id, user_id),
  add constraint poll_responses_status_answer check (status is null or status in ('withdrawn', 'rejected') or answer = 'yes');
create index on public.poll_responses (user_id);

-- ---------------------------------------------------------------------------
-- 4) Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.istanbul_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Istanbul')::date
$$;

-- Kurucu/yetkili dışındakiler aynı grupta en fazla 3 açık çağrı
create or replace function public.check_poll_limit(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) and (
    select count(*) from match_polls where group_id = p_group and created_by = auth.uid() and status = 'open'
  ) >= 3 then
    raise exception 'Aynı anda en fazla 3 açık çağrın olabilir';
  end if;
end;
$$;
revoke all on function public.check_poll_limit(uuid) from public, anon, authenticated;

-- Hesabı maçın grubundaki oyuncu satırına bağla: üyeyse kendisi, değilse ödünç (ayrılmışsa ödünç olarak yeniden açılır)
create or replace function public.ensure_match_player(p_group uuid, p_user uuid, p_position text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_gp group_players;
  v_name text;
  v_pref text;
begin
  select * into v_gp from group_players where group_id = p_group and user_id = p_user;
  if v_gp.id is not null and v_gp.left_at is null then
    return v_gp.id;
  end if;
  select display_name, preferred_position into v_name, v_pref from profiles where id = p_user;
  if v_gp.id is not null then
    update group_players set left_at = null, is_loan = true, role = 'member' where id = v_gp.id;
    return v_gp.id;
  end if;
  insert into group_players (group_id, user_id, display_name, position, is_loan)
  values (p_group, p_user, coalesce(v_name, 'Oyuncu'), coalesce(p_position, v_pref), true)
  returning id into v_gp.id;
  return v_gp.id;
end;
$$;
revoke all on function public.ensure_match_player(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Çağrı açma
-- ---------------------------------------------------------------------------
-- Toplama çağrısı: "Cuma kimler gelir?"
create or replace function public.create_gather_poll(
  p_group uuid, p_play_on date, p_starts_at timestamptz default null, p_venue text default null,
  p_team_size smallint default null, p_capacity smallint default null, p_decide_by timestamptz default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  if not public.can_create_match(p_group) then
    raise exception 'Çağrıyı sadece kurucu, yetkili ve organizatörler açar';
  end if;
  if p_play_on is null or p_play_on < public.istanbul_today() then
    raise exception 'Maç günü bugün veya sonrası olmalı';
  end if;
  if p_play_on > public.istanbul_today() + 30 then
    raise exception 'Maç günü en fazla 30 gün sonrası olabilir';
  end if;
  if p_starts_at is not null and (p_starts_at <= now() or (p_starts_at at time zone 'Europe/Istanbul')::date <> p_play_on) then
    raise exception 'Saat, seçilen günde ve gelecekte olmalı';
  end if;
  if p_team_size is not null and p_team_size not between 5 and 11 then
    raise exception 'Kişi sayısı 5 ile 11 arasında olmalı';
  end if;
  if p_capacity is not null and p_capacity not between 2 and 40 then
    raise exception 'Kontenjan 2 ile 40 arasında olmalı';
  end if;
  if p_decide_by is not null and (p_decide_by <= now() or (p_decide_by at time zone 'Europe/Istanbul')::date > p_play_on) then
    raise exception 'Karar zamanı gelecekte ve en geç maç günü olmalı';
  end if;
  perform public.check_poll_limit(p_group);

  insert into match_polls (group_id, created_by, purpose, play_on, starts_at, venue, team_size, capacity, decide_by, note)
  values (p_group, auth.uid(), 'gather', p_play_on, p_starts_at, nullif(btrim(p_venue), ''), p_team_size,
          coalesce(p_capacity, p_team_size * 2), p_decide_by, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Adam ara: planlanmış maçın eksiği; maçın grubunda veya organizatörün maç açabildiği bir toplulukta
create or replace function public.create_fill_poll(
  p_match uuid, p_needed smallint, p_positions text[] default '{}', p_note text default null, p_group uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_group uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then
    raise exception 'Adam aramayı sadece maçı kuran, kaptan veya yetkililer açar';
  end if;
  if v_m.status <> 'planned' or v_m.played_at <= now() then
    raise exception 'Adam sadece planlanmış, gelecekteki maç için aranır';
  end if;
  v_group := coalesce(p_group, v_m.group_id);
  if v_group <> v_m.group_id and public.group_kind(v_group) is distinct from 'community' then
    raise exception 'Başka bir yerde sadece toplulukta adam aranır';
  end if;
  if not public.can_create_match(v_group) then
    raise exception 'Bu toplulukta çağrı açma yetkin yok (kurucu, yetkili veya organizatör olmalısın)';
  end if;
  if p_needed is null or p_needed not between 1 and 10 then
    raise exception 'Aranan oyuncu sayısı 1 ile 10 arasında olmalı';
  end if;
  if exists (select 1 from unnest(coalesce(p_positions, '{}'::text[])) x where x not in ('GK', 'DEF', 'MID', 'FWD')) then
    raise exception 'Geçersiz mevki';
  end if;
  if exists (select 1 from match_polls where match_id = p_match and purpose = 'fill' and group_id = v_group and status = 'open') then
    raise exception 'Bu maç için burada zaten açık bir adam arama var';
  end if;
  perform public.check_poll_limit(v_group);

  insert into match_polls (group_id, created_by, purpose, play_on, starts_at, venue, team_size, capacity, positions, note, match_id)
  values (v_group, auth.uid(), 'fill', (v_m.played_at at time zone 'Europe/Istanbul')::date, v_m.played_at, v_m.venue,
          v_m.team_size, p_needed, coalesce(p_positions, '{}'::text[]), nullif(btrim(p_note), ''), p_match)
  returning id into v_id;
  return v_id;
end;
$$;

-- Çağrıyı düzenle (toplama çağrısında bilgiler netleştikçe)
create or replace function public.update_gather_poll(
  p_poll uuid, p_starts_at timestamptz, p_venue text, p_team_size smallint, p_capacity smallint,
  p_decide_by timestamptz, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
begin
  select * into v_p from match_polls where id = p_poll;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll) then raise exception 'Çağrıyı sadece açan kişi veya yetkililer düzenler'; end if;
  if v_p.purpose <> 'gather' or v_p.status <> 'open' then raise exception 'Bu çağrı düzenlenemez'; end if;
  if p_starts_at is not null and (p_starts_at <= now() or (p_starts_at at time zone 'Europe/Istanbul')::date <> v_p.play_on) then
    raise exception 'Saat, çağrının gününde ve gelecekte olmalı';
  end if;
  if p_team_size is not null and p_team_size not between 5 and 11 then
    raise exception 'Kişi sayısı 5 ile 11 arasında olmalı';
  end if;
  if p_capacity is not null and p_capacity not between 2 and 40 then
    raise exception 'Kontenjan 2 ile 40 arasında olmalı';
  end if;
  if p_decide_by is not null and (p_decide_by at time zone 'Europe/Istanbul')::date > v_p.play_on then
    raise exception 'Karar zamanı en geç maç günü olmalı';
  end if;
  update match_polls
     set starts_at = p_starts_at, venue = nullif(btrim(p_venue), ''), team_size = p_team_size,
         capacity = coalesce(p_capacity, p_team_size * 2), decide_by = p_decide_by, note = nullif(btrim(p_note), '')
   where id = p_poll;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Yanıt
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
  if not public.is_group_member(v_p.group_id) then raise exception 'Bu çağrıya sadece üyeler yanıt verir'; end if;
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
        -- sıra: "geliyorum" dendiği an; geliyorum → geliyorum sırayı korur
        responded_at = case when poll_responses.answer = 'yes' and excluded.answer = 'yes'
                            then poll_responses.responded_at else now() end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Kesinleştirme (toplama çağrısı → maç)
-- ---------------------------------------------------------------------------
-- p_roster: [{"user_id": "...", "team": "A"|"B", "gk": true|false}] (taraflar uygulamada dengelenir; rakip maçında hepsi A)
create or replace function public.finalize_poll(
  p_poll uuid, p_starts_at timestamptz, p_venue text, p_team_size smallint, p_kind text,
  p_team uuid default null, p_opponent text default null, p_roster jsonb default '[]'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
  v_group uuid;
  v_match uuid;
  v_e jsonb;
  v_user uuid;
  v_resp poll_responses;
  v_gp uuid;
  v_pos text;
  v_count integer := jsonb_array_length(coalesce(p_roster, '[]'));
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
    if p_team is null or public.group_kind(p_team) is distinct from 'team' then
      raise exception 'Rakibe karşı maç için bir takım seçin';
    end if;
    if not public.can_create_match(p_team) then
      raise exception 'Bu takımda maç kurma yetkin yok';
    end if;
    if char_length(btrim(coalesce(p_opponent, ''))) < 2 then raise exception 'Rakip takımın adını yazın'; end if;
    if v_count < 2 then raise exception 'En az 2 oyuncu seçin'; end if;
    v_group := p_team;
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
    if p_kind = 'internal' then
      select id into v_gp from group_players
       where group_id = v_group and user_id = v_user and left_at is null and not is_loan;
      if v_gp is null then raise exception 'Seçilen bir oyuncu artık topluluğun üyesi değil'; end if;
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

  -- Seçilmeyen "geliyorum"cular yedek
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
-- 8) Tek tek kabul / ret (adam ara başvuranı veya toplama çağrısının yedeği)
-- ---------------------------------------------------------------------------
create or replace function public.accept_responder(p_poll uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
  v_m matches;
  v_r poll_responses;
  v_gp uuid;
  v_pos text;
  v_a integer;
  v_total integer;
  v_name text;
begin
  select * into v_p from match_polls where id = p_poll for update;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll) then raise exception 'Kadroya sadece çağrıyı açan kişi veya yetkililer alır'; end if;
  if v_p.match_id is null then raise exception 'Önce kadroyu kesinleştir'; end if;
  select * into v_m from matches where id = v_p.match_id;
  if v_m.status <> 'planned' then raise exception 'Maç artık kadro değişikliğine kapalı'; end if;
  if v_p.purpose = 'fill' and v_p.status <> 'open' then raise exception 'Aranan oyuncu sayısı doldu veya arama kapandı'; end if;
  if v_p.purpose = 'gather' and v_p.status <> 'converted' then raise exception 'Bu çağrıdan kadroya alınamaz'; end if;
  select * into v_r from poll_responses where poll_id = p_poll and user_id = p_user for update;
  if v_r.poll_id is null or v_r.answer <> 'yes' or v_r.status in ('selected', 'rejected') then
    raise exception 'Bekleyen "geliyorum" yanıtı bulunamadı';
  end if;

  select coalesce(v_r.position, preferred_position), display_name into v_pos, v_name from profiles where id = p_user;
  v_gp := public.ensure_match_player(v_m.group_id, p_user, v_pos);
  select count(*) filter (where team = 'A'), count(*) into v_a, v_total from match_players where match_id = v_m.id;
  insert into match_players (match_id, player_id, team, position, is_goalkeeper)
  values (v_m.id, v_gp, case when v_m.kind = 'external' or v_a <= v_total - v_a then 'A' else 'B' end,
          v_pos, coalesce(v_pos = 'GK', false))
  on conflict (match_id, player_id) do nothing;
  update poll_responses set status = 'selected' where poll_id = p_poll and user_id = p_user;

  if v_p.purpose = 'fill' and (select count(*) from poll_responses where poll_id = p_poll and status = 'selected') >= v_p.capacity then
    update match_polls set status = 'filled' where id = p_poll;
  end if;
  insert into group_messages (group_id, kind, body, match_id)
  values (v_m.group_id, 'system', '🤝 ' || coalesce(v_name, 'Bir oyuncu') || ' maç kadrosuna alındı.', v_m.id);
end;
$$;

create or replace function public.reject_responder(p_poll uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_poll(p_poll) then raise exception 'Bu işlemi sadece çağrıyı açan kişi veya yetkililer yapar'; end if;
  update poll_responses set status = 'rejected'
   where poll_id = p_poll and user_id = p_user and answer = 'yes' and (status is null or status = 'reserve');
  if not found then raise exception 'Bekleyen "geliyorum" yanıtı bulunamadı'; end if;
end;
$$;

-- Çağrıyı kapat (iptal; adam aramayı durdur). Kesinleşmiş çağrı kapatılamaz.
create or replace function public.close_poll(p_poll_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
begin
  select * into v_p from match_polls where id = p_poll_id;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll_id) then
    raise exception 'Çağrıyı sadece açan kişi veya yetkili kapatabilir';
  end if;
  if v_p.status not in ('open', 'filled') then
    raise exception 'Bu çağrı zaten kapalı veya maça dönüştü';
  end if;
  update match_polls set status = 'closed' where id = p_poll_id;
end;
$$;

-- Yanıtlayanlar: ad, mevki, not, durum; organizatöre ayrıca rating ve güvenilirlik (rating hesap bazında user_ratings'te)
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
     and (public.is_group_member(public.poll_group(p_poll)) or public.can_manage_poll(p_poll))
   order by r.responded_at
$$;

-- Günü geçmiş açık çağrıları kapat (cron yok; sayfa açılışında çağrılır)
create or replace function public.close_stale_polls(p_group uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not public.is_group_member(p_group) then return 0; end if;
  update match_polls set status = 'closed'
   where group_id = p_group and status in ('open', 'filled') and play_on < public.istanbul_today();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_gather_poll(uuid, date, timestamptz, text, smallint, smallint, timestamptz, text)',
    'create_fill_poll(uuid, smallint, text[], text, uuid)',
    'update_gather_poll(uuid, timestamptz, text, smallint, smallint, timestamptz, text)',
    'respond_poll(uuid, text, text, text)',
    'finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb)',
    'accept_responder(uuid, uuid)', 'reject_responder(uuid, uuid)', 'close_poll(uuid)',
    'poll_responders(uuid)', 'close_stale_polls(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Çağrı tablosuna doğrudan yazma yok (kurallar RPC'lerde); okuma politikası aynı kalır
drop policy if exists "çağrı açar" on public.match_polls;
drop policy if exists "çağrıyı düzenler" on public.match_polls;
drop policy if exists "çağrıyı siler" on public.match_polls;
-- Yanıtlar: çağrının grubunun üyeleri görür (politika poll_group üzerinden; değişmedi)

-- ---------------------------------------------------------------------------
-- 9) Tetikleyiciler
-- ---------------------------------------------------------------------------
-- Kadrodan çıkan (çekilme, "gelmedi", kaptan çıkardı) seçilmiş yanıt 'withdrawn' olur; dolmuş adam arama yeniden açılır
create or replace function public.release_poll_spot_on_roster_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  select user_id into v_user from group_players where id = old.player_id;
  if v_user is null then return old; end if;
  update poll_responses r set status = 'withdrawn'
    from match_polls p
   where p.id = r.poll_id and p.match_id = old.match_id and r.user_id = v_user and r.status = 'selected';
  update match_polls p set status = 'open'
   where p.match_id = old.match_id and p.purpose = 'fill' and p.status = 'filled'
     and exists (select 1 from matches m where m.id = old.match_id and m.status = 'planned')
     and (select count(*) from poll_responses r where r.poll_id = p.id and r.status = 'selected') < p.capacity;
  return old;
end;
$$;
create trigger release_poll_spot_on_roster_removal after delete on public.match_players
  for each row execute function public.release_poll_spot_on_roster_removal();

-- Maç planlıdan çıkınca (sonuç, oylama, iptal) açık adam arama kapanır
create or replace function public.close_fill_polls_on_match_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update match_polls set status = 'closed' where match_id = new.id and purpose = 'fill' and status in ('open', 'filled');
  return new;
end;
$$;
create trigger close_fill_polls_on_match_change after update of status on public.matches
  for each row when (old.status = 'planned' and new.status <> 'planned')
  execute function public.close_fill_polls_on_match_change();

-- Sohbette çağrı duyurusu: saat belli değilse sadece gün
create or replace function public.chat_on_poll()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_messages (group_id, kind, body, poll_id)
  values (new.group_id, 'system',
          case when new.purpose = 'fill'
            then '🔎 Adam aranıyor: ' || new.capacity || ' kişi · ' || public.chat_tr_date(new.starts_at)
                 || coalesce(' · ' || new.venue, '')
            else '📣 Maç çağrısı: ' || coalesce(public.chat_tr_date(new.starts_at), to_char(new.play_on, 'DD.MM') || ' (saat belli değil)')
                 || coalesce(' · ' || new.venue, '') || coalesce(' · ' || new.capacity || ' kişi', '')
          end,
          new.id);
  return new;
end;
$$;

-- Ayrılan üye: açık çağrılardaki bekleyen/yedek yanıtları silinir (kadrodan çıkarma deactivate_member'da)
create or replace function public.deactivate_member(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_gp group_players;
begin
  select * into v_gp from group_players where id = p_player_id;
  delete from match_players mp using matches m
   where m.id = mp.match_id and mp.player_id = p_player_id and m.status = 'planned';
  if v_gp.user_id is not null then
    delete from poll_responses pr using match_polls p
     where p.id = pr.poll_id and p.group_id = v_gp.group_id and pr.user_id = v_gp.user_id
       and p.status in ('open', 'filled', 'converted') and (pr.status is null or pr.status = 'reserve');
  end if;
  update group_players set left_at = now() where id = p_player_id;
end;
$$;
revoke all on function public.deactivate_member(uuid) from public, anon, authenticated;

-- Davet kartı: ilan türü kalktı; çağrı kartı adam aramayı ve saati belli olmayan çağrıyı da taşır
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

  -- Kaptan/yetkili her şeyi; organizatör kendi çağrısını ve kendi kurduğu maçı paylaşabilir (0034)
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
  return v_id;
end;
$$;

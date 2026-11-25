-- Tek maç kaydı (yeniden tasarım, 1. parça; kullanıcı kararları 2026-11-25).
-- "Maç ayarla" en baştan bir maç açar: toplanıyor (gathering) → kesin (planned) → oynandı/oylama → kapandı, yan yol iptal.
--  * Kapasite (capacity) = bizim tarafın kişi sayısı (rakibe karşı team_size, kendi aramızda 2×team_size varsayılan).
--  * "Geliyorum" diyen yer varsa direkt kadroya (match_players), doluysa yedeğe; aynı anda gelenler maç satırı kilitlenerek sıralanır.
--  * Toplanırken kadrodan çıkmak serbest; kesin maçta onaylı çekilme (0022), ertelemeden sonraki 24 saat serbest.
--  * Yedekten kadroya organizatör alır (maça 3 saat kala otomatik: 3. parça). Misafiri sadece kaptan/yetkili ekler.
--  * İptal edilen maç silinmez (status = cancelled). Sonuçsuz (no_result) 3. parçada otomatik.
-- match_entries: kimin nasıl yanıt verdiği (kadro, yedek, gelemem, çekildi). Kadronun asıl kaydı yine match_players;
-- tetikleyiciler ikisini eş tutar (status = 'in' ⇔ match_players'ta satır).
-- Not: yeni enum değerleri bu dosyada SQL olarak kullanılmaz (aynı işlemde "unsafe use"); sadece plpgsql gövdelerinde.

-- ---------------------------------------------------------------------------
-- 1) Maç alanları
-- ---------------------------------------------------------------------------
alter type public.match_status add value if not exists 'gathering';
alter type public.match_status add value if not exists 'cancelled';
alter type public.match_status add value if not exists 'no_result';

alter table public.matches
  add column time_tbd boolean not null default false,
  add column capacity smallint check (capacity between 2 and 30),
  add column open_to_members boolean not null default false,
  add column note text check (char_length(note) <= 300),
  add column confirmed_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id) on delete set null,
  add column cancel_reason text check (char_length(cancel_reason) <= 200),
  add column free_withdraw_until timestamptz;

-- Rakip toplanırken belli olmayabilir ("sonra"); kesinleştirmede zorunlu (confirm_match)
alter table public.matches drop constraint external_has_opponent;
alter table public.matches
  add constraint external_has_opponent
    check (kind = 'internal' or opponent_name is null or char_length(btrim(opponent_name)) >= 2);

-- ---------------------------------------------------------------------------
-- 2) Yanıt / kadro / yedek kaydı
-- ---------------------------------------------------------------------------
create table public.match_entries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  -- Misafirde boş
  user_id uuid references public.profiles (id) on delete cascade,
  -- Kadrodaki satır (misafir ve kadroya girmiş olanlar); yedekte boş olabilir
  player_id uuid references public.group_players (id) on delete cascade,
  -- in: kadroda · reserve: yedek · declined: gelemem · left: çekildi/çıkarıldı
  status text not null check (status in ('in', 'reserve', 'declined', 'left')),
  -- organizer: yetkili yazdı · member: üye yanıtı · guest: misafir
  source text not null check (source in ('organizer', 'member', 'guest')),
  position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  note text check (char_length(note) <= 200),
  queued_at timestamptz,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or player_id is not null)
);
create unique index match_entries_user on public.match_entries (match_id, user_id) where user_id is not null;
create unique index match_entries_player on public.match_entries (match_id, player_id) where player_id is not null;
create index on public.match_entries (user_id);
create index on public.match_entries (match_id, status);
alter table public.match_entries enable row level security;
create policy "maç yanıtlarını görür" on public.match_entries
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)) or user_id = auth.uid() or public.can_manage_match(match_id));
-- Yazma sadece RPC/tetikleyici

-- Kadroya giren her satır kayıtta "in" olur (eski yollar: addToMatch, teklif, çağrı kesinleştirme)
create or replace function public.entry_on_roster_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  select user_id into v_user from group_players where id = new.player_id;
  update match_entries set status = 'in', player_id = new.player_id, updated_at = now()
   where match_id = new.match_id
     and ((v_user is not null and user_id = v_user) or player_id = new.player_id);
  if not found then
    insert into match_entries (match_id, user_id, player_id, status, source, added_by)
    values (new.match_id, v_user, new.player_id, 'in',
            case when v_user is null then 'guest' when v_user = auth.uid() then 'member' else 'organizer' end, auth.uid());
  end if;
  return new;
end;
$$;
create trigger entry_on_roster_insert after insert on public.match_players
  for each row execute function public.entry_on_roster_insert();

-- Kadrodan başka yolla çıkan (kaptan çıkardı, onaylı çekilme, ayrıldı) "left" olur; RPC önceden declined yazdıysa dokunmaz
create or replace function public.entry_on_roster_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update match_entries set status = 'left', updated_at = now()
   where match_id = old.match_id and player_id = old.player_id and status = 'in';
  return old;
end;
$$;
create trigger entry_on_roster_delete after delete on public.match_players
  for each row execute function public.entry_on_roster_delete();

-- Mevcut kadrolar kayda geçer
insert into public.match_entries (match_id, user_id, player_id, status, source)
select mp.match_id, gp.user_id, mp.player_id, 'in', case when gp.user_id is null then 'guest' else 'organizer' end
  from public.match_players mp join public.group_players gp on gp.id = mp.player_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function public.match_roster_count(p_match uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from match_players where match_id = p_match
$$;

-- Maç saati geçti mi (saati belli değilse gün sonu)
create or replace function public.match_time_passed(p_m matches)
returns boolean language sql stable as $$
  select case when p_m.time_tbd
              then (p_m.played_at at time zone 'Europe/Istanbul')::date < public.istanbul_today()
              else p_m.played_at <= now() end
$$;

-- Kadroya kişi yazar (üye satırı yoksa ödünç açılır); takım: rakibe karşı hep A, kendi aramızda kesinleşince bölünür
create or replace function public.put_in_roster(p_m matches, p_user uuid, p_pos text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_gp uuid;
  v_pos text;
begin
  select coalesce(p_pos, preferred_position) into v_pos from profiles where id = p_user;
  v_gp := public.ensure_match_player(p_m.group_id, p_user, v_pos);
  insert into match_players (match_id, player_id, team, position, is_goalkeeper)
  values (p_m.id, v_gp, 'A', v_pos, coalesce(v_pos = 'GK', false))
  on conflict (match_id, player_id) do nothing;
  return v_gp;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['match_roster_count(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.match_time_passed(matches) from public, anon, authenticated;
revoke all on function public.put_in_roster(matches, uuid, text) from public, anon, authenticated;
revoke all on function public.entry_on_roster_insert() from public, anon, authenticated;
revoke all on function public.entry_on_roster_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Maç ayarla
-- ---------------------------------------------------------------------------
-- p_time boşsa saat belli değil. p_guests: [{"name": "...", "position": "FWD"}] (sadece kaptan/yetkili).
-- Kadro dolu ve saat belliyse maç direkt kesin açılır (anlaşılmış maç için boşuna toplama yok).
create or replace function public.create_match_v2(
  p_group uuid, p_day date, p_time time, p_team_size smallint, p_kind text,
  p_opponent text default null, p_venue text default null, p_note text default null, p_capacity smallint default null,
  p_with_me boolean default true, p_confirmed uuid[] default '{}', p_guests jsonb default '[]', p_announce boolean default true
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
  if jsonb_array_length(coalesce(p_guests, '[]')) > 0 and not public.is_group_admin(p_group) then
    raise exception 'Misafiri sadece kaptan veya yetkili ekler';
  end if;
  if (coalesce(array_length(p_confirmed, 1), 0) + (case when p_with_me then 1 else 0 end)
     + jsonb_array_length(coalesce(p_guests, '[]'))) > v_cap then
    raise exception 'Seçilen oyuncular kadro sayısını aşıyor';
  end if;

  insert into matches (group_id, played_at, time_tbd, venue, created_by, kind, opponent_name, team_size,
                       capacity, open_to_members, note, status)
  values (p_group, v_when, p_time is null, nullif(btrim(p_venue), ''), v_me, p_kind,
          case when p_kind = 'external' then nullif(left(btrim(p_opponent), 60), '') end, p_team_size,
          v_cap, coalesce(p_announce, true), nullif(left(btrim(p_note), 300), ''), 'gathering')
  returning * into v_m;
  v_id := v_m.id;

  if p_with_me then
    perform public.put_in_roster(v_m, v_me, null);
    update match_entries set source = 'member' where match_id = v_id and user_id = v_me;
  end if;
  foreach v_u in array coalesce(p_confirmed, '{}') loop
    if v_u = v_me then continue; end if;
    if not exists (select 1 from group_players where group_id = p_group and user_id = v_u and left_at is null and not is_loan) then
      raise exception 'Kesin gelen olarak sadece üyeler seçilir';
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

-- ---------------------------------------------------------------------------
-- 5) Geliyorum / Gelemem
-- ---------------------------------------------------------------------------
-- Döner: 'in' (kadroda) · 'reserve' (yedek) · 'declined'
create or replace function public.respond_match(p_match uuid, p_answer text, p_position text default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_m matches;
  v_e match_entries;
  v_in boolean;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  if p_answer not in ('yes', 'no') then raise exception 'Geçersiz yanıt'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maça artık yanıt verilemez'; end if;
  if public.match_time_passed(v_m) then raise exception 'Maç saati geçti'; end if;
  select * into v_e from match_entries where match_id = p_match and user_id = v_me;
  v_in := exists (select 1 from match_players mp join group_players gp on gp.id = mp.player_id
                   where mp.match_id = p_match and gp.user_id = v_me);
  if v_e.id is null and not (v_m.open_to_members and public.is_group_member(v_m.group_id)) then
    raise exception 'Bu maça sadece takımın/grubun üyeleri ve çağrılanlar yanıt verir';
  end if;

  if p_answer = 'no' then
    if v_in and v_m.status::text = 'planned' and coalesce(v_m.free_withdraw_until, '-infinity') < now() then
      raise exception 'Maç kesinleşti; kadrodan çıkmak için çekilme isteği gönder';
    end if;
    update match_entries set status = 'declined', note = nullif(btrim(p_note), ''), updated_at = now()
     where id = v_e.id;
    if v_in then
      delete from match_players mp using group_players gp
       where gp.id = mp.player_id and mp.match_id = p_match and gp.user_id = v_me;
    end if;
    if v_e.id is null then
      insert into match_entries (match_id, user_id, status, source, note)
      values (p_match, v_me, 'declined', 'member', nullif(btrim(p_note), ''));
    end if;
    return 'declined';
  end if;

  if v_in then
    update match_entries set position = coalesce(p_position, position), note = coalesce(nullif(btrim(p_note), ''), note), updated_at = now()
     where id = v_e.id;
    return 'in';
  end if;
  if public.match_roster_count(p_match) < v_m.capacity then
    perform public.put_in_roster(v_m, v_me, p_position);
    update match_entries set source = case when v_e.id is null then 'member' else source end,
           position = p_position, note = nullif(btrim(p_note), ''), queued_at = null, updated_at = now()
     where match_id = p_match and user_id = v_me;
    return 'in';
  end if;
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, position, note, queued_at)
    values (p_match, v_me, 'reserve', 'member', p_position, nullif(btrim(p_note), ''), now());
  else
    update match_entries set status = 'reserve', position = p_position, note = nullif(btrim(p_note), ''),
           queued_at = case when status = 'reserve' then queued_at else now() end, updated_at = now()
     where id = v_e.id;
  end if;
  return 'reserve';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Yönetim: kesin gelen ekle, yedekten al, kadrodan çıkar; misafir
-- ---------------------------------------------------------------------------
create or replace function public.manage_entry(p_match uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Kadroyu sadece maçı kuran kişi veya yetkililer düzenler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  select * into v_e from match_entries where match_id = p_match and user_id = p_user;

  if p_action = 'add' then
    if not exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is null and not is_loan) then
      raise exception 'Kesin gelen olarak sadece üyeler eklenir';
    end if;
    if v_e.status = 'in' then return; end if;
    if public.match_roster_count(p_match) >= v_m.capacity then raise exception 'Kadro dolu'; end if;
    perform public.put_in_roster(v_m, p_user, v_e.position);
    update match_entries set source = case when v_e.id is null then 'organizer' else source end,
           added_by = auth.uid(), queued_at = null, updated_at = now()
     where match_id = p_match and user_id = p_user;
  elsif p_action = 'promote' then
    if v_e.status is distinct from 'reserve' then raise exception 'Bu kişi yedekte değil'; end if;
    if public.match_roster_count(p_match) >= v_m.capacity then raise exception 'Kadro dolu; önce yer açılmalı'; end if;
    perform public.put_in_roster(v_m, p_user, v_e.position);
    update match_entries set queued_at = null, updated_at = now() where id = v_e.id;
  elsif p_action = 'remove' then
    if v_e.id is null or v_e.status not in ('in', 'reserve') then raise exception 'Bu kişi kadroda veya yedekte değil'; end if;
    update match_entries set status = 'left', queued_at = null, updated_at = now() where id = v_e.id;
    delete from match_players mp using group_players gp
     where gp.id = mp.player_id and mp.match_id = p_match and gp.user_id = p_user;
  else
    raise exception 'Geçersiz işlem';
  end if;
end;
$$;

-- 0034 sürümünün yerine: misafiri sadece kaptan/yetkili ekler (kullanıcı kararı); toplanan maçta da; kapasite aşılmaz.
-- Kendi aramızda kesin maçta misafir az olan tarafa yazılır (0034 gibi), toplanırken herkes A (kesinleşince bölünür).
create or replace function public.add_match_guest(p_match uuid, p_name text, p_position text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_gp uuid;
  v_a integer;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.is_group_admin(v_m.group_id) then raise exception 'Misafiri sadece kaptan veya yetkili ekler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Misafir adı en az 2 karakter olmalı'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
  select count(*) filter (where team = 'A'), count(*) into v_a, v_total from match_players where match_id = p_match;
  if v_m.capacity is not null and v_total >= v_m.capacity then raise exception 'Kadro dolu'; end if;
  insert into group_players (group_id, display_name, position) values (v_m.group_id, left(btrim(p_name), 40), p_position)
  returning id into v_gp;
  insert into match_players (match_id, player_id, team, position, is_goalkeeper)
  values (p_match, v_gp,
          case when v_m.kind = 'external' or v_m.status::text = 'gathering' or v_a <= v_total - v_a then 'A' else 'B' end,
          p_position, coalesce(p_position = 'GK', false));
  return v_gp;
end;
$$;

-- Misafir satırı bu maç için açıldıysa (başka maçı yoksa) tamamen silinir
create or replace function public.remove_match_guest(p_match uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.is_group_admin(v_m.group_id) then raise exception 'Misafiri sadece kaptan veya yetkili çıkarır'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  if not exists (select 1 from group_players where id = p_player and group_id = v_m.group_id and user_id is null) then
    raise exception 'Misafir bulunamadı';
  end if;
  delete from match_players where match_id = p_match and player_id = p_player;
  delete from match_entries where match_id = p_match and player_id = p_player;
  if not exists (select 1 from match_players where player_id = p_player) then
    delete from group_players where id = p_player;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Rakip, kesinleştir, ertele, iptal
-- ---------------------------------------------------------------------------
create or replace function public.set_match_opponent(p_match uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Rakibi sadece maçı kuran kişi veya yetkililer belirler'; end if;
  if v_m.kind <> 'external' then raise exception 'Kendi aramızdaki maçta rakip olmaz'; end if;
  if v_m.challenge_id is not null then raise exception 'Bu maç bir teklifle bağlı; rakip değiştirilemez'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maç artık değişmez'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Rakip adı en az 2 karakter olmalı'; end if;
  update matches set opponent_name = left(btrim(p_name), 60) where id = p_match;
end;
$$;

create or replace function public.confirm_match(p_match uuid, p_starts_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_count integer;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer kesinleştirir'; end if;
  if v_m.status::text <> 'gathering' then raise exception 'Bu maç toplanma aşamasında değil'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  if v_m.kind = 'external' and v_m.opponent_name is null and v_m.opponent_group_id is null then
    raise exception 'Kesinleştirmeden önce rakibi belirle';
  end if;
  v_count := public.match_roster_count(p_match);
  if v_count < (case when v_m.kind = 'internal' then 4 else 2 end) then
    raise exception 'Kesinleştirmek için kadroda en az % kişi olmalı', case when v_m.kind = 'internal' then 4 else 2 end;
  end if;
  update matches set status = 'planned', played_at = p_starts_at, time_tbd = false, confirmed_at = now() where id = p_match;
end;
$$;

-- Kadro korunur; kesin maçta 24 saat çekilme serbest. Teklifle bağlı maçta rakibin onayı gerekir (2. parça).
create or replace function public.reschedule_match(p_match uuid, p_day date, p_time time)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_when timestamptz;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer erteler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maç artık ertelenemez'; end if;
  if v_m.challenge_id is not null then raise exception 'Teklifle bağlı maçın tarihi rakiple birlikte değişir'; end if;
  if p_day is null or p_day < public.istanbul_today() then raise exception 'Maç günü bugün veya sonrası olmalı'; end if;
  if p_time is null and v_m.status::text = 'planned' then raise exception 'Kesin maçın saati belli olmalı'; end if;
  v_when := case when p_time is null then (p_day + time '12:00') at time zone 'Europe/Istanbul'
                 else (p_day + p_time) at time zone 'Europe/Istanbul' end;
  if p_time is not null and v_when <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  update matches
     set played_at = v_when, time_tbd = p_time is null,
         free_withdraw_until = case when v_m.status::text = 'planned' then now() + interval '24 hours' else free_withdraw_until end
   where id = p_match;
end;
$$;

-- İptal silmez; bağlı maçta iki taraf da iptal olur
create or replace function public.cancel_match(p_match uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
begin
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer iptal eder'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maç artık iptal edilemez'; end if;
  update matches
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(left(btrim(p_reason), 200), '')
   where (id = p_match or (v_m.challenge_id is not null and challenge_id = v_m.challenge_id))
     and status::text in ('gathering', 'planned');
  if v_m.challenge_id is not null then
    update match_challenges set status = 'cancelled' where id = v_m.challenge_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Çekilme: ertelemeden sonraki 24 saatte onaysız
-- ---------------------------------------------------------------------------
create or replace function public.request_withdrawal(p_match uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_me group_players;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match;
  if not found then raise exception 'Maç bulunamadı'; end if;
  if v_m.status <> 'planned' then
    raise exception 'Bu maç artık planlanmış değil; çekilme isteği gönderilemez';
  end if;
  if v_m.played_at <= now() then
    raise exception 'Maç saati geçti; kaptanla konuş (gelmezsen "gelmedi" işaretlenebilir)';
  end if;
  select gp.* into v_me
    from match_players mp join group_players gp on gp.id = mp.player_id
   where mp.match_id = p_match and gp.user_id = auth.uid() and gp.left_at is null
   limit 1;
  if not found then raise exception 'Bu maçın kadrosunda değilsin'; end if;
  if exists (select 1 from match_withdrawals where match_id = p_match and player_id = v_me.id and status = 'pending') then
    raise exception 'Zaten bekleyen bir çekilme isteğin var';
  end if;

  if public.can_manage_match(p_match) or coalesce(v_m.free_withdraw_until, '-infinity') > now() then
    insert into match_withdrawals (match_id, player_id, reason, late, status, decided_by, decided_at)
    values (p_match, v_me.id, nullif(btrim(p_reason), ''), v_m.played_at - now() < interval '3 hours', 'approved', auth.uid(), now());
    delete from match_players where match_id = p_match and player_id = v_me.id;
    return 'approved';
  end if;

  insert into match_withdrawals (match_id, player_id, reason, late)
  values (p_match, v_me.id, nullif(btrim(p_reason), ''), v_m.played_at - now() < interval '3 hours');
  return 'pending';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_match_v2(uuid, date, time, smallint, text, text, text, text, smallint, boolean, uuid[], jsonb, boolean)',
    'respond_match(uuid, text, text, text)', 'manage_entry(uuid, uuid, text)',
    'add_match_guest(uuid, text, text)', 'remove_match_guest(uuid, uuid)', 'set_match_opponent(uuid, text)',
    'confirm_match(uuid, timestamptz)', 'reschedule_match(uuid, date, time)', 'cancel_match(uuid, text)',
    'request_withdrawal(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9) Grup sohbetindeki sistem mesajları: toplanıyor / kesinleşti / iptal; rakip henüz yoksa ad yazılmaz
-- ---------------------------------------------------------------------------
create or replace function public.chat_on_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_when text := case when new.time_tbd
                      then to_char(new.played_at at time zone 'Europe/Istanbul', 'DD.MM') || ' (saat belli değil)'
                      else public.chat_tr_date(new.played_at) end;
  v_rest text := case when new.kind = 'external' and new.opponent_name is not null then ' · vs ' || new.opponent_name else '' end
                 || coalesce(' · ' || new.venue, '');
begin
  if tg_op = 'INSERT' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            case when new.status::text = 'gathering' then '📣 Maç ayarlanıyor: ' else '⚽ Maç kuruldu: ' end || v_when || v_rest,
            new.id);
  elsif new.status::text = 'planned' and old.status::text = 'gathering' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system', '✅ Maç kesinleşti: ' || v_when || v_rest, new.id);
  elsif new.status::text = 'cancelled' and old.status::text <> 'cancelled' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system', '❌ Maç iptal edildi: ' || v_when || coalesce(' · ' || new.cancel_reason, ''), new.id);
  elsif new.status = 'voting' and old.status in ('planned', 'played') then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            '🗳️ Maç bitti (' || new.score_a || '-' || new.score_b || '). Oylama açıldı, takım arkadaşlarını puanla!',
            new.id);
  end if;
  return new;
end;
$$;

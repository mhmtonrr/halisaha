-- Yeniden tasarım 2a (kullanıcı kararları 2026-11-25): maç görünürlüğü, canlı sayaç, ilan, kişiye özel davet,
-- paylaşılabilir kod ve başvuru onayı.
--  * can_view_match: grup/takım üyesi · maçta kaydı olan (kadro, yedek, davetli, başvuran, gelemem) · maça bağlı aktif
--    ilanı görebilen (Keşfet ilanı: herkes; grup ilanı: o grubun üyeleri). Görebilen maçı, kadroyu ve kadrodakilerin
--    kartlarını görür; grubun diğer maçları/üye listesi/sohbeti kapalı.
--  * Bağlantı (kod) sahibi başvurmadan önce maçı match_by_code ile görür (tabloya erişim yok).
--  * İlan: sadece maçın takımında/grubunda kaptan/yetkili/organizatör açar. Hedef grupta organizatör+ ise direkt aktif,
--    sıradan üyeyse o grubun kaptan/yetkilisinin onayına düşer. Keşfet ilanı direkt aktif. Maç başına en fazla 5.
--  * Kişiye özel davet (yöneten) → "geliyorum" onaysız kadro/yedek. Kadrodaki oyuncunun daveti ve ilan/bağlantı
--    başvurusu → maçı yönetenin onayına; dolu kadroda onaylanan yedeğe.
--  * Sayaç: matches.roster_count / reserve_count (tetikleyici); kartlar ve Realtime tek satırdan okur.

-- ---------------------------------------------------------------------------
-- 1) Sayaç
-- ---------------------------------------------------------------------------
alter table public.matches
  add column roster_count smallint not null default 0,
  add column reserve_count smallint not null default 0;

create or replace function public.refresh_match_counts(p_match uuid)
returns void language sql security definer set search_path = public as $$
  update matches m
     set roster_count = (select count(*) from match_players where match_id = p_match),
         reserve_count = (select count(*) from match_entries where match_id = p_match and status = 'reserve')
   where m.id = p_match
     and (m.roster_count, m.reserve_count) is distinct from
         ((select count(*) from match_players where match_id = p_match),
          (select count(*) from match_entries where match_id = p_match and status = 'reserve'))
$$;
revoke all on function public.refresh_match_counts(uuid) from public, anon, authenticated;

create or replace function public.counts_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_match_counts(case when tg_op = 'DELETE' then old.match_id else new.match_id end);
  return null;
end;
$$;
revoke all on function public.counts_on_change() from public, anon, authenticated;
create trigger counts_on_roster after insert or delete on public.match_players
  for each row execute function public.counts_on_change();
create trigger counts_on_entries after insert or update of status or delete on public.match_entries
  for each row execute function public.counts_on_change();

update public.matches m
   set roster_count = (select count(*) from public.match_players where match_id = m.id),
       reserve_count = (select count(*) from public.match_entries where match_id = m.id and status = 'reserve');

-- ---------------------------------------------------------------------------
-- 2) İlanlar
-- ---------------------------------------------------------------------------
create table public.match_listings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  -- Boşsa Keşfet (herkese açık)
  target_group_id uuid references public.groups (id) on delete cascade,
  status text not null check (status in ('pending', 'active', 'rejected', 'closed')),
  positions text[] not null default '{}' check (positions <@ array['GK', 'DEF', 'MID', 'FWD']),
  note text check (char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index match_listings_one_target on public.match_listings (match_id, coalesce(target_group_id, '00000000-0000-0000-0000-000000000000'))
  where status in ('pending', 'active');
create index on public.match_listings (status, target_group_id);
create index on public.match_listings (match_id);
alter table public.match_listings enable row level security;
-- Yazma sadece RPC

-- ---------------------------------------------------------------------------
-- 3) Kayıt: davet / başvuru durumları
-- ---------------------------------------------------------------------------
alter table public.match_entries drop constraint match_entries_status_check;
alter table public.match_entries drop constraint match_entries_source_check;
alter table public.match_entries
  add constraint match_entries_status_check
    check (status in ('in', 'reserve', 'declined', 'left', 'invited', 'pending', 'rejected')),
  add constraint match_entries_source_check
    check (source in ('organizer', 'member', 'guest', 'invite', 'link', 'listing')),
  add column listing_id uuid references public.match_listings (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4) Görünürlük
-- ---------------------------------------------------------------------------
create or replace function public.can_view_match(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
     where m.id = p_match
       and (public.is_group_visible(m.group_id)
            or exists (select 1 from match_entries e where e.match_id = m.id and e.user_id = auth.uid())
            or public.is_match_participant(m.id)
            or exists (select 1 from match_listings l
                        where l.match_id = m.id and l.status = 'active'
                          and (l.target_group_id is null or public.is_group_member(l.target_group_id))))
  )
$$;

-- Bu oyuncu satırını görebilirim: aynı maçta oynadım (0041) veya görebildiğim bir maçın kadrosunda
create or replace function public.can_see_player(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_co_player(p_player_id)
      or exists (select 1 from match_players mp where mp.player_id = p_player_id and public.can_view_match(mp.match_id))
$$;

-- Grubun adını görürüm: grubun açık bir maçında etkin kaydım var (ayrılan eski maçlarından adı görmez) veya maçına bağlı görebildiğim aktif ilan var
create or replace function public.can_see_group_name(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from match_entries e join matches m on m.id = e.match_id
                  where m.group_id = p_group_id and e.user_id = auth.uid()
                    and e.status in ('in', 'reserve', 'invited', 'pending')
                    and m.status::text in ('gathering', 'planned'))
      or exists (select 1 from match_listings l join matches m on m.id = l.match_id
                  where m.group_id = p_group_id and l.status = 'active'
                    and (l.target_group_id is null or public.is_group_member(l.target_group_id)))
$$;

-- İlanı görür: aktif ve hedefin üyesi (Keşfet: herkes) · açan · maçı yöneten · hedef grubun kaptan/yetkilisi
create or replace function public.can_view_listing(p_listing uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_listings l
     where l.id = p_listing
       and ((l.status = 'active' and (l.target_group_id is null or public.is_group_member(l.target_group_id)))
            or l.created_by = auth.uid()
            or public.can_manage_match(l.match_id)
            or (l.target_group_id is not null and public.is_group_admin(l.target_group_id)))
  )
$$;

do $$
declare
  f text;
begin
  foreach f in array array['can_view_match(uuid)', 'can_see_player(uuid)', 'can_see_group_name(uuid)', 'can_view_listing(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

create policy "ilanı görür" on public.match_listings
  for select to authenticated using (public.can_view_listing(id));

drop policy "grubu/takımı görür" on public.groups;
create policy "grubu/takımı görür" on public.groups
  for select to authenticated
  using (public.is_group_visible(id) or created_by = auth.uid() or public.has_group_row(id) or public.can_see_group_name(id));

drop policy "oyuncuları görür" on public.group_players;
create policy "oyuncuları görür" on public.group_players
  for select to authenticated
  using (public.is_group_visible(group_id) or user_id = auth.uid() or public.can_see_player(id));

drop policy "maçları görür" on public.matches;
create policy "maçları görür" on public.matches
  for select to authenticated using (public.is_group_visible(group_id) or public.can_view_match(id));

drop policy "kadroyu görür" on public.match_players;
create policy "kadroyu görür" on public.match_players
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)) or public.can_view_match(match_id));

drop policy "sonuçları görür" on public.match_results;
create policy "sonuçları görür" on public.match_results
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)) or public.can_view_match(match_id));

drop policy "ratingleri görür" on public.player_ratings;
create policy "ratingleri görür" on public.player_ratings
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
     where gp.id = player_id and (public.is_group_visible(gp.group_id) or public.can_see_player(gp.id))
  ));

drop policy "yetenekleri gör" on public.player_skills;
create policy "yetenekleri gör" on public.player_skills
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
     where gp.id = player_id and (public.is_group_visible(gp.group_id) or public.can_see_player(gp.id))
  ));

drop policy "kartı gör" on public.user_ratings;
create policy "kartı gör" on public.user_ratings
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
     where gp.user_id = user_ratings.user_id and (public.is_group_visible(gp.group_id) or public.can_see_player(gp.id))
  ));

drop policy "yetenekleri gör" on public.user_skills;
create policy "yetenekleri gör" on public.user_skills
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
     where gp.user_id = user_skills.user_id and (public.is_group_visible(gp.group_id) or public.can_see_player(gp.id))
  ));

-- Kayıtlar: maçı yöneten ve grup üyeleri hepsini, diğerleri sadece kendini (yedek/başvuran adları dışarıya açılmaz)
drop policy "maç yanıtlarını görür" on public.match_entries;
create policy "maç yanıtlarını görür" on public.match_entries
  for select to authenticated
  using (public.is_group_member(public.match_group(match_id)) or user_id = auth.uid() or public.can_manage_match(match_id)
         or (status = 'in' and public.can_view_match(match_id)));

-- ---------------------------------------------------------------------------
-- 5) İlan RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.create_listing(p_match uuid, p_target uuid default null, p_positions text[] default '{}', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_status text := 'active';
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_create_match(v_m.group_id) then
    raise exception 'İlanı sadece kaptan, yetkili veya organizatör açar';
  end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then
    raise exception 'Bu maç için artık adam aranamaz';
  end if;
  if p_positions is not null and not (p_positions <@ array['GK', 'DEF', 'MID', 'FWD']) then raise exception 'Geçersiz mevki'; end if;
  if p_target is not null then
    if p_target = v_m.group_id then raise exception 'Maçın kendi grubuna ilan açılmaz; üyeler maçı zaten görüyor'; end if;
    if not public.is_group_member(p_target) then raise exception 'İlanı sadece üyesi olduğun gruba paylaşabilirsin'; end if;
    if not public.can_create_match(p_target) then v_status := 'pending'; end if;
  end if;
  if (select count(*) from match_listings where match_id = p_match and status in ('pending', 'active')) >= 5 then
    raise exception 'Bir maça en fazla 5 ilan açılır';
  end if;
  if exists (select 1 from match_listings where match_id = p_match and status in ('pending', 'active')
              and target_group_id is not distinct from p_target) then
    raise exception 'Bu yerde zaten açık bir ilan var';
  end if;
  insert into match_listings (match_id, target_group_id, status, positions, note, created_by, decided_by, decided_at)
  values (p_match, p_target, v_status, coalesce(p_positions, '{}'), nullif(left(btrim(p_note), 200), ''), auth.uid(),
          case when v_status = 'active' and p_target is not null then auth.uid() end,
          case when v_status = 'active' and p_target is not null then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.decide_listing(p_listing uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l match_listings;
begin
  select * into v_l from match_listings where id = p_listing for update;
  if v_l.id is null then raise exception 'İlan bulunamadı'; end if;
  if v_l.target_group_id is null or not public.is_group_admin(v_l.target_group_id) then
    raise exception 'İlanı sadece grubun kaptanı veya yetkilisi onaylar';
  end if;
  if v_l.status <> 'pending' then raise exception 'Bu ilan zaten sonuçlandı'; end if;
  update match_listings
     set status = case when p_accept then 'active' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
   where id = p_listing;
end;
$$;

create or replace function public.close_listing(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l match_listings;
begin
  select * into v_l from match_listings where id = p_listing for update;
  if v_l.id is null then raise exception 'İlan bulunamadı'; end if;
  if not (v_l.created_by = auth.uid() or public.can_manage_match(v_l.match_id)
          or (v_l.target_group_id is not null and public.is_group_admin(v_l.target_group_id))) then
    raise exception 'İlanı sadece açan, maçı yöneten veya grubun yetkilisi kapatır';
  end if;
  if v_l.status not in ('pending', 'active') then raise exception 'Bu ilan zaten kapalı'; end if;
  update match_listings set status = 'closed' where id = p_listing;
end;
$$;

-- Maç toplanma/kesin durumundan çıkınca ilanlar kapanır
create or replace function public.close_listings_on_match_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text not in ('gathering', 'planned') then
    update match_listings set status = 'closed' where match_id = new.id and status in ('pending', 'active');
  end if;
  return new;
end;
$$;
revoke all on function public.close_listings_on_match_end() from public, anon, authenticated;
create trigger close_listings_on_match_end after update of status on public.matches
  for each row execute function public.close_listings_on_match_end();

-- Keşfet: aktif herkese açık ilanların maçları (yer olanlar), bölgeye göre; ayrıntı match_overview ile
create or replace function public.open_listings(p_city text default null, p_district text default null)
returns table (listing_id uuid, match_id uuid)
language sql stable security definer set search_path = public as $$
  select l.id, m.id
    from match_listings l
    join matches m on m.id = l.match_id
    join groups g on g.id = m.group_id
    left join profiles pr on pr.id = l.created_by
   where l.status = 'active' and l.target_group_id is null
     and m.status::text in ('gathering', 'planned') and not public.match_time_passed(m)
     and m.roster_count < m.capacity
     and (p_city is null or coalesce(g.city, pr.city) = p_city)
     and (p_district is null or coalesce(g.district, pr.district) = p_district)
   order by m.played_at
   limit 60
$$;

-- ---------------------------------------------------------------------------
-- 6) Özet (kartlar, ilanlar, Keşfet, davet sayfası): görebildiğim maçlar
-- ---------------------------------------------------------------------------
create or replace function public.match_overview(p_ids uuid[])
returns table (
  match_id uuid, group_id uuid, group_name text, group_kind text, group_color text, city text, district text,
  status text, kind text, played_at timestamptz, time_tbd boolean, venue text, team_size smallint, capacity smallint,
  roster_count smallint, reserve_count smallint, opponent_name text, note text, positions text[],
  my_status text, is_member boolean, can_manage boolean
)
language sql stable security definer set search_path = public as $$
  select m.id, g.id, g.name, g.kind, g.color, g.city, g.district,
         m.status::text, m.kind, m.played_at, m.time_tbd, m.venue, m.team_size, m.capacity,
         m.roster_count, m.reserve_count, m.opponent_name, m.note,
         coalesce((select array_agg(distinct p) from match_listings l, unnest(l.positions) p
                    where l.match_id = m.id and l.status = 'active'), '{}'),
         (select e.status from match_entries e where e.match_id = m.id and e.user_id = auth.uid()),
         public.is_group_member(g.id), public.can_manage_match(m.id)
    from matches m join groups g on g.id = m.group_id
   where m.id = any(p_ids) and public.can_view_match(m.id)
$$;

-- ---------------------------------------------------------------------------
-- 7) Davet, başvuru, karar
-- ---------------------------------------------------------------------------
-- Yöneten → 'invited' (onaysız katılır); kadrodaki oyuncu → 'pending' (yönetenin onayına)
create or replace function public.invite_to_match(p_match uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_m matches;
  v_e match_entries;
  v_manager boolean;
  v_status text;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then
    raise exception 'Bu maça artık çağrı yapılamaz';
  end if;
  if p_user is null or p_user = v_me or not exists (select 1 from profiles where id = p_user) then raise exception 'Geçersiz kişi'; end if;
  if public.dm_blocked(v_me, p_user) then raise exception 'Bu kişiye davet gönderilemiyor'; end if;
  v_manager := public.can_manage_match(p_match);
  if not v_manager and not public.is_match_participant(p_match) then
    raise exception 'Maça sadece maçı yönetenler ve kadrodakiler çağırır';
  end if;
  v_status := case when v_manager then 'invited' else 'pending' end;
  select * into v_e from match_entries where match_id = p_match and user_id = p_user;
  if v_e.status in ('in', 'reserve', 'invited') then return v_e.status; end if;
  if v_e.status = 'pending' then
    if v_manager then
      update match_entries set status = 'invited', source = 'invite', added_by = v_me, updated_at = now() where id = v_e.id;
      return 'invited';
    end if;
    return 'pending';
  end if;
  if v_e.status = 'rejected' and not v_manager then raise exception 'Bu kişinin başvurusu reddedilmiş'; end if;
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, added_by) values (p_match, p_user, v_status, 'invite', v_me);
  else
    update match_entries set status = v_status, source = 'invite', added_by = v_me, updated_at = now() where id = v_e.id;
  end if;
  return v_status;
end;
$$;

create table public.match_codes (
  match_id uuid primary key references public.matches (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.match_codes enable row level security;
-- Politika yok: kod sadece RPC ile

create or replace function public.new_match_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  i integer;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (select 1 from match_codes where code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function public.new_match_code() from public, anon, authenticated;

create or replace function public.match_invite_code(p_match uuid, p_regenerate boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not public.can_manage_match(p_match) then raise exception 'Bağlantıyı sadece maçı yönetenler paylaşır'; end if;
  if p_regenerate then delete from match_codes where match_id = p_match; end if;
  select code into v_code from match_codes where match_id = p_match;
  if v_code is null then
    insert into match_codes (match_id, code) values (p_match, public.new_match_code()) returning code into v_code;
  end if;
  return v_code;
end;
$$;

-- Bağlantıyla gelen: başvurmadan önce maçın özeti + kadro (adlar, mevki, genel rating)
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

-- İlandan veya bağlantıdan başvuru (onaya düşer). Davetliyse doğrudan respond_match kullanılır.
create or replace function public.apply_match(p_match uuid, p_listing uuid default null, p_code text default null,
                                              p_position text default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_m matches;
  v_e match_entries;
  v_source text;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then
    raise exception 'Bu maça artık başvurulamaz';
  end if;
  if p_listing is not null and exists (select 1 from match_listings where id = p_listing and match_id = p_match and status = 'active')
     and public.can_view_listing(p_listing) then
    v_source := 'listing';
  elsif p_code is not null and exists (select 1 from match_codes where match_id = p_match and code = public.norm_invite(p_code)) then
    v_source := 'link';
  else
    raise exception 'Bu maça başvurmak için geçerli bir ilan veya bağlantı gerekir';
  end if;
  if public.dm_blocked(v_me, v_m.created_by) then raise exception 'Bu maça başvuramazsın'; end if;
  select * into v_e from match_entries where match_id = p_match and user_id = v_me;
  if v_e.status in ('in', 'reserve') then raise exception 'Zaten bu maçtasın'; end if;
  if v_e.status = 'invited' then raise exception 'Bu maça davetlisin; "Geliyorum" demen yeterli'; end if;
  if v_e.status = 'pending' then raise exception 'Başvurun zaten onay bekliyor'; end if;
  if v_e.status = 'rejected' then raise exception 'Bu maça başvurun reddedildi'; end if;
  if (select count(*) from match_entries where user_id = v_me and status = 'pending') >= 5 then
    raise exception 'Aynı anda en fazla 5 bekleyen başvurun olabilir';
  end if;
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, listing_id, position, note)
    values (p_match, v_me, 'pending', v_source, case when v_source = 'listing' then p_listing end,
            p_position, nullif(left(btrim(p_note), 200), ''));
  else
    update match_entries
       set status = 'pending', source = v_source, listing_id = case when v_source = 'listing' then p_listing end,
           position = p_position, note = nullif(left(btrim(p_note), 200), ''), queued_at = null, updated_at = now()
     where id = v_e.id;
  end if;
  return 'pending';
end;
$$;

create or replace function public.cancel_application(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from match_entries where match_id = p_match and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Bekleyen başvurun yok'; end if;
end;
$$;

-- Kabul: yer varsa kadro (üye değilse bu maç için ödünç), yoksa yedek. Döner: 'in' · 'reserve' · 'rejected'
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
    update match_entries set status = 'rejected', updated_at = now() where id = v_e.id;
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

-- ---------------------------------------------------------------------------
-- 8) respond_match: davetli de yanıt verir; bekleyen/reddedilen başvuru yanıt veremez
-- ---------------------------------------------------------------------------
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
  if not (v_m.open_to_members and public.is_group_member(v_m.group_id)) then
    if v_e.id is null then
      raise exception 'Bu maça sadece takımın/grubun üyeleri ve çağrılanlar yanıt verir';
    elsif v_e.status = 'pending' and p_answer = 'yes' then
      raise exception 'Başvurun onay bekliyor';
    elsif v_e.status = 'rejected' then
      raise exception 'Bu maça başvurun reddedildi';
    end if;
  end if;

  if p_answer = 'no' then
    if v_in and v_m.status::text = 'planned' and coalesce(v_m.free_withdraw_until, '-infinity') < now() then
      raise exception 'Maç kesinleşti; kadrodan çıkmak için çekilme isteği gönder';
    end if;
    update match_entries set status = 'declined', note = nullif(btrim(p_note), ''), queued_at = null, updated_at = now()
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_listing(uuid, uuid, text[], text)', 'decide_listing(uuid, boolean)', 'close_listing(uuid)',
    'open_listings(text, text)', 'match_overview(uuid[])', 'invite_to_match(uuid, uuid)',
    'match_invite_code(uuid, boolean)', 'match_by_code(text)', 'apply_match(uuid, uuid, text, text, text)',
    'cancel_application(uuid)', 'decide_application(uuid, uuid, boolean)', 'respond_match(uuid, text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9) Sohbetten maç kartı = kişiye özel davet; toplanan maç da paylaşılır, kadrodaki oyuncu da gönderir
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
    if not found or v_match.status::text not in ('gathering', 'planned') then
      raise exception 'Maç bulunamadı veya artık açık değil';
    end if;
    select * into v_group from groups where id = v_match.group_id;
    v_when := v_match.played_at; v_venue := v_match.venue;
    v_label := 'Maç';
    v_card := jsonb_build_object('type', 'match', 'opponent', v_match.opponent_name, 'team_size', v_match.team_size,
      'capacity', v_match.capacity, 'time_tbd', v_match.time_tbd);
  else
    raise exception 'Geçersiz davet türü';
  end if;

  if not (public.is_group_admin(v_group.id)
          or (p_type = 'poll' and public.can_manage_poll(p_ref))
          or (p_type = 'match' and (public.can_manage_match(p_ref) or public.is_match_participant(p_ref)))) then
    raise exception 'Davet göndermek için kaptan, yetkili veya maçı kuran kişi olmalısınız';
  end if;

  if (select count(*) from dm_messages where author_id = v_me and kind = 'match' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Bugün çok fazla davet gönderdin, yarın tekrar dene';
  end if;

  v_card := v_card || jsonb_build_object(
    'group_id', v_group.id, 'group_name', v_group.name, 'group_kind', v_group.kind,
    'starts_at', v_when, 'venue', v_venue);
  v_body := '⚽ ' || v_label || ': ' || v_group.name || ' · ' || public.chat_tr_date(v_when) || coalesce(' · ' || v_venue, '');

  -- Maç kartı = kişiye özel davet (yöneten: onaysız; kadrodaki oyuncu: onaya düşer)
  if p_type = 'match' then
    perform public.invite_to_match(p_ref, p_user_id);
  end if;

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

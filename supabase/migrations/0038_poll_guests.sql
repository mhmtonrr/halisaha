-- 0038: Maç çağrısına dışarıdan misafir (hesabı olmayan oyuncu).
-- Organizatör çağrı açıkken isim + mevki ile ekler; "Geliyor" listesinde görünür. Kesinleştirmede seçilen
-- misafirler maçın grubuna (veya takıma) misafir oyuncu olarak, maç kadrosuna da tarafıyla yazılır.
-- Sadece toplama çağrısı (purpose = 'gather'). Yayındaki eski kodla uyumlu: finalize_poll'un yeni parametresi varsayılanlı.

create table public.poll_guests (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.match_polls (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  added_by uuid references public.profiles (id) on delete set null,
  -- Kesinleştirmede kadroya alındıysa oluşan misafir oyuncu satırı
  player_id uuid references public.group_players (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.poll_guests (poll_id);

alter table public.poll_guests enable row level security;
-- Görme: çağrının grubunun üyeleri ve çağrıyı yöneten; yazma sadece RPC'lerle
create policy "üyeler ve organizatör çağrı misafirlerini görür" on public.poll_guests
  for select to authenticated
  using (public.is_group_member(public.poll_group(poll_id)) or public.can_manage_poll(poll_id));

create function public.add_poll_guest(p_poll uuid, p_name text, p_position text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p match_polls;
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_p from match_polls where id = p_poll for update;
  if v_p.id is null then raise exception 'Çağrı bulunamadı'; end if;
  if not public.can_manage_poll(p_poll) then raise exception 'Misafiri sadece çağrıyı açan kişi veya yetkililer ekler'; end if;
  if v_p.purpose <> 'gather' or v_p.status <> 'open' then raise exception 'Misafir sadece açık maç çağrısına eklenir'; end if;
  if char_length(v_name) < 2 then raise exception 'Misafirin ismi en az 2 karakter olmalı'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then raise exception 'Geçersiz mevki'; end if;
  if (select count(*) from poll_guests where poll_id = p_poll) >= 20 then
    raise exception 'Bir çağrıya en fazla 20 misafir eklenir';
  end if;
  insert into poll_guests (poll_id, name, position, added_by)
  values (p_poll, v_name, p_position, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_poll_guest(p_guest uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_g poll_guests;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_g from poll_guests where id = p_guest;
  if v_g.id is null then raise exception 'Misafir bulunamadı'; end if;
  if not public.can_manage_poll(v_g.poll_id) then raise exception 'Misafiri sadece çağrıyı açan kişi veya yetkililer çıkarır'; end if;
  if (select status from match_polls where id = v_g.poll_id) <> 'open' then
    raise exception 'Kesinleşmiş çağrıdan misafir çıkarılamaz; maç ekranından çıkar';
  end if;
  delete from poll_guests where id = p_guest;
end;
$$;

revoke all on function public.add_poll_guest(uuid, text, text) from public, anon;
grant execute on function public.add_poll_guest(uuid, text, text) to authenticated;
revoke all on function public.remove_poll_guest(uuid) from public, anon;
grant execute on function public.remove_poll_guest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Kesinleştirme: p_guests = [{id, team, gk}] (seçilen çağrı misafirleri)
-- ---------------------------------------------------------------------------
drop function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text);
create function public.finalize_poll(
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
      -- Hızlı takım: geçici kurulur, il/ilçe çağrının topluluğundan (yoksa profilden) gelir
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
      -- Arşivdeki geçici takım yeniden kullanılır (yeni takım kurulmaz)
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

  -- Seçilen misafirler: maçın grubuna misafir oyuncu (user_id yok) + kadro
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
revoke all on function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text, jsonb) to authenticated;

-- Canlı güncelleme (çağrı ekranı misafir eklenince yenilensin)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poll_guests') then
      alter publication supabase_realtime add table public.poll_guests;
    end if;
  end if;
end $$;

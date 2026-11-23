-- 3. parça (kullanıcı kararları):
--  A) Üye maç önerisi: üye "Maç öner" der; sadece öneren ve maç açabilenler görür. Onaylanınca toplama çağrısı açılır ve
--     öneren kişi o çağrının organizatörü olur (rolü olmasa da: match_polls.proposal_id). Grupta kişi başına 1 bekleyen öneri.
--  B) Geçici takım: kesinleştirmede "hızlı takım" (finalize_poll p_new_team) geçici kurulur; son maçı kapanınca ve planlı maçı
--     kalmayınca kendiliğinden arşivlenir; maçı iptal olup hiç maçı kalmayan geçici takım silinir (cleanup_temp_team).
--     "Takımı dağıt" (disband_team): oynanmış maç varsa arşiv, yoksa silme. Arşivli takım yeni maç/çağrı/teklif/davet/katılım
--     almaz (tetikleyiciler); kaptan yeniden açar (reopen_team) veya geçiciyi kalıcı yapar (make_team_permanent).
--  D) Sessize alma: group_players.muted (kendi satırı, set_group_muted); toplu duyurular uygulamada atlanır.

-- ---------------------------------------------------------------------------
-- B) Geçici takım ve arşiv
-- ---------------------------------------------------------------------------
alter table public.groups
  add column is_temporary boolean not null default false,
  add column archived_at timestamptz;
grant select (is_temporary, archived_at) on public.groups to authenticated;

create or replace function public.group_archived(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where id = p_group and archived_at is not null)
$$;

-- Arşivli takıma yeni maç, çağrı, teklif, davet ve katılım yazılamaz
create or replace function public.guard_archived_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'match_challenges' then
    if public.group_archived(new.from_group_id) or public.group_archived(new.to_group_id) then
      raise exception 'Dağıtılmış takımla teklifleşilemez';
    end if;
  elsif tg_table_name = 'group_players' then
    if public.group_archived(new.group_id)
       and (tg_op = 'INSERT' or (old.left_at is not null and new.left_at is null)) then
      raise exception 'Bu takım dağıtılmış';
    end if;
  elsif public.group_archived(new.group_id) then
    raise exception 'Bu takım dağıtılmış';
  end if;
  return new;
end;
$$;
create trigger guard_archived before insert on public.matches
  for each row execute function public.guard_archived_group();
create trigger guard_archived before insert on public.match_polls
  for each row execute function public.guard_archived_group();
create trigger guard_archived before insert on public.match_challenges
  for each row execute function public.guard_archived_group();
create trigger guard_archived before insert on public.group_invites
  for each row execute function public.guard_archived_group();
create trigger guard_archived before insert or update of left_at on public.group_players
  for each row execute function public.guard_archived_group();

-- Arşivli takımda maç açma yetkisi de yok (arayüz düğmeleri buna bakar)
create or replace function public.can_create_match(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players gp join groups g on g.id = gp.group_id
     where gp.group_id = p_group_id and gp.user_id = auth.uid() and gp.left_at is null and not gp.is_loan
       and gp.role in ('captain', 'admin', 'organizer') and g.archived_at is null
  )
$$;

-- Geçici takım: son maçı kapanınca ve planlı/oylamada maçı kalmayınca arşivlenir
create or replace function public.archive_temp_team_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update groups g set archived_at = now()
   where g.id = new.group_id and g.is_temporary and g.archived_at is null
     and not exists (select 1 from matches m where m.group_id = g.id and m.status <> 'closed');
  return new;
end;
$$;
create trigger archive_temp_team_on_close after update of status on public.matches
  for each row when (new.status = 'closed' and old.status <> 'closed')
  execute function public.archive_temp_team_on_close();

-- Maçı iptal olan geçici takım: hiç maçı kalmadıysa silinir, sadece kapanmış maçları kaldıysa arşivlenir.
-- (Tetikleyici değil: grup silinirken basamaklı maç silmeyle çakışmasın diye maç silindikten sonra uygulamadan çağrılır.)
create or replace function public.cleanup_temp_team(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_g groups;
begin
  select * into v_g from groups where id = p_group;
  if v_g.id is null or not v_g.is_temporary then return 'kept'; end if;
  if not exists (select 1 from group_players where group_id = p_group and user_id = auth.uid() and left_at is null and not is_loan) then
    return 'kept';
  end if;
  if not exists (select 1 from matches where group_id = p_group) then
    delete from groups where id = p_group;
    return 'deleted';
  end if;
  if v_g.archived_at is null and not exists (select 1 from matches where group_id = p_group and status <> 'closed') then
    update groups set archived_at = now() where id = p_group;
    return 'archived';
  end if;
  return 'kept';
end;
$$;

-- Takımı dağıt (kaptan): planlı/oylamada maçı varsa önce o bitmeli; oynanmış maç varsa arşiv, yoksa silme
create or replace function public.disband_team(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if public.group_kind(p_group) is distinct from 'team' then raise exception 'Sadece takım dağıtılır'; end if;
  if not public.is_group_captain(p_group) then raise exception 'Takımı sadece kaptan dağıtır'; end if;
  if exists (select 1 from matches where group_id = p_group and status <> 'closed') then
    raise exception 'Planlı veya oylaması süren maç var; önce o bitmeli ya da iptal edilmeli';
  end if;
  if exists (select 1 from matches where group_id = p_group) then
    update groups set archived_at = now() where id = p_group;
    update match_polls set status = 'closed' where group_id = p_group and status in ('open', 'filled');
    update match_challenges set status = 'cancelled'
     where (from_group_id = p_group or to_group_id = p_group) and status = 'pending';
    update group_invites set status = 'cancelled' where group_id = p_group and status = 'pending';
    return 'archived';
  end if;
  delete from groups where id = p_group;
  return 'deleted';
end;
$$;

create or replace function public.reopen_team(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_captain(p_group) then raise exception 'Takımı sadece kaptan yeniden açar'; end if;
  update groups set archived_at = null where id = p_group and archived_at is not null;
  if not found then raise exception 'Takım zaten açık'; end if;
end;
$$;

create or replace function public.make_team_permanent(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_captain(p_group) then raise exception 'Bunu sadece kaptan yapar'; end if;
  update groups set is_temporary = false, archived_at = null where id = p_group and is_temporary;
  if not found then raise exception 'Takım zaten kalıcı'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A) Üye maç önerisi
-- ---------------------------------------------------------------------------
create table public.match_proposals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  play_on date not null,
  starts_at timestamptz,
  venue text check (char_length(venue) <= 80),
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  poll_id uuid references public.match_polls (id) on delete set null,
  decided_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index on public.match_proposals (group_id, status);
create unique index match_proposals_one_pending on public.match_proposals (group_id, proposed_by) where status = 'pending';
alter table public.match_proposals enable row level security;
-- Öneriyi sadece öneren ve o grupta maç açabilenler görür; yazma sadece RPC
create policy "öneriyi sahibi ve maç açabilenler görür" on public.match_proposals
  for select to authenticated
  using (proposed_by = auth.uid() or public.can_create_match(group_id));

alter table public.match_polls add column proposal_id uuid references public.match_proposals (id) on delete set null;

-- Öneriden açılan çağrıyı öneren kişi rolü olmasa da yönetir
create or replace function public.can_manage_poll(p_poll_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_polls p
     where p.id = p_poll_id
       and ((p.created_by = auth.uid()
             and (public.can_create_match(p.group_id) or (p.proposal_id is not null and public.is_group_member(p.group_id))))
            or public.is_group_admin(p.group_id))
  )
$$;

create or replace function public.propose_match(
  p_group uuid, p_play_on date, p_starts_at timestamptz default null, p_venue text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  if not public.is_group_member(p_group) then raise exception 'Bu grubun üyesi değilsiniz'; end if;
  if public.can_create_match(p_group) then raise exception 'Sen doğrudan çağrı açabilirsin'; end if;
  if public.group_archived(p_group) then raise exception 'Bu takım dağıtılmış'; end if;
  if p_play_on is null or p_play_on < public.istanbul_today() or p_play_on > public.istanbul_today() + 30 then
    raise exception 'Maç günü bugünden itibaren 30 gün içinde olmalı';
  end if;
  if p_starts_at is not null and (p_starts_at <= now() or (p_starts_at at time zone 'Europe/Istanbul')::date <> p_play_on) then
    raise exception 'Saat, seçilen günde ve gelecekte olmalı';
  end if;
  if exists (select 1 from match_proposals where group_id = p_group and proposed_by = auth.uid() and status = 'pending') then
    raise exception 'Bekleyen bir önerin var; önce onun sonucunu bekle veya geri çek';
  end if;
  insert into match_proposals (group_id, proposed_by, play_on, starts_at, venue, note)
  values (p_group, auth.uid(), p_play_on, p_starts_at, nullif(btrim(p_venue), ''), nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Onay: öneren kişi adına toplama çağrısı açılır (sohbete duyurusu düşer); ret: sadece durum
create or replace function public.decide_proposal(p_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p match_proposals;
  v_poll uuid;
begin
  select * into v_p from match_proposals where id = p_id for update;
  if v_p.id is null then raise exception 'Öneri bulunamadı'; end if;
  if not public.can_create_match(v_p.group_id) then raise exception 'Öneriye sadece kurucu, yetkili ve organizatörler karar verir'; end if;
  if v_p.status <> 'pending' then raise exception 'Bu öneri zaten sonuçlandı'; end if;
  if not p_accept then
    update match_proposals set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return null;
  end if;
  if v_p.play_on < public.istanbul_today() then raise exception 'Önerinin günü geçti'; end if;
  if not exists (select 1 from group_players where group_id = v_p.group_id and user_id = v_p.proposed_by and left_at is null and not is_loan) then
    raise exception 'Öneren kişi artık grubun üyesi değil';
  end if;
  insert into match_polls (group_id, created_by, purpose, play_on, starts_at, venue, note, proposal_id)
  values (v_p.group_id, v_p.proposed_by, 'gather', v_p.play_on,
          case when v_p.starts_at > now() then v_p.starts_at end, v_p.venue, v_p.note, v_p.id)
  returning id into v_poll;
  update match_proposals set status = 'accepted', poll_id = v_poll, decided_by = auth.uid(), decided_at = now() where id = p_id;
  return v_poll;
end;
$$;

create or replace function public.cancel_proposal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update match_proposals set status = 'cancelled', decided_at = now()
   where id = p_id and proposed_by = auth.uid() and status = 'pending';
  if not found then raise exception 'Bekleyen önerin bulunamadı'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- D) Sessize alma
-- ---------------------------------------------------------------------------
alter table public.group_players add column muted boolean not null default false;

create or replace function public.set_group_muted(p_group uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update group_players set muted = coalesce(p_muted, false)
   where group_id = p_group and user_id = auth.uid() and left_at is null;
  if not found then raise exception 'Bu grubun üyesi değilsiniz'; end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'cleanup_temp_team(uuid)', 'disband_team(uuid)', 'reopen_team(uuid)', 'make_team_permanent(uuid)',
    'propose_match(uuid, date, timestamptz, text, text)', 'decide_proposal(uuid, boolean)', 'cancel_proposal(uuid)',
    'set_group_muted(uuid, boolean)', 'group_archived(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- B) Kesinleştirme: hızlı (geçici) takım ve arşivdeki geçici takımı yeniden kullanma
-- ---------------------------------------------------------------------------
drop function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb);
create function public.finalize_poll(
  p_poll uuid, p_starts_at timestamptz, p_venue text, p_team_size smallint, p_kind text,
  p_team uuid default null, p_opponent text default null, p_roster jsonb default '[]', p_new_team text default null
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
revoke all on function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text) from public, anon;
grant execute on function public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text) to authenticated;

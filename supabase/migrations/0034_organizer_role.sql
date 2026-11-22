-- Organizatör rolü (kullanıcı kararı): Kurucu/Kaptan > Yetkili > Organizatör > Üye.
--  * Maç ve maç çağrısını sadece kurucu/kaptan, yetkili ve organizatör açar (can_create_match). Üye açamaz.
--  * Herkes kendi kurduğu maçı yönetir (kadro, misafir, sonuç, "gelmedi", çekilme kararı: can_manage_match);
--    başkasının maçını sadece kurucu/kaptan ve yetkili yönetir.
--  * Organizatör üye yönetemez (çıkarma, rol, mevki, davet kodu yenileme is_group_admin'de kalır).
--  * Rolü sadece kurucu/kaptan verir (set_member_role).

alter table public.group_players drop constraint group_players_role_check;
alter table public.group_players
  add constraint group_players_role_check check (role in ('captain', 'admin', 'organizer', 'member'));

-- Maç/çağrı açabilir mi? (ayrılmış ve ödünç olan sayılmaz; ödünç oyuncunun rolü zaten hep 'member')
create function public.can_create_match(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
     where group_id = p_group_id and user_id = auth.uid() and left_at is null and not is_loan
       and role in ('captain', 'admin', 'organizer')
  )
$$;
revoke all on function public.can_create_match(uuid) from public, anon;
grant execute on function public.can_create_match(uuid) to authenticated;

-- Çağrıyı yönetebilir mi? (açan kişi hâlâ maç açabiliyorsa veya kurucu/yetkili)
create function public.can_manage_poll(p_poll_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from match_polls p
     where p.id = p_poll_id
       and ((p.created_by = auth.uid() and public.can_create_match(p.group_id)) or public.is_group_admin(p.group_id))
  )
$$;
revoke all on function public.can_manage_poll(uuid) from public, anon;
grant execute on function public.can_manage_poll(uuid) to authenticated;

-- Rol verme: organizatör de verilebilir
create or replace function public.set_member_role(p_player_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target group_players;
  v_me uuid;
begin
  select * into v_target from group_players where id = p_player_id;
  if v_target is null then
    raise exception 'Oyuncu bulunamadı';
  end if;
  v_me := public.my_player_id(v_target.group_id);

  if p_role not in ('captain', 'admin', 'organizer', 'member') then
    raise exception 'Geçersiz rol';
  end if;
  if v_target.user_id is null then
    raise exception 'Misafirlere yetki verilemez';
  end if;
  if v_target.left_at is not null then
    raise exception 'Ayrılmış oyuncuya yetki verilemez';
  end if;
  if v_target.id = v_me then
    raise exception 'Kendi rolünüzü değiştiremezsiniz';
  end if;
  if not public.is_group_captain(v_target.group_id) then
    raise exception 'Yetkileri sadece kaptan/kurucu değiştirebilir';
  end if;

  if p_role = 'captain' then
    -- Devir: eski kaptan/kurucu yetkili olur
    update group_players set role = 'admin' where id = v_me;
  end if;
  update group_players set role = p_role where id = p_player_id;
end;
$$;

-- Maç kurma: kurucu/kaptan, yetkili, organizatör
drop policy "maç oluşturur" on public.matches;
create policy "maç oluşturur" on public.matches
  for insert to authenticated
  with check (created_by = auth.uid() and public.can_create_match(group_id));

-- Çağrı: açma kurucu/yetkili/organizatör; düzenleme ve silme açan kişi veya kurucu/yetkili
drop policy "yetkili çağrı açar" on public.match_polls;
drop policy "yetkili çağrıyı düzenler" on public.match_polls;
drop policy "yetkili çağrıyı siler" on public.match_polls;
create policy "çağrı açar" on public.match_polls
  for insert to authenticated
  with check (created_by = auth.uid() and public.can_create_match(group_id));
create policy "çağrıyı düzenler" on public.match_polls
  for update to authenticated using (public.can_manage_poll(id));
create policy "çağrıyı siler" on public.match_polls
  for delete to authenticated using (public.can_manage_poll(id));

create or replace function public.set_poll_approval(p_poll_id uuid, p_player_id uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_poll(p_poll_id) then
    raise exception 'Kadroyu sadece çağrıyı açan kişi veya yetkililer onaylar';
  end if;
  update poll_responses set approved = p_approved
   where poll_id = p_poll_id and player_id = p_player_id and answer = 'yes';
  if not found then
    raise exception 'Sadece "geliyorum" diyenler onaylanabilir';
  end if;
end;
$$;

create or replace function public.approve_first_responders(p_poll_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_capacity smallint;
  v_count integer;
begin
  if not public.can_manage_poll(p_poll_id) then
    raise exception 'Kadroyu sadece çağrıyı açan kişi veya yetkililer onaylar';
  end if;
  select capacity into v_capacity from match_polls where id = p_poll_id;
  update poll_responses r
     set approved = r.player_id in (
       select player_id from poll_responses
        where poll_id = p_poll_id and answer = 'yes'
        order by responded_at
        limit v_capacity)
   where r.poll_id = p_poll_id and r.answer = 'yes';
  select count(*) into v_count from poll_responses where poll_id = p_poll_id and approved;
  return v_count;
end;
$$;

-- Otomatik (eski "üye") çağrı: artık sadece maç açabilenler. Birleşik çağrı gelince (2. parça) kalkacak.
create or replace function public.create_member_poll(
  p_group uuid, p_starts_at timestamptz, p_venue text, p_size smallint,
  p_deadline timestamptz default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
  v_id uuid;
  v_me uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if public.group_kind(p_group) is distinct from 'community' then
    raise exception 'Bu çağrı türü sadece gruplarda açılır';
  end if;
  if not public.can_create_match(p_group) then
    raise exception 'Çağrıyı sadece kurucu, yetkili ve organizatörler açar';
  end if;
  if p_size is null or p_size not between 5 and 11 then
    raise exception 'Kişi sayısı 5 ile 11 arasında olmalı';
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '3 hours' then
    raise exception 'Maç en az 3 saat sonrasına planlanmalı';
  end if;
  if p_starts_at > now() + interval '14 days' then
    raise exception 'Maç en fazla 14 gün sonrasına planlanabilir';
  end if;
  v_deadline := coalesce(p_deadline, p_starts_at - interval '3 hours');
  if v_deadline > p_starts_at - interval '1 hour' then
    raise exception 'Son yanıt süresi maçtan en az 1 saat önce olmalı';
  end if;
  if v_deadline <= now() then
    raise exception 'Son yanıt süresi geçmişte olamaz';
  end if;
  if not public.is_group_admin(p_group) and exists (
    select 1 from match_polls
     where group_id = p_group and created_by = auth.uid() and status = 'open' and auto_match
  ) then
    raise exception 'Zaten açık bir çağrın var; önce onu iptal et veya sonuçlanmasını bekle';
  end if;

  insert into match_polls (group_id, created_by, starts_at, venue, capacity, deadline, note, auto_match, team_size)
  values (p_group, auth.uid(), p_starts_at, nullif(btrim(p_venue), ''), p_size * 2, v_deadline,
          nullif(btrim(p_note), ''), true, p_size)
  returning id into v_id;

  v_me := public.my_player_id(p_group);
  insert into poll_responses (poll_id, player_id, answer) values (v_id, v_me, 'yes');
  return v_id;
end;
$$;

-- Çekilme: kararı maçı yöneten verir (kurucu/yetkili veya maçı kuran)
drop policy "çekilme isteğini sahibi ve yetkililer görür" on public.match_withdrawals;
create policy "çekilme isteğini sahibi ve maçı yöneten görür" on public.match_withdrawals
  for select to authenticated
  using (
    exists (select 1 from public.group_players gp where gp.id = player_id and gp.user_id = auth.uid())
    or public.can_manage_match(match_id)
  );

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

  if public.can_manage_match(p_match) then
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

create or replace function public.decide_withdrawal(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_w match_withdrawals;
  v_m matches;
begin
  select * into v_w from match_withdrawals where id = p_id;
  if not found then raise exception 'İstek bulunamadı'; end if;
  select * into v_m from matches where id = v_w.match_id;
  if not public.can_manage_match(v_m.id) then
    raise exception 'Çekilme isteğine sadece maçı kuran, kaptan veya yetkililer karar verir';
  end if;
  if v_w.status <> 'pending' then raise exception 'Bu istek zaten sonuçlandı'; end if;
  if v_m.status <> 'planned' then raise exception 'Maç artık planlanmış değil'; end if;
  if p_approve then
    update match_withdrawals set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
    delete from match_players where match_id = v_w.match_id and player_id = v_w.player_id;
  else
    update match_withdrawals set status = 'denied', decided_by = auth.uid(), decided_at = now() where id = p_id;
  end if;
end;
$$;

-- Misafir ekleme: maçı yöneten (maçı kuran dahil) planlanmış maça misafir ekler; misafir gruba ve maçın kadrosuna yazılır
create function public.add_match_guest(p_match uuid, p_name text, p_position text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_guest uuid;
  v_a integer;
  v_total integer;
  v_team text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match;
  if not found then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then
    raise exception 'Misafiri sadece maçı kuran, kaptan veya yetkililer ekler';
  end if;
  if v_m.status <> 'planned' then raise exception 'Misafir sadece planlanmış maça eklenir'; end if;
  if char_length(v_name) < 2 then raise exception 'Misafirin ismi en az 2 karakter olmalı'; end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then
    raise exception 'Geçersiz mevki';
  end if;

  insert into group_players (group_id, display_name, position)
  values (v_m.group_id, v_name, p_position)
  returning id into v_guest;

  select count(*) filter (where team = 'A'), count(*) into v_a, v_total from match_players where match_id = p_match;
  v_team := case when v_m.kind = 'external' or v_a <= v_total - v_a then 'A' else 'B' end;
  insert into match_players (match_id, player_id, team, position, is_goalkeeper)
  values (p_match, v_guest, v_team, p_position, coalesce(p_position = 'GK', false));
  return v_guest;
end;
$$;
revoke all on function public.add_match_guest(uuid, text, text) from public, anon;
grant execute on function public.add_match_guest(uuid, text, text) to authenticated;

-- Maç/çağrı kartı paylaşımı (0031): organizatör kendi çağrısını ve maçını da paylaşır
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
  v_listing player_listings;
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

  if p_type = 'listing' then
    select * into v_listing from player_listings where id = p_ref;
    if not found or v_listing.status <> 'open' then
      raise exception 'İlan bulunamadı veya kapalı';
    end if;
    select * into v_group from groups where id = v_listing.group_id;
    select played_at, venue into v_when, v_venue from matches where id = v_listing.match_id;
    v_label := 'Oyuncu ilanı';
    v_card := jsonb_build_object('type', 'listing', 'needed', v_listing.needed, 'positions', to_jsonb(v_listing.positions), 'min_overall', v_listing.min_overall);
  elsif p_type = 'poll' then
    select * into v_poll from match_polls where id = p_ref;
    if not found or v_poll.status <> 'open' then
      raise exception 'Çağrı bulunamadı veya kapalı';
    end if;
    select * into v_group from groups where id = v_poll.group_id;
    v_when := v_poll.starts_at; v_venue := v_poll.venue;
    v_label := 'Maç çağrısı';
    v_card := jsonb_build_object('type', 'poll', 'capacity', v_poll.capacity);
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
       and ((p_type = 'listing' and listing_id = p_ref) or (p_type = 'poll' and poll_id = p_ref) or (p_type = 'match' and match_id = p_ref))
  ) then
    raise exception 'Bu daveti bu kişiye zaten gönderdin';
  end if;

  insert into dm_messages (thread_id, author_id, kind, body, card, listing_id, poll_id, match_id)
  values (v_thread, v_me, 'match', left(v_body, 300), v_card,
          case when p_type = 'listing' then p_ref end,
          case when p_type = 'poll' then p_ref end,
          case when p_type = 'match' then p_ref end)
  returning id into v_id;
  update dm_threads set last_message_at = now(), last_author_id = v_me, last_body = left(v_body, 80) where id = v_thread;
  return v_id;
end;
$$;

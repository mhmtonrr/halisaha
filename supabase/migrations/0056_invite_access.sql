-- Kişiye özel davet ve maça erişim (kullanıcı kararları 2026-11-27).
--  * Takım/grup dışından biri kadrodan veya yedekten çıkarılır ya da daveti iptal edilirse kaydı 'removed' olur:
--    maçı göremez (takım herkese açık olsa da), bağlantı/ilanla geri dönemez; yalnızca yöneten yeniden davet edebilir.
--  * Reddedilen başvuran da göremez. Kendisi çıkan ('left') kayıtla göremez ama yeniden başvurabilir.
--  * 'declined' (davetli "gelemem" dedi): davet geçerli, görmeye ve fikrini değiştirmeye devam eder.
--  * Takım/grup üyeleri etkilenmez.
--  * Sohbetteki maç kartı tek davete bağlıdır: davet düşünce dm_messages.revoked_at dolar, kart bir daha canlanmaz.

alter table public.match_entries drop constraint match_entries_status_check;
alter table public.match_entries
  add constraint match_entries_status_check
    check (status in ('in', 'reserve', 'declined', 'left', 'invited', 'pending', 'rejected', 'removed'));

alter table public.dm_messages add column revoked_at timestamptz;
create index if not exists dm_messages_match on public.dm_messages (match_id) where match_id is not null;

-- ---------------------------------------------------------------------------
-- 1) Görünürlük
-- ---------------------------------------------------------------------------
-- Maçtan uzaklaştırıldım (çıkarıldım / davetim iptal / başvurum reddedildi) ve üye veya kadroda değilim
create or replace function public.match_blocked(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from match_entries e
                  where e.match_id = p_match and e.user_id = auth.uid() and e.status in ('removed', 'rejected'))
     and not public.is_group_member(public.match_group(p_match))
     and not public.is_match_participant(p_match)
$$;
revoke all on function public.match_blocked(uuid) from public, anon;
grant execute on function public.match_blocked(uuid) to authenticated;

create or replace function public.can_view_match(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
     where m.id = p_match
       and not public.match_blocked(m.id)
       and (public.is_group_visible(m.group_id)
            or exists (select 1 from match_entries e where e.match_id = m.id and e.user_id = auth.uid()
                        and e.status in ('in', 'reserve', 'invited', 'pending', 'declined'))
            or public.is_match_participant(m.id)
            or exists (select 1 from match_listings l
                        where l.match_id = m.id and l.status = 'active'
                          and (l.target_group_id is null or public.is_group_member(l.target_group_id))))
  )
$$;

drop policy "maçları görür" on public.matches;
create policy "maçları görür" on public.matches
  for select to authenticated
  using ((public.is_group_visible(group_id) and not public.match_blocked(id)) or public.can_view_match(id));

drop policy "kadroyu görür" on public.match_players;
create policy "kadroyu görür" on public.match_players
  for select to authenticated
  using ((public.is_group_visible(public.match_group(match_id)) and not public.match_blocked(match_id)) or public.can_view_match(match_id));

drop policy "sonuçları görür" on public.match_results;
create policy "sonuçları görür" on public.match_results
  for select to authenticated
  using ((public.is_group_visible(public.match_group(match_id)) and not public.match_blocked(match_id)) or public.can_view_match(match_id));

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
     and not public.match_blocked(m.id)
     and (p_city is null or coalesce(g.city, pr.city) = p_city)
     and (p_district is null or coalesce(g.district, pr.district) = p_district)
   order by m.played_at
   limit 60
$$;

-- Engelli kişiye bağlantıdan yalnızca {blocked: true}
create or replace function public.match_by_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_m matches;
  v_g groups;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select m.* into v_m from match_codes c join matches m on m.id = c.match_id where c.code = public.norm_invite(p_code);
  if v_m.id is null then return null; end if;
  if public.match_blocked(v_m.id) then return jsonb_build_object('blocked', true); end if;
  select * into v_g from groups where id = v_m.group_id;
  return jsonb_build_object(
    'match_id', v_m.id, 'group_id', v_g.id, 'group_name', v_g.name, 'group_kind', v_g.kind, 'group_color', v_g.color, 'group_logo', v_g.logo,
    'city', v_g.city, 'district', v_g.district, 'status', v_m.status::text, 'kind', v_m.kind,
    'played_at', v_m.played_at, 'time_tbd', v_m.time_tbd, 'venue', v_m.venue, 'team_size', v_m.team_size,
    'capacity', v_m.capacity, 'roster_count', v_m.roster_count, 'reserve_count', v_m.reserve_count,
    'opponent_name', v_m.opponent_name, 'note', v_m.note,
    'fee_per_person', v_m.fee_per_person,
    'pending_rival', (select g2.name from match_challenges c join groups g2 on g2.id = c.to_group_id where c.from_match_id = v_m.id and c.status = 'pending' limit 1),
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

-- ---------------------------------------------------------------------------
-- 2) Başvuru ve yanıt
-- ---------------------------------------------------------------------------
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
  if public.match_blocked(p_match) then raise exception 'Bu maça erişimin yok'; end if;
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

-- Takım dışından biri kadrodan/yedekten "gelemem" ile çıkarsa 'left' (erişimi biter); davetliyken derse 'declined'
create or replace function public.respond_match(p_match uuid, p_answer text, p_position text default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_m matches;
  v_e match_entries;
  v_in boolean;
  v_member boolean;
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
  v_member := public.is_group_member(v_m.group_id);
  if not v_member and not v_in and v_e.status in ('left', 'removed', 'rejected') then
    raise exception 'Bu maça davetin artık geçerli değil';
  end if;
  if not (v_m.open_to_members and v_member) then
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
    update match_entries
       set status = case when not v_member and (v_in or v_e.status = 'reserve') then 'left' else 'declined' end,
           note = nullif(btrim(p_note), ''), queued_at = null, updated_at = now()
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
-- 3) Davet ve davet iptali
-- ---------------------------------------------------------------------------
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
  if v_e.status = 'removed' and not v_manager then raise exception 'Bu kişiyi yalnızca maçı yönetenler yeniden çağırabilir'; end if;
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, added_by) values (p_match, p_user, v_status, 'invite', v_me);
  else
    update match_entries set status = v_status, source = 'invite', added_by = v_me, queued_at = null, updated_at = now() where id = v_e.id;
  end if;
  return v_status;
end;
$$;

-- Daveti geri çek. Yöneten: davetli / "gelemem" / onay bekleyen davet → takım dışındakinde 'removed', üyede kayıt silinir.
-- Kadrodaki oyuncu: yalnızca kendi gönderdiği onay bekleyen davet (kayıt silinir). Döner: 'removed' · 'deleted'
create or replace function public.cancel_match_invite(p_match uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
  v_manager boolean;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  v_manager := public.can_manage_match(p_match);
  select * into v_e from match_entries where match_id = p_match and user_id = p_user;
  if v_e.id is null or v_e.status not in ('invited', 'declined', 'pending') or (v_e.status = 'pending' and v_e.source <> 'invite') then
    raise exception 'Geri çekilecek davet yok';
  end if;
  if not v_manager and not (v_e.status = 'pending' and v_e.added_by = auth.uid()) then
    raise exception 'Daveti sadece maçı yönetenler veya gönderen geri çeker';
  end if;
  if v_manager and not exists (select 1 from group_players
                                where group_id = v_m.group_id and user_id = p_user and left_at is null and not is_loan) then
    update match_entries set status = 'removed', queued_at = null, updated_at = now() where id = v_e.id;
    return 'removed';
  end if;
  delete from match_entries where id = v_e.id;
  return 'deleted';
end;
$$;
revoke all on function public.cancel_match_invite(uuid, uuid) from public, anon;
grant execute on function public.cancel_match_invite(uuid, uuid) to authenticated;

-- Davet düşünce o kişiye giden maç kartları iptal olur
create or replace function public.revoke_match_cards()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_revoke boolean;
begin
  if old.user_id is null then return null; end if;
  -- Maç siliniyorsa kart zaten "maç yok" olur
  if not exists (select 1 from matches where id = old.match_id) then return null; end if;
  if tg_op = 'DELETE' then
    v_revoke := true;
  else
    v_revoke := new.status in ('removed', 'rejected')
      or (new.status = 'left' and not exists (
            select 1 from group_players gp join matches m on m.group_id = gp.group_id
             where m.id = new.match_id and gp.user_id = new.user_id and gp.left_at is null and not gp.is_loan));
  end if;
  if v_revoke then
    update dm_messages d set revoked_at = now()
      from dm_threads t
     where t.id = d.thread_id and d.kind = 'match' and d.match_id = old.match_id and d.revoked_at is null
       and (t.user_a = old.user_id or t.user_b = old.user_id) and d.author_id is distinct from old.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.revoke_match_cards() from public, anon, authenticated;
create trigger revoke_match_cards after update of status or delete on public.match_entries
  for each row execute function public.revoke_match_cards();

-- İptal edilen kart "bu kişiye zaten gönderdin" sayılmaz
create or replace function public.share_match_card(p_user_id uuid, p_type text, p_ref uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_group groups;
  v_match matches;
  v_card jsonb;
  v_body text;
  v_thread uuid;
  v_id bigint;
begin
  if v_me is null then raise exception 'Giriş yapmalısınız'; end if;
  if p_user_id is null or p_user_id = v_me or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Geçersiz kişi';
  end if;
  if public.dm_blocked(v_me, p_user_id) then raise exception 'Bu kişiye davet gönderilemiyor'; end if;
  if p_type is distinct from 'match' then raise exception 'Geçersiz davet türü'; end if;

  select * into v_match from matches where id = p_ref;
  if not found or v_match.status::text not in ('gathering', 'planned') then
    raise exception 'Maç bulunamadı veya artık açık değil';
  end if;
  if not (public.can_manage_match(p_ref) or public.is_match_participant(p_ref)) then
    raise exception 'Maça sadece maçı yönetenler ve kadrodakiler çağırır';
  end if;
  if (select count(*) from dm_messages where author_id = v_me and kind = 'match' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Bugün çok fazla davet gönderdin, yarın tekrar dene';
  end if;
  select * into v_group from groups where id = v_match.group_id;

  -- Yöneten: onaysız davet; kadrodaki oyuncu: onaya düşen davet
  perform public.invite_to_match(p_ref, p_user_id);

  v_card := jsonb_build_object(
    'type', 'match', 'opponent', v_match.opponent_name, 'team_size', v_match.team_size,
    'capacity', v_match.capacity, 'time_tbd', v_match.time_tbd,
    'group_id', v_group.id, 'group_name', v_group.name, 'group_kind', v_group.kind,
    'starts_at', v_match.played_at, 'venue', v_match.venue);
  v_body := '⚽ Maç: ' || v_group.name || ' · ' || public.chat_tr_date(v_match.played_at) || coalesce(' · ' || v_match.venue, '');

  v_thread := public.start_dm(p_user_id);
  if exists (
    select 1 from dm_messages
     where thread_id = v_thread and kind = 'match' and match_id = p_ref and revoked_at is null
       and created_at > now() - interval '1 day'
  ) then
    raise exception 'Bu daveti bu kişiye zaten gönderdin';
  end if;
  insert into dm_messages (thread_id, author_id, kind, body, card, match_id)
  values (v_thread, v_me, 'match', left(v_body, 300), v_card, p_ref)
  returning id into v_id;
  update dm_threads set last_message_at = now(), last_author_id = v_me, last_body = left(v_body, 80) where id = v_thread;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Kadrodan çıkarma: takım dışındaki 'removed' olur
-- ---------------------------------------------------------------------------
create or replace function public.move_roster(p_match uuid, p_user uuid, p_player uuid, p_to text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
  v_from text;
  v_member boolean;
  v_gp group_players;
  v_a integer;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  if p_to not in ('in', 'reserve', 'out') then raise exception 'Geçersiz işlem'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Kadroyu sadece maçı kuran kişi veya yetkililer düzenler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;

  if p_user is not null then
    select * into v_e from match_entries where match_id = p_match and user_id = p_user;
    v_member := exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is null and not is_loan);
  else
    if not public.is_group_admin(v_m.group_id) then raise exception 'Misafiri sadece kaptan veya yetkili taşır'; end if;
    select * into v_gp from group_players where id = p_player and group_id = v_m.group_id and user_id is null;
    if v_gp.id is null then raise exception 'Misafir bulunamadı'; end if;
    select * into v_e from match_entries where match_id = p_match and player_id = p_player;
    if v_e.id is null then raise exception 'Misafir bu maçta değil'; end if;
  end if;
  v_from := coalesce(v_e.status, 'none');
  if v_from = 'pending' then raise exception 'Önce başvuruyu onayla veya reddet'; end if;

  if p_to = 'out' then
    if v_from not in ('in', 'reserve') then return v_from; end if;
    -- Misafir maçtan tamamen silinir (başka maçı yoksa oyuncu satırı da)
    if p_user is null then
      perform public.remove_match_guest(p_match, p_player);
      return v_from;
    end if;
    update match_entries set status = case when v_member then 'left' else 'removed' end, queued_at = null, updated_at = now()
     where id = v_e.id;
    delete from match_players mp
     where mp.match_id = p_match
       and mp.player_id in (select id from group_players where user_id = p_user);
    return v_from;
  end if;

  if v_from = p_to then return v_from; end if;

  if p_user is not null then
    -- Takım dışından biri yalnızca kadro ↔ yedek taşınır; ayrılan üye geri yazılmaz
    if not v_member and (
         v_from not in ('in', 'reserve')
         or exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is not null and not is_loan)
       ) then
      raise exception 'Bu kişi takımda değil; davet göndermen gerekir';
    end if;
  end if;

  if p_to = 'in' then
    if public.match_roster_count(p_match) >= v_m.capacity then raise exception 'Kadro dolu; önce birini çıkar'; end if;
    if p_user is not null then
      perform public.put_in_roster(v_m, p_user, v_e.position);
      update match_entries set source = case when v_e.id is null then 'organizer' else source end,
             added_by = auth.uid(), queued_at = null, updated_at = now()
       where match_id = p_match and user_id = p_user;
    else
      select count(*) filter (where team = 'A'), count(*) into v_a, v_total from match_players where match_id = p_match;
      insert into match_players (match_id, player_id, team, position, is_goalkeeper)
      values (p_match, p_player,
              case when v_m.kind = 'external' or v_m.status::text = 'gathering' or v_a <= v_total - v_a then 'A' else 'B' end,
              v_gp.position, coalesce(v_gp.position = 'GK', false))
      on conflict (match_id, player_id) do nothing;
      update match_entries set queued_at = null, updated_at = now() where id = v_e.id;
    end if;
    return v_from;
  end if;

  -- Yedeğe: önce kayıt güncellenir (kadrodan silme tetikleyicisi yalnızca 'in' kayda dokunur)
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, queued_at, added_by)
    values (p_match, p_user, 'reserve', 'organizer', now(), auth.uid());
  else
    update match_entries set status = 'reserve', queued_at = now(), added_by = auth.uid(), updated_at = now() where id = v_e.id;
    delete from match_players mp
     where mp.match_id = p_match
       and mp.player_id in (select id from group_players
                             where (p_user is not null and user_id = p_user) or (p_user is null and id = p_player));
  end if;
  return v_from;
end;
$$;

create or replace function public.manage_entry(p_match uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
  v_member boolean;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Kadroyu sadece maçı kuran kişi veya yetkililer düzenler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;
  select * into v_e from match_entries where match_id = p_match and user_id = p_user;
  v_member := exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is null and not is_loan);

  if p_action = 'add' then
    if not v_member then raise exception 'Kesin gelen olarak sadece üyeler eklenir'; end if;
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
    update match_entries set status = case when v_member then 'left' else 'removed' end, queued_at = null, updated_at = now()
     where id = v_e.id;
    delete from match_players mp using group_players gp
     where gp.id = mp.player_id and mp.match_id = p_match and gp.user_id = p_user;
  else
    raise exception 'Geçersiz işlem';
  end if;
end;
$$;

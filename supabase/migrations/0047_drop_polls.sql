-- Yeniden tasarım 5b (kullanıcı kararı 2026-11-25; uygulama henüz açılmadı, deneme verisi silinebilir):
-- eski çağrı yapısı (match_polls ve bağlıları, 0035-0041) kalkar. Yerini 0042-0046 aldı: tek maç kaydı, match_entries,
-- match_listings, match_codes. Eski çağrı kartları, sistem mesajları ve bildirimleri silinir.

-- ---------------------------------------------------------------------------
-- 1) Eski veriye bağlı satırlar
-- ---------------------------------------------------------------------------
delete from public.dm_messages where poll_id is not null;
delete from public.group_messages where poll_id is not null;
delete from public.notifications where url like '%/cagri/%';

-- ---------------------------------------------------------------------------
-- 2) Çağrıya bağlı tetikleyiciler (maç tablolarında) ve fonksiyonlar
-- ---------------------------------------------------------------------------
drop trigger if exists close_fill_polls_on_match_change on public.matches;
drop trigger if exists matches_delete_fill_polls on public.matches;
drop trigger if exists release_poll_spot_on_roster_removal on public.match_players;

drop function if exists public.accept_responder(uuid, uuid);
drop function if exists public.add_poll_guest(uuid, text, text);
drop function if exists public.remove_poll_guest(uuid);
drop function if exists public.chat_on_poll() cascade;
drop function if exists public.check_poll_limit(uuid);
drop function if exists public.close_fill_polls_on_match_change();
drop function if exists public.close_poll(uuid);
drop function if exists public.close_stale_polls(uuid);
drop function if exists public.create_fill_poll(uuid, smallint, text[], text, uuid);
drop function if exists public.create_gather_poll(uuid, date, timestamptz, text, smallint, smallint, timestamptz, text);
drop function if exists public.delete_fill_polls_of_match();
drop function if exists public.finalize_poll(uuid, timestamptz, text, smallint, text, uuid, text, jsonb, text, jsonb);
drop function if exists public.open_fill_polls(text, text);
drop function if exists public.poll_overview(uuid[]);
drop function if exists public.poll_responders(uuid);
drop function if exists public.reject_responder(uuid, uuid);
drop function if exists public.release_poll_spot_on_roster_removal();
drop function if exists public.respond_poll(uuid, text, text, text);
drop function if exists public.set_poll_public(uuid, boolean);
drop function if exists public.update_gather_poll(uuid, timestamptz, text, smallint, smallint, timestamptz, text);

-- Politikalar tabloyla gider; bu yardımcılar politikalarda kullanılıyordu, tablolardan sonra düşer (aşağıda)

-- ---------------------------------------------------------------------------
-- 3) Sütunlar ve tablolar
-- ---------------------------------------------------------------------------
alter table public.dm_messages drop constraint dm_messages_shape_check;
alter table public.dm_messages drop column poll_id;
-- 0039 gibi: grup/maç silinince bağlantısı boşalan kart geçmişte kalır (kartlar yalnızca RPC ile, bağlantı dolu eklenir)
alter table public.dm_messages
  add constraint dm_messages_shape_check check (
    kind in ('text', 'invite')
    or (kind = 'match' and card is not null)
  );
drop policy "üye mesaj yazar" on public.group_messages;
alter table public.group_messages drop column poll_id;
create policy "üye mesaj yazar" on public.group_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and public.is_group_member(group_id)
    and author_id = public.my_player_id(group_id)
    and match_id is null and deleted_at is null
  );
alter table public.match_proposals drop column poll_id;

drop table public.poll_invites;
drop table public.poll_guests;
drop table public.poll_responses;
drop table public.match_polls;

drop function if exists public.can_view_poll(uuid);
drop function if exists public.can_manage_poll(uuid);
drop function if exists public.poll_group(uuid);

-- ---------------------------------------------------------------------------
-- 4) Çağrıya değinen ama kalan fonksiyonlar
-- ---------------------------------------------------------------------------
-- Ayrılan üye: açık maçların kadrosundan çıkar (toplanan dahil), açık maçlardaki yedek/başvuru/davet kayıtları kapanır
create or replace function public.deactivate_member(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_gp group_players;
begin
  select * into v_gp from group_players where id = p_player_id;
  delete from match_players mp using matches m
   where m.id = mp.match_id and mp.player_id = p_player_id and m.status in ('planned', 'gathering');
  if v_gp.user_id is not null then
    update match_entries e set status = 'left', queued_at = null, updated_at = now()
      from matches m
     where m.id = e.match_id and m.group_id = v_gp.group_id and e.user_id = v_gp.user_id
       and m.status in ('planned', 'gathering') and e.status in ('reserve', 'pending', 'invited');
  end if;
  update group_players set left_at = now() where id = p_player_id;
end;
$$;

-- Dağıtma: açık maç (toplanan/kesin/skor/oylama) varsa olmaz; iptal/sonuçsuz/kapanmış maçlar arşivlemeye engel değil
create or replace function public.disband_team(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if public.group_kind(p_group) is distinct from 'team' then raise exception 'Sadece takım dağıtılır'; end if;
  if not public.is_group_captain(p_group) then raise exception 'Takımı sadece kaptan dağıtır'; end if;
  if exists (select 1 from matches where group_id = p_group and status in ('gathering', 'planned', 'played', 'voting')) then
    raise exception 'Toplanan, planlı veya oylaması süren maç var; önce o bitmeli ya da iptal edilmeli';
  end if;
  if exists (select 1 from matches where group_id = p_group) then
    update groups set archived_at = now() where id = p_group;
    update match_challenges set status = 'cancelled'
     where (from_group_id = p_group or to_group_id = p_group) and status = 'pending';
    update group_invites set status = 'cancelled' where group_id = p_group and status = 'pending';
    return 'archived';
  end if;
  delete from groups where id = p_group;
  return 'deleted';
end;
$$;

-- Sohbetten maç kartı = kişiye özel davet (0043); çağrı türü kalktı
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
     where thread_id = v_thread and kind = 'match' and match_id = p_ref and created_at > now() - interval '1 day'
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
revoke all on function public.share_match_card(uuid, text, uuid) from public, anon;
grant execute on function public.share_match_card(uuid, text, uuid) to authenticated;

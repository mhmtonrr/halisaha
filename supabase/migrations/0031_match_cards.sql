-- Maça davet kartı: sohbette paylaşılan ilan / çağrı / planlanmış maç kartı. Sadece ekleme + kısıt genişletme (eski kodla uyumlu:
-- eski istemci bilinmeyen türü düz mesaj gibi gösterir, body özet metin taşır).
--  * dm_messages.kind = 'match'; card: paylaşım anındaki özet (özel grubun içi alıcıya açılmasın diye ad/tarih/saha burada saklanır).
--  * Gönderen: o takımın/grubun kaptanı ve yetkilileri (davet kuralıyla aynı). Alıcı: herkes (engel iki yönde keser).
--  * Alıcı ilan kartından mevcut başvuru akışıyla başvurur; çağrı/maç kartı grubun üyesine yanıt verme, diğerine sadece özet.
--  * Spam: günde 20 kart, aynı kart aynı kişiye günde 1 kez.

alter table public.dm_messages
  add column card jsonb,
  add column listing_id uuid references public.player_listings (id) on delete set null,
  add column poll_id uuid references public.match_polls (id) on delete set null,
  add column match_id uuid references public.matches (id) on delete set null;

-- Eski kısıtları (tür listesi ve "davet kartı invite_id ister") yeni türü kapsayacak biçimde yenile
do $$
declare
  c record;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as d
      from pg_constraint
     where conrelid = 'public.dm_messages'::regclass and contype = 'c'
  loop
    if c.d like '%invite%' then
      execute format('alter table public.dm_messages drop constraint %I', c.conname);
    end if;
  end loop;
end $$;
alter table public.dm_messages
  add constraint dm_messages_kind_check check (kind in ('text', 'invite', 'match')),
  add constraint dm_messages_shape_check check (
    kind = 'text'
    or (kind = 'invite' and invite_id is not null)
    or (kind = 'match' and card is not null and (listing_id is not null or poll_id is not null or match_id is not null))
  );

-- Kartı bir kişiye gönder. p_type: 'listing' | 'poll' | 'match'. Dönüş: mesaj id.
create function public.share_match_card(p_user_id uuid, p_type text, p_ref uuid)
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

  -- Sadece o takımın/grubun kaptanı ve yetkilileri paylaşabilir
  if not public.is_group_admin(v_group.id) then
    raise exception 'Davet göndermek için kaptan veya yetkili olmalısınız';
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

revoke all on function public.share_match_card(uuid, text, uuid) from public, anon;
grant execute on function public.share_match_card(uuid, text, uuid) to authenticated;

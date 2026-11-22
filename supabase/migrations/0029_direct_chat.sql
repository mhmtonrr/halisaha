-- Birebir sohbet (DM) ve takıma/gruba davet. Sadece ekleme yapar.
--  * dm_threads: iki kişi arasında tek konuşma (user_a < user_b). Herkes herkese yazabilir; tanımadığı kişiye ilk mesaj
--    "istek" olarak düşer (status='pending'): kabul edilene kadar isteği gönderen en fazla 1 metin mesajı atabilir.
--  * dm_messages: metin veya davet kartı. Yazma sadece RPC ile (send_dm / invite_to_group).
--  * dm_reads: konuşma başına okuma işareti.
--  * group_invites: takıma/gruba davet. Sadece kaptan ve yetkililer gönderir; davet edilen kabul ederse üye olur.
--  * Engel (user_blocks) iki yönde de mesajı ve daveti keser.

create table public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  -- pending: istek bekliyor; accepted: açık sohbet; declined: alıcı isteği reddetti (gönderen yazamaz)
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  last_author_id uuid references public.profiles (id) on delete set null,
  last_body text not null default '',
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b)),
  unique (user_a, user_b)
);
create index on public.dm_threads (user_a, last_message_at desc);
create index on public.dm_threads (user_b, last_message_at desc);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  -- Davet edilen özel grubu görmeyebilir; kart için ad/tür davet anında saklanır
  group_name text not null,
  group_kind text not null check (group_kind in ('community', 'team')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (inviter_id <> invitee_id)
);
create unique index group_invites_pending_uq on public.group_invites (group_id, invitee_id) where status = 'pending';
create index on public.group_invites (invitee_id, created_at desc);
create index on public.group_invites (group_id, created_at desc);

create table public.dm_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'invite')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  invite_id uuid references public.group_invites (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'text' or invite_id is not null)
);
create index on public.dm_messages (thread_id, id desc);

create table public.dm_reads (
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_reads enable row level security;
alter table public.group_invites enable row level security;

-- Konuşmanın tarafı mıyım? (RLS özyinelemesi olmasın diye security definer)
create function public.dm_participant(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dm_threads
     where id = p_thread_id and auth.uid() in (user_a, user_b)
  )
$$;

-- İki kişi arasında (hangi yönde olursa olsun) engel var mı?
create function public.dm_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_blocks
     where (blocker_id = p_a and blocked_user_id = p_b)
        or (blocker_id = p_b and blocked_user_id = p_a)
  )
$$;

create policy "dm: taraflar konuşmayı görür" on public.dm_threads
  for select to authenticated using (auth.uid() in (user_a, user_b));
create policy "dm: taraflar mesajları görür" on public.dm_messages
  for select to authenticated using (public.dm_participant(thread_id));
create policy "dm: kendi okuma kaydını görür" on public.dm_reads
  for select to authenticated using (user_id = auth.uid());
create policy "davet: ilgililer görür" on public.group_invites
  for select to authenticated
  using (invitee_id = auth.uid() or inviter_id = auth.uid() or public.is_group_admin(group_id));

-- Konuşmayı bulur veya açar (yeni konuşma "istek" olarak başlar). Karşı taraf engellediyse/engellendiysse hata.
create function public.start_dm(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_user_id is null or p_user_id = v_me or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Geçersiz kişi';
  end if;
  if public.dm_blocked(v_me, p_user_id) then
    raise exception 'Bu kişiye mesaj gönderilemiyor';
  end if;
  select id into v_id from dm_threads where user_a = least(v_me, p_user_id) and user_b = greatest(v_me, p_user_id);
  if v_id is null then
    insert into dm_threads (user_a, user_b, requested_by)
    values (least(v_me, p_user_id), greatest(v_me, p_user_id), v_me)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Mesaj gönder. İstek bekleyen konuşmada gönderen en fazla 1 metin atar; alıcı yazarsa konuşma kabul edilmiş olur.
create function public.send_dm(p_thread_id uuid, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_t dm_threads;
  v_other uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_id bigint;
begin
  select * into v_t from dm_threads where id = p_thread_id;
  if v_t is null or v_me is null or v_me not in (v_t.user_a, v_t.user_b) then
    raise exception 'Konuşma bulunamadı';
  end if;
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'Mesaj 1-1000 karakter olmalı';
  end if;
  v_other := case when v_me = v_t.user_a then v_t.user_b else v_t.user_a end;
  if public.dm_blocked(v_me, v_other) then
    raise exception 'Bu kişiye mesaj gönderilemiyor';
  end if;
  if (select count(*) from dm_messages where author_id = v_me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Çok hızlı mesaj gönderiyorsun, biraz bekle';
  end if;

  if v_t.status = 'declined' and v_me = v_t.requested_by then
    raise exception 'Bu kişiye mesaj gönderilemiyor';
  end if;
  if v_t.status = 'pending' and v_me = v_t.requested_by
     and exists (select 1 from dm_messages where thread_id = p_thread_id and author_id = v_me and kind = 'text') then
    raise exception 'Karşı taraf isteği kabul edene kadar tek mesaj gönderebilirsin';
  end if;
  -- Alıcı yazdıysa istek kabul sayılır (reddedilmiş konuşma da yeniden açılır)
  if v_me <> v_t.requested_by and v_t.status <> 'accepted' then
    update dm_threads set status = 'accepted' where id = p_thread_id;
  end if;

  insert into dm_messages (thread_id, author_id, body) values (p_thread_id, v_me, v_body) returning id into v_id;
  update dm_threads set last_message_at = now(), last_author_id = v_me, last_body = left(v_body, 80) where id = p_thread_id;
  return v_id;
end;
$$;

-- İsteği kabul et / reddet (sadece isteği alan taraf)
create function public.respond_dm_request(p_thread_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t dm_threads;
begin
  select * into v_t from dm_threads where id = p_thread_id;
  if v_t is null or auth.uid() is null or auth.uid() not in (v_t.user_a, v_t.user_b) or auth.uid() = v_t.requested_by then
    raise exception 'İstek bulunamadı';
  end if;
  update dm_threads set status = case when p_accept then 'accepted' else 'declined' end where id = p_thread_id;
end;
$$;

-- Mesaj silme: sadece yazarı. İçerik saklanmaz. (Davet kartı silinemez.)
create function public.delete_dm_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_msg dm_messages;
begin
  select * into v_msg from dm_messages where id = p_message_id;
  if v_msg is null or v_msg.kind <> 'text' or v_msg.author_id <> auth.uid() then
    raise exception 'Bu mesajı silemezsiniz';
  end if;
  update dm_messages set deleted_at = now(), body = '—' where id = p_message_id;
  update dm_threads set last_body = '—'
   where id = v_msg.thread_id and not exists (select 1 from dm_messages where thread_id = v_msg.thread_id and id > p_message_id);
end;
$$;

create function public.mark_dm_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last bigint;
begin
  if not public.dm_participant(p_thread_id) then return; end if;
  select coalesce(max(id), 0) into v_last from dm_messages where thread_id = p_thread_id;
  insert into dm_reads (thread_id, user_id, last_read_id) values (p_thread_id, auth.uid(), v_last)
  on conflict (thread_id, user_id) do update
    set last_read_id = greatest(dm_reads.last_read_id, excluded.last_read_id), updated_at = now();
end;
$$;

-- Konuşma başına okunmamış sayısı (kendi mesajların ve reddedilen istekler hariç)
create function public.dm_unread_counts()
returns table (thread_id uuid, unread integer)
language sql stable security definer set search_path = public as $$
  select t.id, count(m.id)::int
    from dm_threads t
    join dm_messages m on m.thread_id = t.id and m.author_id <> auth.uid() and m.deleted_at is null
    left join dm_reads r on r.thread_id = t.id and r.user_id = auth.uid()
   where auth.uid() in (t.user_a, t.user_b)
     and t.status <> 'declined'
     and m.id > coalesce(r.last_read_id, 0)
   group by t.id
$$;

-- Takıma/gruba davet: sadece kaptan ve yetkililer. Davet kartı konuşmaya düşer; konuşma yoksa istek olarak açılır.
create function public.invite_to_group(p_group_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_g groups;
  v_thread uuid;
  v_invite uuid;
begin
  if v_me is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if not public.is_group_admin(p_group_id) then
    raise exception 'Davet göndermek için kaptan veya yetkili olmalısınız';
  end if;
  select * into v_g from groups where id = p_group_id;
  if p_user_id is null or p_user_id = v_me or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Geçersiz kişi';
  end if;
  if public.dm_blocked(v_me, p_user_id) then
    raise exception 'Bu kişiye davet gönderilemiyor';
  end if;
  if exists (select 1 from group_players where group_id = p_group_id and user_id = p_user_id and left_at is null and not is_loan) then
    raise exception 'Bu kişi zaten üye';
  end if;
  if exists (select 1 from group_invites where group_id = p_group_id and invitee_id = p_user_id and status = 'pending') then
    raise exception 'Bu kişiye zaten bekleyen bir davet var';
  end if;
  if (select count(*) from group_invites where inviter_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Bugün çok fazla davet gönderdin, yarın tekrar dene';
  end if;

  insert into group_invites (group_id, inviter_id, invitee_id, group_name, group_kind)
  values (p_group_id, v_me, p_user_id, v_g.name, v_g.kind)
  returning id into v_invite;

  v_thread := public.start_dm(p_user_id);
  insert into dm_messages (thread_id, author_id, kind, body, invite_id)
  values (v_thread, v_me, 'invite',
          case when v_g.kind = 'team' then '🛡️ Takım daveti: ' else '👥 Grup daveti: ' end || v_g.name,
          v_invite);
  update dm_threads set last_message_at = now(), last_author_id = v_me,
         last_body = left(case when v_g.kind = 'team' then '🛡️ Takım daveti: ' else '👥 Grup daveti: ' end || v_g.name, 80)
   where id = v_thread;
  -- Davet edilen kişi daha önce bu konuşmayı yazdıysa/kabul ettiyse durum değişmez
  return v_invite;
end;
$$;

-- Daveti kabul et / reddet (sadece davet edilen). Kabul = gruba/takıma katılma (join_group ile aynı kurallar).
create function public.respond_group_invite(p_invite_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv group_invites;
begin
  select * into v_inv from group_invites where id = p_invite_id;
  if v_inv is null or v_inv.invitee_id is distinct from auth.uid() then
    raise exception 'Davet bulunamadı';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Bu davet artık geçerli değil';
  end if;
  if p_accept then
    if not exists (select 1 from groups where id = v_inv.group_id) then
      raise exception 'Bu takım/grup artık yok';
    end if;
    insert into group_players (group_id, user_id, display_name, position)
    select v_inv.group_id, auth.uid(), display_name, preferred_position
      from profiles where id = auth.uid()
    on conflict (group_id, user_id) do update
      set is_loan = false,
          role = case when group_players.left_at is not null then 'member' else group_players.role end,
          left_at = null;
  end if;
  update group_invites
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_invite_id;
  return v_inv.group_id;
end;
$$;

-- Daveti geri çek (davet eden veya takım/grubun yetkilisi)
create function public.cancel_group_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inv group_invites;
begin
  select * into v_inv from group_invites where id = p_invite_id;
  if v_inv is null or (v_inv.inviter_id is distinct from auth.uid() and not public.is_group_admin(v_inv.group_id)) then
    raise exception 'Davet bulunamadı';
  end if;
  update group_invites set status = 'cancelled', responded_at = now() where id = p_invite_id and status = 'pending';
end;
$$;

revoke all on function public.dm_participant(uuid), public.dm_blocked(uuid, uuid), public.start_dm(uuid),
  public.send_dm(uuid, text), public.respond_dm_request(uuid, boolean), public.delete_dm_message(bigint),
  public.mark_dm_read(uuid), public.dm_unread_counts(), public.invite_to_group(uuid, uuid),
  public.respond_group_invite(uuid, boolean), public.cancel_group_invite(uuid) from public, anon;
grant execute on function public.dm_participant(uuid), public.start_dm(uuid), public.send_dm(uuid, text),
  public.respond_dm_request(uuid, boolean), public.delete_dm_message(bigint), public.mark_dm_read(uuid),
  public.dm_unread_counts(), public.invite_to_group(uuid, uuid), public.respond_group_invite(uuid, boolean),
  public.cancel_group_invite(uuid) to authenticated;

-- Bildirim türleri: birebir mesaj ve davet (eski kodla uyumlu: sadece genişler)
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('vote', 'poll', 'match', 'offer', 'listing', 'chat', 'dm', 'invite'));

-- Canlı güncelleme (Realtime, RLS'e uyar)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.dm_messages;
    alter publication supabase_realtime add table public.dm_threads;
    alter publication supabase_realtime add table public.group_invites;
  end if;
end $$;

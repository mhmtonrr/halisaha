-- Arkadaşlık: karşılıklı onaylı. Sadece ekleme yapar (start_dm ve bildirim türü kısıtı genişler; eski kodla uyumlu).
--  * friendships: iki kişi arasında tek satır (user_a < user_b). pending = istek bekliyor, accepted = arkadaş.
--  * Arkadaşlar arasında mesaj isteği aşaması yoktur: yeni konuşma doğrudan 'accepted' açılır; bekleyen bir konuşma varsa
--    arkadaşlık kabul edilince açık sohbete döner.
--  * Karşılıklı istek (ikisi de birbirine istek attı) kendiliğinden kabul sayılır.
--  * Engel arkadaşlığı ve bekleyen isteği siler; engelli kişiye istek atılamaz.
--  * Yazma sadece RPC ile.

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (user_a < user_b),
  check (requested_by in (user_a, user_b)),
  unique (user_a, user_b)
);
create index on public.friendships (user_a, status);
create index on public.friendships (user_b, status);

alter table public.friendships enable row level security;
create policy "arkadaşlık: taraflar görür" on public.friendships
  for select to authenticated using (auth.uid() in (user_a, user_b));

create function public.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
     where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b) and status = 'accepted'
  )
$$;

-- Konuşma açılırken arkadaşsa doğrudan açık sohbet (yoksa istek). Diğer kurallar 0029 ile aynı.
create or replace function public.start_dm(p_user_id uuid)
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
    insert into dm_threads (user_a, user_b, requested_by, status)
    values (least(v_me, p_user_id), greatest(v_me, p_user_id), v_me,
            case when public.are_friends(v_me, p_user_id) then 'accepted' else 'pending' end)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Arkadaşlık isteği gönder. Dönüş: 'pending' (istek gitti / zaten bekliyor), 'accepted' (karşı taraf da istemişti veya zaten arkadaş)
create function public.send_friend_request(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_f friendships;
begin
  if v_me is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_user_id is null or p_user_id = v_me or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Geçersiz kişi';
  end if;
  if public.dm_blocked(v_me, p_user_id) then
    raise exception 'Bu kişiye arkadaşlık isteği gönderilemiyor';
  end if;
  select * into v_f from friendships where user_a = least(v_me, p_user_id) and user_b = greatest(v_me, p_user_id);
  if found then
    if v_f.status = 'accepted' then
      return 'accepted';
    end if;
    if v_f.requested_by = v_me then
      return 'pending';
    end if;
    -- Karşı taraf bana istek atmıştı: kabul sayılır
    perform public.respond_friend_request(p_user_id, true);
    return 'accepted';
  end if;
  if (select count(*) from friendships where requested_by = v_me and status = 'pending' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Bugün çok fazla arkadaşlık isteği gönderdin, yarın tekrar dene';
  end if;
  insert into friendships (user_a, user_b, requested_by)
  values (least(v_me, p_user_id), greatest(v_me, p_user_id), v_me);
  return 'pending';
end;
$$;

-- İsteği kabul et / reddet (sadece isteği alan taraf). Reddedilen istek silinir (sessizce).
create function public.respond_friend_request(p_user_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_f friendships;
begin
  select * into v_f from friendships
   where user_a = least(v_me, p_user_id) and user_b = greatest(v_me, p_user_id) and status = 'pending';
  if not found or v_f.requested_by = v_me then
    raise exception 'İstek bulunamadı';
  end if;
  if p_accept then
    if public.dm_blocked(v_me, p_user_id) then
      raise exception 'Bu istek kabul edilemiyor';
    end if;
    update friendships set status = 'accepted', responded_at = now() where id = v_f.id;
    -- Bekleyen mesaj isteği varsa açık sohbete dönsün
    update dm_threads set status = 'accepted'
     where user_a = v_f.user_a and user_b = v_f.user_b and status <> 'accepted';
  else
    delete from friendships where id = v_f.id;
  end if;
end;
$$;

-- Arkadaşlıktan çık veya kendi gönderdiğin bekleyen isteği geri çek
create function public.remove_friendship(p_user_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from friendships
   where user_a = least(auth.uid(), p_user_id) and user_b = greatest(auth.uid(), p_user_id)
     and (status = 'accepted' or requested_by = auth.uid())
$$;

-- Engel: arkadaşlığı ve bekleyen isteği bitirir
create function public.drop_friendship_on_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.blocked_user_id is not null then
    delete from friendships
     where user_a = least(new.blocker_id, new.blocked_user_id) and user_b = greatest(new.blocker_id, new.blocked_user_id);
  end if;
  return new;
end;
$$;
create trigger drop_friendship_on_block after insert on public.user_blocks
  for each row execute function public.drop_friendship_on_block();

revoke all on function public.are_friends(uuid, uuid), public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean), public.remove_friendship(uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid), public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean), public.remove_friendship(uuid) to authenticated;

-- Bildirim türü: arkadaşlık (eski kodla uyumlu: sadece genişler)
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('vote', 'poll', 'match', 'offer', 'listing', 'chat', 'dm', 'invite', 'friend'));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;

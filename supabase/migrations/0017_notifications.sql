-- Bildirimler: uygulama içi bildirim kutusu + web push.
--  * notifications: her olay önce buraya yazılır (sadece sunucu/servis anahtarı yazar), sonra push gönderilir.
--    Kullanıcı sadece kendi bildirimlerini okur ve okundu işaretler. Push izni olmasa da kutuda görünür.
--  * push_subscriptions: cihaz abonelikleri (endpoint benzersiz; aynı cihaza başka kullanıcı girerse abonelik ona geçer).
--  * notification_prefs: kategori tercihleri (satır yoksa hepsi açık).

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- vote: oylama; poll/match: çağrı ve maç; offer/listing: teklif ve oyuncu ilanı; chat: sohbet
  type text not null check (type in ('vote', 'poll', 'match', 'offer', 'listing', 'chat')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 300),
  -- Uygulama içi yol (açık yönlendirme/XSS olmasın diye sadece "/" ile başlar)
  url text not null check (url ~ '^/[^/\\]'),
  -- Aynı etiketli push bildirimi cihazda birbirinin yerine geçer; sohbet birleştirmesi de bunu kullanır
  tag text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (user_id, tag, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  votes boolean not null default true,
  matches boolean not null default true,
  offers boolean not null default true,
  chat boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;

-- Bildirimler: sadece kendi satırları okunur. Yazma yok (servis anahtarı RLS'i atlar); okundu RPC ile.
create policy "kendi bildirimlerini gör" on public.notifications
  for select to authenticated using (user_id = auth.uid());

-- Abonelikler: kendi aboneliklerini görür; yazma/silme RPC ile
create policy "kendi aboneliklerini gör" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- Tercihler: kendi satırını okur/yazar
create policy "kendi tercihlerini gör" on public.notification_prefs
  for select to authenticated using (user_id = auth.uid());
create policy "kendi tercihini ekle" on public.notification_prefs
  for insert to authenticated with check (user_id = auth.uid());
create policy "kendi tercihini güncelle" on public.notification_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Okundu işaretle: verilen id'ler (boşsa hepsi); sadece kendi bildirimleri
create function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any (p_ids))
$$;

-- Cihaz aboneliği: aynı endpoint başka kullanıcıya aitse (aynı cihazda hesap değişimi) ona geçer
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then
    raise exception 'Geçersiz abonelik';
  end if;
  -- Kullanıcı başına en fazla 10 cihaz (en eskiler silinir)
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
  delete from push_subscriptions
   where user_id = auth.uid()
     and id not in (select id from push_subscriptions where user_id = auth.uid() order by created_at desc limit 10);
end;
$$;

create function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint
$$;

-- Canlı güncelleme (Realtime, RLS'e uyar): yeni bildirim rozeti kendiliğinden güncellensin
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

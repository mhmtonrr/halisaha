-- Grup/takım sohbeti: gerçek zamanlı mesajlar, etkinlik kartları, okunmamış sayısı.

create table public.group_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Sistem mesajlarında (etkinlik kartları) yazar yoktur
  author_id uuid references public.group_players (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  poll_id uuid references public.match_polls (id) on delete set null,
  match_id uuid references public.matches (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'system' or author_id is not null)
);
create index on public.group_messages (group_id, id desc);

-- Her oyuncunun sohbeti en son ne zaman okuduğu
create table public.chat_reads (
  player_id uuid primary key references public.group_players (id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.group_messages enable row level security;
alter table public.chat_reads enable row level security;

-- Sohbet sadece üyelere (takımlar herkese açık olsa da)
create policy "üyeler sohbeti görür" on public.group_messages
  for select to authenticated using (public.is_group_member(group_id));

-- Sadece kendi adına, hesabı olan üye olarak, düz metin
create policy "üye mesaj yazar" on public.group_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and author_id = public.my_player_id(group_id)
    and poll_id is null and match_id is null and deleted_at is null
  );

create policy "kendi okuma kaydını görür" on public.chat_reads
  for select to authenticated
  using (exists (select 1 from public.group_players gp where gp.id = player_id and gp.user_id = auth.uid()));

-- Spam koruması: kişi başı dakikada en fazla 20 mesaj
create function public.chat_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'text' and (
    select count(*) from group_messages
     where author_id = new.author_id and created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'Çok hızlı mesaj gönderiyorsun, biraz bekle';
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;
create trigger chat_rate_limit before insert on public.group_messages
  for each row execute function public.chat_rate_limit();

-- Mesaj silme: yazarı veya grubun yetkilisi. İçerik saklanmaz.
create function public.delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_msg group_messages;
begin
  select * into v_msg from group_messages where id = p_message_id;
  if v_msg is null or v_msg.kind <> 'text' then
    raise exception 'Mesaj bulunamadı';
  end if;
  if v_msg.author_id is distinct from public.my_player_id(v_msg.group_id)
     and not public.is_group_admin(v_msg.group_id) then
    raise exception 'Bu mesajı silemezsiniz';
  end if;
  update group_messages set deleted_at = now(), body = '—' where id = p_message_id;
end;
$$;

create function public.mark_chat_read(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.my_player_id(p_group_id);
  v_last bigint;
begin
  if v_me is null then return; end if;
  select coalesce(max(id), 0) into v_last from group_messages where group_id = p_group_id;
  insert into chat_reads (player_id, last_read_id) values (v_me, v_last)
  on conflict (player_id) do update set last_read_id = greatest(chat_reads.last_read_id, excluded.last_read_id), updated_at = now();
end;
$$;

-- Kullanıcının tüm grupları için okunmamış mesaj sayısı (kendi mesajları hariç)
create function public.unread_counts()
returns table (group_id uuid, unread integer)
language sql stable security definer set search_path = public as $$
  select gp.group_id, count(m.id)::int
    from group_players gp
    left join chat_reads r on r.player_id = gp.id
    join group_messages m on m.group_id = gp.group_id
                         and m.id > coalesce(r.last_read_id, 0)
                         and m.deleted_at is null
                         and m.author_id is distinct from gp.id
   where gp.user_id = auth.uid()
   group by gp.group_id
$$;

-- ---------------------------------------------------------------------------
-- Etkinlik kartları: çağrı açıldı, maç kuruldu, sonuçlar açıklandı
-- ---------------------------------------------------------------------------
create function public.chat_tr_date(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'Europe/Istanbul', 'DD.MM HH24:MI')
$$;

create function public.chat_on_poll()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_messages (group_id, kind, body, poll_id)
  values (new.group_id, 'system',
          '📣 Maç çağrısı açıldı: ' || public.chat_tr_date(new.starts_at)
            || coalesce(' · ' || new.venue, '') || ' · ' || new.capacity || ' kişi',
          new.id);
  return new;
end;
$$;
create trigger chat_on_poll after insert on public.match_polls
  for each row execute function public.chat_on_poll();

create function public.chat_on_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            '⚽ Maç kuruldu: ' || public.chat_tr_date(new.played_at)
              || case when new.kind = 'external' then ' · vs ' || new.opponent_name else '' end
              || coalesce(' · ' || new.venue, ''),
            new.id);
  elsif new.status = 'voting' and old.status = 'planned' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            '🗳️ Maç bitti (' || new.score_a || '-' || new.score_b || '). Oylama açıldı, takım arkadaşlarını puanla!',
            new.id);
  end if;
  -- "Sonuçlar açıklandı" mesajı, hesaplama başarıyla bitince sunucu tarafından yazılır
  return new;
end;
$$;
create trigger chat_on_match after insert or update of status on public.matches
  for each row execute function public.chat_on_match();

-- Gerçek zamanlı yayın (Realtime, RLS'e uyar: sadece üyeler alır)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;

-- Maç çağrısı (anket): yetkili "Cuma 22:00 Petroller, 14 kişi" diye çağrı açar,
-- üyeler geliyorum/belki/gelemem der, yetkili kadroyu onaylar, onaylananlarla maç kurulur.

create table public.match_polls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  starts_at timestamptz not null,
  venue text check (char_length(venue) <= 80),
  capacity smallint not null default 14 check (capacity between 2 and 40),
  deadline timestamptz,
  note text check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'closed', 'converted')),
  match_id uuid references public.matches (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.match_polls (group_id, starts_at desc);

create table public.poll_responses (
  poll_id uuid not null references public.match_polls (id) on delete cascade,
  player_id uuid not null references public.group_players (id) on delete cascade,
  answer text not null check (answer in ('yes', 'maybe', 'no')),
  approved boolean not null default false,
  -- Kontenjan sırası için: "geliyorum" dendiği an
  responded_at timestamptz not null default now(),
  primary key (poll_id, player_id),
  check (approved = false or answer = 'yes')
);

create function public.poll_group(p_poll_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from match_polls where id = p_poll_id
$$;

alter table public.match_polls enable row level security;
alter table public.poll_responses enable row level security;

create policy "üyeler çağrıları görür" on public.match_polls
  for select to authenticated using (public.is_group_member(group_id));
create policy "yetkili çağrı açar" on public.match_polls
  for insert to authenticated
  with check (created_by = auth.uid() and public.is_group_admin(group_id));
create policy "yetkili çağrıyı düzenler" on public.match_polls
  for update to authenticated using (public.is_group_admin(group_id));
create policy "yetkili çağrıyı siler" on public.match_polls
  for delete to authenticated using (public.is_group_admin(group_id));

-- Yanıtlar herkese (grup içinde) açık; yazma sadece RPC'lerle
create policy "üyeler yanıtları görür" on public.poll_responses
  for select to authenticated using (public.is_group_member(public.poll_group(poll_id)));

-- Kendi yanıtını ver/değiştir. "Geliyorum"dan vazgeçen onayını kaybeder ve
-- tekrar geliyorum derse sıranın sonuna geçer.
create function public.respond_poll(p_poll_id uuid, p_answer text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_poll match_polls;
  v_me uuid;
begin
  select * into v_poll from match_polls where id = p_poll_id;
  if v_poll is null then
    raise exception 'Çağrı bulunamadı';
  end if;
  v_me := public.my_player_id(v_poll.group_id);
  if v_me is null then
    raise exception 'Bu grubun üyesi değilsiniz';
  end if;
  if v_poll.status <> 'open' or (v_poll.deadline is not null and now() > v_poll.deadline) then
    raise exception 'Bu çağrı yanıtlara kapandı';
  end if;
  if p_answer not in ('yes', 'maybe', 'no') then
    raise exception 'Geçersiz yanıt';
  end if;

  insert into poll_responses (poll_id, player_id, answer)
  values (p_poll_id, v_me, p_answer)
  on conflict (poll_id, player_id) do update
    set answer = excluded.answer,
        approved = case when excluded.answer = 'yes' then poll_responses.approved else false end,
        responded_at = case when poll_responses.answer = 'yes' and excluded.answer = 'yes'
                            then poll_responses.responded_at else now() end;
end;
$$;

-- Yetkili: tek oyuncunun onayını aç/kapat
create function public.set_poll_approval(p_poll_id uuid, p_player_id uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(public.poll_group(p_poll_id)) then
    raise exception 'Kadroyu sadece yetkililer onaylar';
  end if;
  update poll_responses set approved = p_approved
   where poll_id = p_poll_id and player_id = p_player_id and answer = 'yes';
  if not found then
    raise exception 'Sadece "geliyorum" diyenler onaylanabilir';
  end if;
end;
$$;

-- Yetkili: kontenjan kadar ilk "geliyorum" diyeni onayla (diğerlerinin onayını kaldırır)
create function public.approve_first_responders(p_poll_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_capacity smallint;
  v_count integer;
begin
  if not public.is_group_admin(public.poll_group(p_poll_id)) then
    raise exception 'Kadroyu sadece yetkililer onaylar';
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

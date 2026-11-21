-- Oyuncu arama ilanı ve ödünç oyuncu.
--  * Takım, planlanmış bir maçı için "oyuncu arıyoruz" ilanı açar (kaç kişi, mevkiler, isteğe bağlı minimum rating).
--    İlan herkese açıktır (Keşfet + takım sayfası + paylaşılabilir link); hesabı olan herkes başvurabilir.
--  * Kaptan/yetkili başvuranları (rating, mevki, güvenilirlik) görüp tek tek kabul eder. Kabul edilen oyuncu takımın
--    asıl kadrosuna girmez: o maçın kadrosuna "ödünç" (group_players.is_loan) olarak eklenir, Misafirler sekmesinde görünür.
--  * Ödünç oyuncu oy verir/oylanır, genel ratingi geçerlidir; ama takım sohbetine, teklif/çağrı sayfalarına ve
--    "üye" yetkilerine sahip değildir (is_group_member onu saymaz). Davet koduyla katılırsa kalıcı üye olur.
--  * Güvenilirlik: maç sonucu girilirken "gelmedi" işaretlenenler kaydedilir (match_no_shows); başvuranın
--    oynadığı maç / gelmedi sayısı başvuruda gösterilir.

-- ---------------------------------------------------------------------------
-- Ödünç oyuncu
-- ---------------------------------------------------------------------------
alter table public.group_players
  add column is_loan boolean not null default false,
  add constraint loan_is_account check (not is_loan or user_id is not null);

-- Ödünç oyuncuya yetki verilemez
create function public.guard_loan_role()
returns trigger language plpgsql as $$
begin
  if new.is_loan and new.role <> 'member' then
    raise exception 'Ödünç oyuncuya yetki verilemez';
  end if;
  return new;
end;
$$;
create trigger guard_loan_role before insert or update of role, is_loan on public.group_players
  for each row execute function public.guard_loan_role();

-- Üyelik: ödünç oyuncu üye sayılmaz (sohbet, teklif, çağrı, yetki kontrolleri bunu kullanır)
create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and not is_loan
  )
$$;

-- Okunmamış sohbet sayacı ödünç oyuncuyu saymaz
create or replace function public.unread_counts()
returns table (group_id uuid, unread integer)
language sql stable security definer set search_path = public as $$
  select gp.group_id, count(m.id)::int
    from group_players gp
    left join chat_reads r on r.player_id = gp.id
    join group_messages m on m.group_id = gp.group_id
                         and m.id > coalesce(r.last_read_id, 0)
                         and m.deleted_at is null
                         and m.author_id is distinct from gp.id
   where gp.user_id = auth.uid() and not gp.is_loan
   group by gp.group_id
$$;

-- Davet koduyla katılan ödünç oyuncu kalıcı üye olur
create or replace function public.join_group(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  select id into v_group_id from groups where invite_code = p_invite_code;
  if v_group_id is null then
    raise exception 'Geçersiz davet kodu';
  end if;
  insert into group_players (group_id, user_id, display_name, position)
  select v_group_id, auth.uid(), display_name, preferred_position
  from profiles where id = auth.uid()
  on conflict (group_id, user_id) do update set is_loan = false;
  return v_group_id;
end;
$$;

-- Sohbete sadece üyeler yazar (ödünç oyuncu satırı olsa da yazamaz)
drop policy "üye mesaj yazar" on public.group_messages;
create policy "üye mesaj yazar" on public.group_messages
  for insert to authenticated
  with check (
    kind = 'text'
    and public.is_group_member(group_id)
    and author_id = public.my_player_id(group_id)
    and poll_id is null and match_id is null and deleted_at is null
  );

-- Çağrıya sadece üyeler yanıt verir
create or replace function public.respond_poll(p_poll_id uuid, p_answer text)
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
  if v_me is null or not public.is_group_member(v_poll.group_id) then
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

-- Oylama sayacı: üyeler ve o maçın kadrosundaki oyuncular (ödünç oyuncu dahil) görür
create or replace function public.voting_progress(p_match_id uuid)
returns table (voters integer, eligible integer)
language sql stable security definer set search_path = public as $$
  with ms as (
    select id from matches
     where id = p_match_id
        or (challenge_id is not null
            and challenge_id = (select challenge_id from matches where id = p_match_id))
  )
  select
    (select count(distinct voter_id)::int from votes where match_id in (select id from ms)),
    (select count(*)::int from match_players mp
       join group_players gp on gp.id = mp.player_id
      where mp.match_id in (select id from ms) and gp.user_id is not null)
  where public.is_group_member(public.match_group(p_match_id))
     or exists (
       select 1 from match_players mp
         join group_players gp on gp.id = mp.player_id
        where mp.match_id in (select id from ms) and gp.user_id = auth.uid()
     )
$$;

-- ---------------------------------------------------------------------------
-- İlanlar ve başvurular
-- ---------------------------------------------------------------------------
create table public.player_listings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  needed smallint not null check (needed between 1 and 10),
  positions text[] not null default '{}' check (positions <@ array['GK', 'DEF', 'MID', 'FWD']),
  min_overall smallint check (min_overall between 40 and 99),
  note text check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'filled', 'closed')),
  created_at timestamptz not null default now()
);
create index on public.player_listings (status, created_at desc);
create index on public.player_listings (match_id);
create index on public.player_listings (group_id, status);

create table public.listing_applications (
  listing_id uuid not null references public.player_listings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  note text check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (listing_id, user_id)
);
create index on public.listing_applications (user_id, status);

-- Maç sonucu girilirken "gelmedi" işaretlenenler (güvenilirlik için)
create table public.match_no_shows (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index on public.match_no_shows (user_id);

create function public.listing_group(p_listing uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from player_listings where id = p_listing
$$;

alter table public.player_listings enable row level security;
alter table public.listing_applications enable row level security;
alter table public.match_no_shows enable row level security;

-- İlanlar herkese açık (giriş yapmış herkes görür); yazma sadece RPC
create policy "ilanlar herkese açık" on public.player_listings
  for select to authenticated using (true);
-- Başvuruyu başvuran ve ilanın takımının yetkilileri görür
create policy "başvuruyu sahibi ve yetkililer görür" on public.listing_applications
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_admin(public.listing_group(listing_id)));
create policy "gelmediyi sahibi ve yetkililer görür" on public.match_no_shows
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_admin(public.match_group(match_id)));

-- ---------------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------------

-- İlan aç: takımın kaptan/yetkilisi, planlanmış gelecekteki rakip maçı için
create function public.create_listing(
  p_match uuid, p_needed smallint, p_positions text[], p_min_overall smallint, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  select * into v_m from matches where id = p_match;
  if v_m.id is null then
    raise exception 'Maç bulunamadı';
  end if;
  if public.group_kind(v_m.group_id) is distinct from 'team' then
    raise exception 'Oyuncu ilanı sadece takımlar içindir';
  end if;
  if not public.is_group_admin(v_m.group_id) then
    raise exception 'İlanı sadece kaptan ve yetkililer açar';
  end if;
  if v_m.status <> 'planned' or v_m.played_at < now() then
    raise exception 'İlan sadece planlanmış, gelecekteki maç için açılır';
  end if;
  if p_needed is null or p_needed not between 1 and 10 then
    raise exception 'Aranan oyuncu sayısı 1 ile 10 arasında olmalı';
  end if;
  if exists (select 1 from unnest(coalesce(p_positions, '{}'::text[])) x where x not in ('GK', 'DEF', 'MID', 'FWD')) then
    raise exception 'Geçersiz mevki';
  end if;
  if exists (select 1 from player_listings where match_id = p_match and status = 'open') then
    raise exception 'Bu maç için zaten açık bir ilan var';
  end if;
  if (select count(*) from player_listings where group_id = v_m.group_id and status = 'open') >= 5 then
    raise exception 'Takımın en fazla 5 açık ilanı olabilir';
  end if;

  insert into player_listings (group_id, match_id, created_by, needed, positions, min_overall, note)
  values (v_m.group_id, p_match, auth.uid(), p_needed, coalesce(p_positions, '{}'::text[]), p_min_overall, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.close_listing(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l player_listings;
begin
  select * into v_l from player_listings where id = p_listing;
  if v_l.id is null then
    raise exception 'İlan bulunamadı';
  end if;
  if not public.is_group_admin(v_l.group_id) then
    raise exception 'İlanı sadece kaptan ve yetkililer kapatır';
  end if;
  if v_l.status <> 'open' then
    raise exception 'İlan zaten kapalı';
  end if;
  update player_listings set status = 'closed' where id = p_listing;
end;
$$;

-- Başvur: hesabı olan herkes; takımın oyuncusu, maçta zaten olan veya rakip kadrodaki başvuramaz
create function public.apply_listing(p_listing uuid, p_position text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l player_listings;
  v_m matches;
  v_overall integer;
  v_app listing_applications;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  select * into v_l from player_listings where id = p_listing;
  if v_l.id is null then
    raise exception 'İlan bulunamadı';
  end if;
  if v_l.status <> 'open' then
    raise exception 'Bu ilan kapandı';
  end if;
  select * into v_m from matches where id = v_l.match_id;
  if v_m.status <> 'planned' or v_m.played_at < now() then
    raise exception 'Bu maç artık başvuruya kapalı';
  end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then
    raise exception 'Geçersiz mevki';
  end if;
  if exists (
    select 1 from group_players gp
     where gp.group_id = v_l.group_id and gp.user_id = auth.uid() and not gp.is_loan
  ) then
    raise exception 'Bu takımın oyuncususun; kaptan seni doğrudan kadroya ekleyebilir';
  end if;
  if exists (
    select 1 from match_players mp
      join group_players gp on gp.id = mp.player_id
      join matches m on m.id = mp.match_id
     where gp.user_id = auth.uid()
       and (m.id = v_l.match_id or (v_m.challenge_id is not null and m.challenge_id = v_m.challenge_id))
  ) then
    raise exception 'Bu maçın kadrosundasın veya rakip takımda yer alıyorsun';
  end if;

  select pr.overall into v_overall
    from player_ratings pr join group_players gp on gp.id = pr.player_id
   where gp.user_id = auth.uid()
   order by pr.updated_at desc limit 1;
  v_overall := coalesce(v_overall, 65);
  if v_l.min_overall is not null and v_overall < v_l.min_overall then
    raise exception 'Bu ilan için en az % rating gerekiyor (seninki %)', v_l.min_overall, v_overall;
  end if;

  select * into v_app from listing_applications where listing_id = p_listing and user_id = auth.uid();
  if v_app.listing_id is not null and v_app.status = 'rejected' then
    raise exception 'Başvurun reddedildi';
  end if;
  if v_app.listing_id is not null and v_app.status = 'accepted' then
    raise exception 'Zaten kabul edildin';
  end if;
  if v_app.listing_id is null and (
    select count(*) from listing_applications where user_id = auth.uid() and status = 'pending'
  ) >= 10 then
    raise exception 'En fazla 10 bekleyen başvurun olabilir';
  end if;

  insert into listing_applications (listing_id, user_id, position, note)
  values (p_listing, auth.uid(), p_position, nullif(btrim(p_note), ''))
  on conflict (listing_id, user_id) do update
    set status = 'pending', position = excluded.position, note = excluded.note,
        created_at = now(), decided_at = null;
end;
$$;

create function public.withdraw_application(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update listing_applications set status = 'withdrawn', decided_at = now()
   where listing_id = p_listing and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Bekleyen başvurun bulunamadı';
  end if;
end;
$$;

-- Kaptan/yetkili başvuruyu yanıtlar. Kabulde oyuncu takıma "ödünç" olarak eklenir ve maç kadrosuna girer.
create function public.decide_application(p_listing uuid, p_user uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l player_listings;
  v_m matches;
  v_app listing_applications;
  v_gp uuid;
  v_name text;
  v_pos text;
  v_accepted integer;
begin
  select * into v_l from player_listings where id = p_listing for update;
  if v_l.id is null then
    raise exception 'İlan bulunamadı';
  end if;
  if not public.is_group_admin(v_l.group_id) then
    raise exception 'Başvuruları sadece kaptan ve yetkililer yanıtlar';
  end if;
  select * into v_app from listing_applications where listing_id = p_listing and user_id = p_user for update;
  if v_app.listing_id is null or v_app.status <> 'pending' then
    raise exception 'Bekleyen başvuru bulunamadı';
  end if;

  if not p_accept then
    update listing_applications set status = 'rejected', decided_at = now()
     where listing_id = p_listing and user_id = p_user;
    return;
  end if;

  if v_l.status <> 'open' then
    raise exception 'İlan kapandı';
  end if;
  select count(*) into v_accepted from listing_applications where listing_id = p_listing and status = 'accepted';
  if v_accepted >= v_l.needed then
    raise exception 'Gereken oyuncu sayısı doldu';
  end if;
  select * into v_m from matches where id = v_l.match_id;
  if v_m.status <> 'planned' then
    raise exception 'Maç artık kadro değişikliğine kapalı';
  end if;

  select display_name, preferred_position into v_name, v_pos from profiles where id = p_user;
  v_pos := coalesce(v_app.position, v_pos);
  select id into v_gp from group_players where group_id = v_l.group_id and user_id = p_user;
  if v_gp is null then
    insert into group_players (group_id, user_id, display_name, position, is_loan)
    values (v_l.group_id, p_user, v_name, v_pos, true)
    returning id into v_gp;
  end if;
  insert into match_players (match_id, player_id, team, position, is_goalkeeper)
  values (v_l.match_id, v_gp, 'A', v_pos, v_pos = 'GK')
  on conflict (match_id, player_id) do nothing;

  update listing_applications set status = 'accepted', decided_at = now()
   where listing_id = p_listing and user_id = p_user;
  if v_accepted + 1 >= v_l.needed then
    update player_listings set status = 'filled' where id = p_listing;
  end if;
  insert into group_messages (group_id, kind, body, match_id)
  values (v_l.group_id, 'system', '🤝 ' || v_name || ' ödünç oyuncu olarak maç kadrosuna alındı.', v_l.match_id);
end;
$$;

-- Sonuç girilirken gelmeyenler: kadrodan çıkarılır, hesabı olanlar güvenilirlik için kaydedilir
create function public.mark_no_shows(p_match uuid, p_players uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_user uuid;
begin
  if not public.can_manage_match(p_match) then
    raise exception 'Bu maçı yönetme yetkiniz yok';
  end if;
  if (select status from matches where id = p_match) <> 'planned' then
    raise exception 'Gelmeyenler sonuç girilirken işaretlenir';
  end if;
  foreach v_pid in array coalesce(p_players, '{}'::uuid[]) loop
    select gp.user_id into v_user
      from match_players mp join group_players gp on gp.id = mp.player_id
     where mp.match_id = p_match and mp.player_id = v_pid;
    if not found then
      continue;
    end if;
    if v_user is not null then
      insert into match_no_shows (match_id, user_id) values (p_match, v_user) on conflict do nothing;
    end if;
    delete from match_players where match_id = p_match and player_id = v_pid;
  end loop;
end;
$$;

-- Güvenilirlik: oynadığı (oylamaya/kapanışa ulaşmış) maç ve gelmediği maç sayısı
create function public.player_reliability(p_user uuid)
returns table (played integer, no_shows integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from match_players mp
       join group_players gp on gp.id = mp.player_id
       join matches m on m.id = mp.match_id
      where gp.user_id = p_user and m.status in ('voting', 'closed')),
    (select count(*)::int from match_no_shows where user_id = p_user)
  where auth.uid() is not null
$$;

-- Başvuranlar: rating, güvenilirlik ve mevkiyle; sadece ilanın takımının kaptan/yetkilisi görür.
-- (Başvuranın rating'i kendi özel gruplarındaki satırlara bağlı olduğundan normal sorguyla okunamaz.)
create function public.listing_applicants(p_listing uuid)
returns table (
  user_id uuid, display_name text, chosen_position text, preferred_position text, note text, status text,
  created_at timestamptz, overall integer, matches_played integer, played integer, no_shows integer
)
language sql stable security definer set search_path = public as $$
  select a.user_id, p.display_name, a.position, p.preferred_position, a.note, a.status, a.created_at,
         coalesce(r.overall, 65)::int, coalesce(r.matches_played, 0)::int,
         (select count(*)::int from match_players mp
            join group_players gp on gp.id = mp.player_id
            join matches m on m.id = mp.match_id
           where gp.user_id = a.user_id and m.status in ('voting', 'closed')),
         (select count(*)::int from match_no_shows n where n.user_id = a.user_id)
    from listing_applications a
    join profiles p on p.id = a.user_id
    left join lateral (
      select pr.overall, pr.matches_played
        from player_ratings pr join group_players gp on gp.id = pr.player_id
       where gp.user_id = a.user_id
       order by pr.updated_at desc limit 1
    ) r on true
   where a.listing_id = p_listing
     and public.is_group_admin(public.listing_group(p_listing))
   order by a.created_at
$$;

-- Kendi genel ratingim (başvuru ekranında minimum rating ile karşılaştırmak için)
create function public.my_rating()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select pr.overall::int from player_ratings pr join group_players gp on gp.id = pr.player_id
      where gp.user_id = auth.uid() order by pr.updated_at desc limit 1),
    65)
$$;

-- Canlı güncelleme (Realtime, RLS'e uyar)
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['player_listings', 'listing_applications'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;

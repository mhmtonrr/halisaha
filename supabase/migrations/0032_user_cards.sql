-- Oyuncu kartı verisi (genel rating + yetenekler) hesap başına TEK satır.
-- Önce: her üyelik satırına (group_players) kopyalanıyordu. Şimdi: hesap sahibi için user_ratings / user_skills;
-- misafirler (user_id boş) eski player_ratings / player_skills tablolarında kalır.
-- Bu migration sadece EKLER (eski tablolara dokunmaz); eski satırlar 0033'te temizlenir.

create table public.user_ratings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  overall smallint not null,
  raw real not null,
  confidence real not null,
  matches_played integer not null,
  updated_at timestamptz not null default now()
);

create table public.user_skills (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  skills jsonb not null default '{}'::jsonb,
  voters smallint not null default 0,
  ballots smallint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_ratings enable row level security;
alter table public.user_skills enable row level security;

-- Görünürlük eskisiyle aynı: kişinin üye olduğu gruplardan biri bana görünürse kartı da görünür
create policy "kartı gör" on public.user_ratings
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
    where gp.user_id = user_ratings.user_id and public.is_group_visible(gp.group_id)
  ));
create policy "yetenekleri gör" on public.user_skills
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.group_players gp
    where gp.user_id = user_skills.user_id and public.is_group_visible(gp.group_id)
  ));

-- Mevcut veriyi taşı: kişinin en çok maçı olan (eşitlikte en yeni) satırı
insert into public.user_ratings (user_id, overall, raw, confidence, matches_played, updated_at)
select distinct on (gp.user_id) gp.user_id, pr.overall, pr.raw, pr.confidence, pr.matches_played, pr.updated_at
  from public.player_ratings pr
  join public.group_players gp on gp.id = pr.player_id
 where gp.user_id is not null
 order by gp.user_id, pr.matches_played desc, pr.updated_at desc;

-- Yetenekler: dolu olan (boş {} olmayan), en çok oyu olan satır
insert into public.user_skills (user_id, skills, voters, ballots, updated_at)
select distinct on (gp.user_id) gp.user_id, ps.skills, ps.voters, ps.ballots, ps.updated_at
  from public.player_skills ps
  join public.group_players gp on gp.id = ps.player_id
 where gp.user_id is not null
 order by gp.user_id, (ps.skills = '{}'::jsonb), ps.voters desc, ps.updated_at desc;

-- Canlı güncelleme
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_skills') then
      alter publication supabase_realtime add table public.user_skills;
    end if;
  end if;
end $$;

-- İlan fonksiyonları artık user_ratings'ten okur

create or replace function public.apply_listing(p_listing uuid, p_position text, p_note text)
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

  select ur.overall into v_overall from user_ratings ur where ur.user_id = auth.uid();
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
  -- Zaten bekleyen başvurunu güncelliyorsan sınır işlemez; yeni veya geri çekilmiş başvuru yeni bir bekleyen sayılır
  if (v_app.listing_id is null or v_app.status <> 'pending') and (
    select count(*) from listing_applications
     where user_id = auth.uid() and status = 'pending' and listing_id <> p_listing
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

create or replace function public.listing_applicants(p_listing uuid)
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
    left join user_ratings r on r.user_id = a.user_id
   where a.listing_id = p_listing
     and public.is_group_admin(public.listing_group(p_listing))
   order by a.created_at
$$;

create or replace function public.my_rating()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ur.overall::int from user_ratings ur where ur.user_id = auth.uid()),
    65)
$$;

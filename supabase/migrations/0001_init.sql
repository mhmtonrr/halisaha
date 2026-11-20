-- Halısaha performans uygulaması: ilk şema
-- Oylar ve istatistikler kullanıcı hesabına değil, gruptaki oyuncuya (group_players)
-- bağlıdır. Böylece misafir oyuncular desteklenir ve hesap açınca geçmişleri aktarılır.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  preferred_position text check (preferred_position in ('GK', 'DEF', 'MID', 'FWD')),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.group_players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- null ise misafir oyuncu: oylanır ama oy veremez
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  position text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index on public.group_players (user_id);

create type public.match_status as enum ('planned', 'played', 'voting', 'closed');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  played_at timestamptz not null,
  venue text,
  status public.match_status not null default 'planned',
  score_a smallint check (score_a >= 0),
  score_b smallint check (score_b >= 0),
  voting_deadline timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.matches (group_id, played_at desc);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.group_players (id) on delete cascade,
  team char(1) not null check (team in ('A', 'B')),
  is_goalkeeper boolean not null default false,
  goals smallint not null default 0 check (goals >= 0),
  assists smallint not null default 0 check (assists >= 0),
  saves smallint not null default 0 check (saves >= 0),
  primary key (match_id, player_id)
);
create index on public.match_players (player_id);

-- Kim kime kaç puan verdi. Kullanıcılar sadece kendi verdiği oyları görebilir.
create table public.votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  voter_id uuid not null references public.group_players (id) on delete cascade,
  target_id uuid not null references public.group_players (id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (match_id, voter_id, target_id),
  check (voter_id <> target_id)
);

create table public.mvp_votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  voter_id uuid not null references public.group_players (id) on delete cascade,
  target_id uuid not null references public.group_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voter_id),
  check (voter_id <> target_id)
);

-- Oylama kapanınca sunucu (service role) tarafından yazılır.
create table public.match_results (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.group_players (id) on delete cascade,
  performance real not null,
  match_score real not null,
  votes_received smallint not null,
  weight real not null,
  rating_before smallint not null,
  rating_after smallint not null,
  is_mvp boolean not null default false,
  primary key (match_id, player_id)
);

create table public.player_ratings (
  player_id uuid primary key references public.group_players (id) on delete cascade,
  overall smallint not null,
  raw real not null,
  confidence real not null,
  matches_played integer not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Yardımcı fonksiyonlar (RLS içinde özyinelemeyi önlemek için security definer)
-- ---------------------------------------------------------------------------

create function public.my_player_id(p_group_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from group_players where group_id = p_group_id and user_id = auth.uid()
$$;

create function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players where group_id = p_group_id and user_id = auth.uid()
  )
$$;

create function public.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and role = 'admin'
  )
$$;

create function public.match_group(p_match_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from matches where id = p_match_id
$$;

create function public.can_manage_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
    where m.id = p_match_id
      and (m.created_by = auth.uid() or public.is_group_admin(m.group_id))
  )
$$;

-- Oy verilebilir mi: maç oylamada, süre dolmamış, oy veren de hedef de maçta,
-- oy veren giriş yapmış kullanıcının kendisi.
create function public.can_vote(p_match_id uuid, p_voter uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from matches m
    join match_players mv on mv.match_id = m.id and mv.player_id = p_voter
    join match_players mt on mt.match_id = m.id and mt.player_id = p_target
    join group_players gp on gp.id = p_voter
    where m.id = p_match_id
      and m.status = 'voting'
      and (m.voting_deadline is null or now() < m.voting_deadline)
      and gp.user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

-- Yeni kullanıcıya profil aç (Google'dan gelen isim/fotoğraf ile)
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grubu kuran otomatik olarak admin oyuncu olur
create function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_players (group_id, user_id, display_name, role)
  select new.id, new.created_by, p.display_name, 'admin'
  from profiles p where p.id = new.created_by;
  return new;
end;
$$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ---------------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------------

-- Davet koduyla gruba katıl
create function public.join_group(p_invite_code text)
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
  insert into group_players (group_id, user_id, display_name)
  select v_group_id, auth.uid(), display_name from profiles where id = auth.uid()
  on conflict (group_id, user_id) do nothing;
  return v_group_id;
end;
$$;

-- Admin: misafir oyuncunun geçmişini gruba katılmış bir üyeye aktarır.
-- Üyenin (henüz maçı olmayan) yeni kaydı silinir, misafir kaydı ona bağlanır.
create function public.claim_guest(p_guest_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_guest group_players;
  v_member group_players;
begin
  select * into v_guest from group_players where id = p_guest_id;
  select * into v_member from group_players where id = p_member_id;
  if v_guest is null or v_member is null or v_guest.group_id <> v_member.group_id then
    raise exception 'Oyuncular bulunamadı';
  end if;
  if not public.is_group_admin(v_guest.group_id) then
    raise exception 'Bu işlem için yönetici olmalısınız';
  end if;
  if v_guest.user_id is not null then
    raise exception 'Bu oyuncu misafir değil';
  end if;
  if exists (select 1 from match_players where player_id = p_member_id) then
    raise exception 'Üyenin zaten maç geçmişi var';
  end if;

  delete from group_players where id = p_member_id;
  update group_players
     set user_id = v_member.user_id,
         display_name = v_member.display_name,
         role = v_member.role
   where id = p_guest_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Satır seviyesinde güvenlik
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.votes enable row level security;
alter table public.mvp_votes enable row level security;
alter table public.match_results enable row level security;
alter table public.player_ratings enable row level security;

-- profiles
create policy "profiller giriş yapanlara görünür" on public.profiles
  for select to authenticated using (true);
create policy "kendi profilini düzenle" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- groups
create policy "üyeler grubu görür" on public.groups
  -- created_by: kayıt anında kurucu henüz üye listesine eklenmemiş olur
  for select to authenticated
  using (public.is_group_member(id) or created_by = auth.uid());
create policy "grup oluştur" on public.groups
  for insert to authenticated with check (created_by = auth.uid());
create policy "admin grubu düzenler" on public.groups
  for update to authenticated using (public.is_group_admin(id));
create policy "admin grubu siler" on public.groups
  for delete to authenticated using (public.is_group_admin(id));

-- group_players
create policy "üyeler oyuncuları görür" on public.group_players
  for select to authenticated using (public.is_group_member(group_id));
create policy "admin misafir ekler" on public.group_players
  for insert to authenticated
  with check (public.is_group_admin(group_id) and user_id is null);
create policy "admin oyuncuları düzenler" on public.group_players
  for update to authenticated using (public.is_group_admin(group_id));
create policy "admin oyuncu çıkarır" on public.group_players
  for delete to authenticated using (public.is_group_admin(group_id));

-- matches
create policy "üyeler maçları görür" on public.matches
  for select to authenticated using (public.is_group_member(group_id));
create policy "üyeler maç oluşturur" on public.matches
  for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy "sahibi veya admin maçı düzenler" on public.matches
  for update to authenticated
  using (created_by = auth.uid() or public.is_group_admin(group_id));
create policy "sahibi veya admin maçı siler" on public.matches
  for delete to authenticated
  using (created_by = auth.uid() or public.is_group_admin(group_id));

-- match_players
create policy "üyeler kadroyu görür" on public.match_players
  for select to authenticated
  using (public.is_group_member(public.match_group(match_id)));
create policy "yetkili kadroyu yönetir" on public.match_players
  for all to authenticated
  using (public.can_manage_match(match_id))
  with check (public.can_manage_match(match_id));

-- votes: sadece kendi oyunu görür; oylama açıkken verir veya değiştirir
create policy "kendi oylarını gör" on public.votes
  for select to authenticated
  using (voter_id = public.my_player_id(public.match_group(match_id)));
create policy "oy ver" on public.votes
  for insert to authenticated
  with check (public.can_vote(match_id, voter_id, target_id));
create policy "oyunu değiştir" on public.votes
  for update to authenticated
  using (public.can_vote(match_id, voter_id, target_id))
  with check (public.can_vote(match_id, voter_id, target_id));

-- mvp_votes
create policy "kendi MVP oyunu gör" on public.mvp_votes
  for select to authenticated
  using (voter_id = public.my_player_id(public.match_group(match_id)));
create policy "MVP oyu ver" on public.mvp_votes
  for insert to authenticated
  with check (public.can_vote(match_id, voter_id, target_id));
create policy "MVP oyunu değiştir" on public.mvp_votes
  for update to authenticated
  using (public.can_vote(match_id, voter_id, target_id))
  with check (public.can_vote(match_id, voter_id, target_id));

-- Sonuçlar ve ratingler: üyeler okur, sadece sunucu yazar (policy yok = yazma yok)
create policy "üyeler sonuçları görür" on public.match_results
  for select to authenticated
  using (public.is_group_member(public.match_group(match_id)));
create policy "üyeler ratingleri görür" on public.player_ratings
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
    where gp.id = player_id and public.is_group_member(gp.group_id)
  ));

-- Oylama durumu: kaç kişi oy verdi (kimin verdiği değil)
create function public.voting_progress(p_match_id uuid)
returns table (voters integer, eligible integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(distinct voter_id)::int from votes where match_id = p_match_id),
    (select count(*)::int from match_players mp
       join group_players gp on gp.id = mp.player_id
      where mp.match_id = p_match_id and gp.user_id is not null)
  where public.is_group_member(public.match_group(p_match_id))
$$;

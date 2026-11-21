-- Yetenek değerlendirmesi (model B): "maçta kim öne çıktı?" işaretlemesi (0018) yerine, birlikte en az 2 maç
-- oynadığın oyuncuyu 6 yetenekte 1-10 puanlarsın (bilmediğini boş bırakırsın). Oylar anonim; kişi başına en
-- son değerlendirme geçerli; aynı kişi 30 günde bir önerilir. Karttaki değerler yine sunucuda hesaplanıp
-- player_skills'e yazılır. 0018'in pusula tabloları canlıda boştu, kaldırılır.

drop function if exists public.submit_skill_ballot(uuid, jsonb);
drop table if exists public.skill_picks;
drop table if exists public.skill_ballots;

create table public.skill_ratings (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid not null references public.profiles (id) on delete cascade,
  -- Hesabı olan oyuncu: target_user; misafir: target_player (tam olarak biri dolu)
  target_user uuid references public.profiles (id) on delete cascade,
  target_player uuid references public.group_players (id) on delete cascade,
  -- {"HIZ": 7, "ŞUT": 5, ...}: sadece verilmiş (1-10) puanlar
  scores jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((target_user is null) <> (target_player is null))
);
create unique index skill_ratings_user_uq on public.skill_ratings (voter_id, target_user) where target_user is not null;
create unique index skill_ratings_player_uq on public.skill_ratings (voter_id, target_player) where target_player is not null;
create index on public.skill_ratings (target_user);
create index on public.skill_ratings (target_player);

alter table public.skill_ratings enable row level security;
create policy "kendi değerlendirmelerimi gör" on public.skill_ratings
  for select to authenticated using (voter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Birlikte oynananlar: p_user'ın oylamaya/kapanışa ulaşmış maçlarında sahada olan herkes (rakip takımın
-- bağlı maçındakiler dahil). Kişi kimliği: hesapta user_id, misafirde group_players.id.
-- ---------------------------------------------------------------------------
create function public.shared_players(p_user uuid)
returns table (target_key uuid, target_user uuid, target_player uuid, display_name text,
               matches integer, last_played timestamptz, keeper boolean)
language sql stable security definer set search_path = public as $$
  with mine as (
    select coalesce(m.challenge_id, m.id) as pool, max(m.played_at) as played_at
      from match_players mp
      join group_players gp on gp.id = mp.player_id
      join matches m on m.id = mp.match_id
     where gp.user_id = p_user and m.status in ('voting', 'closed')
     group by 1
  ),
  others as (
    select coalesce(gp.user_id, gp.id) as key, gp.user_id, gp.id as player_id, gp.display_name,
           mine.pool, mine.played_at,
           (coalesce(mp.position, case when mp.is_goalkeeper then 'GK' end, gp.position, '') = 'GK') as keeper
      from mine
      join matches m on coalesce(m.challenge_id, m.id) = mine.pool and m.status in ('voting', 'closed')
      join match_players mp on mp.match_id = m.id
      join group_players gp on gp.id = mp.player_id
     where gp.user_id is distinct from p_user
  )
  select key, (array_agg(user_id))[1], (array_agg(player_id order by played_at desc))[1],
         (array_agg(display_name order by played_at desc))[1],
         count(distinct pool)::int, max(played_at),
         (array_agg(keeper order by played_at desc))[1]
    from others
   group by key
$$;
revoke all on function public.shared_players(uuid) from public, anon, authenticated;

-- Sıra: en az 2 maç birlikte oynanan ve son 30 günde değerlendirilmemiş oyuncular, en son oynananlar önde
create function public.skill_queue(p_limit integer default 5)
returns table (target_player uuid, display_name text, is_guest boolean, keeper boolean,
               matches integer, last_played timestamptz)
language sql stable security definer set search_path = public as $$
  select s.target_player, s.display_name, s.target_user is null, s.keeper, s.matches, s.last_played
    from shared_players(auth.uid()) s
   where auth.uid() is not null
     and s.matches >= 2
     and not exists (
       select 1 from skill_ratings r
        where r.voter_id = auth.uid()
          and r.updated_at > now() - interval '30 days'
          and (r.target_user = s.target_user or r.target_player = s.target_player)
     )
   order by s.last_played desc, s.display_name
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;
revoke all on function public.skill_queue(integer) from public, anon;
grant execute on function public.skill_queue(integer) to authenticated;

-- Değerlendirmeyi kaydet: p_scores = {"HIZ": 7, "ŞUT": null, ...}; null = bilmiyorum. Tekrar gönderince yerine geçer.
create function public.submit_skill_rating(p_target_player uuid, p_scores jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_key uuid;
  v_target_user uuid;
  v_keeper boolean;
  v_matches integer;
  v_cat text;
  v_val jsonb;
  v_clean jsonb;
  v_field text[] := array['HIZ', 'ŞUT', 'PAS', 'DRİ', 'DEF', 'FİZ'];
  v_gk text[] := array['REF', 'ATL', 'HAV', 'YER', 'DAĞ', 'İLT'];
begin
  if v_me is null then raise exception 'Giriş gerekli'; end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then raise exception 'Geçersiz puan'; end if;

  select coalesce(user_id, id), user_id into v_key, v_target_user from group_players where id = p_target_player;
  if not found then raise exception 'Oyuncu bulunamadı'; end if;
  if v_target_user = v_me then raise exception 'Kendini değerlendiremezsin'; end if;

  select s.keeper, s.matches into v_keeper, v_matches from shared_players(v_me) s where s.target_key = v_key;
  if v_matches is null or v_matches < 2 then
    raise exception 'Bir oyuncuyu değerlendirmek için onunla en az 2 maç oynamış olmalısın';
  end if;

  for v_cat, v_val in select key, value from jsonb_each(p_scores) loop
    if not (v_cat = any (case when v_keeper then v_gk else v_field end)) then
      raise exception 'Bu oyuncu için geçersiz kategori';
    end if;
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'number' or v_val::text !~ '^([1-9]|10)$' then
      raise exception 'Puanlar 1 ile 10 arasında tam sayı olmalı';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_clean
    from jsonb_each(p_scores) where jsonb_typeof(value) = 'number';
  if v_clean = '{}'::jsonb then raise exception 'En az bir yeteneği puanla'; end if;

  if v_target_user is not null then
    insert into skill_ratings (voter_id, target_user, scores) values (v_me, v_target_user, v_clean)
      on conflict (voter_id, target_user) where target_user is not null
      do update set scores = excluded.scores, updated_at = now();
  else
    insert into skill_ratings (voter_id, target_player, scores) values (v_me, p_target_player, v_clean)
      on conflict (voter_id, target_player) where target_player is not null
      do update set scores = excluded.scores, updated_at = now();
  end if;
end $$;
revoke all on function public.submit_skill_rating(uuid, jsonb) from public, anon;
grant execute on function public.submit_skill_rating(uuid, jsonb) to authenticated;

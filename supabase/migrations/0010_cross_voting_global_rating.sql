-- Takımlar arası maçta çapraz oylama ve oyuncu başına tek (genel) rating.
--  * Bağlı (challenge_id) iki maçta sahadaki herkes kendi dışındaki herkese oy verebilir:
--    oy, oy verenin kendi maçına yazılır; hedef kendi maçında veya bağlı maçın kadrosunda olabilir.
--  * Oylama ilerlemesi iki maçı birlikte sayar (herkes oy verince iki maç birlikte kapanır).
--  * Hesap sahibi oyuncunun rating'i tüm grup/takımlarda aynıdır (hesaplama uygulama tarafında);
--    yeni bir gruba katılan oyuncuya mevcut rating'i kopyalanır, 65 ile başlamaz.
--  * Aynı kişi bağlı maçın iki kadrosunda birden olamaz.

-- ---------------------------------------------------------------------------
-- Oy verebilme: hedef aynı maçın veya bağlı maçın kadrosunda
-- ---------------------------------------------------------------------------
create or replace function public.can_vote(p_match_id uuid, p_voter uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from matches m
    join match_players mv on mv.match_id = m.id and mv.player_id = p_voter
    join group_players gp on gp.id = p_voter
    where m.id = p_match_id
      and m.status = 'voting'
      and (m.voting_deadline is null or now() < m.voting_deadline)
      and gp.user_id = auth.uid()
      and exists (
        select 1 from match_players mt
        where mt.player_id = p_target
          and (
            mt.match_id = m.id
            or (m.challenge_id is not null and mt.match_id in (
                  select id from matches where challenge_id = m.challenge_id and id <> m.id))
          )
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Oylama ilerlemesi: bağlı maçta iki kadronun toplamı
-- ---------------------------------------------------------------------------
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
$$;

-- ---------------------------------------------------------------------------
-- Aynı kişi bağlı maçın iki kadrosunda olamaz (kendi kendine oy/rakip olurdu)
-- ---------------------------------------------------------------------------
create function public.guard_linked_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_challenge uuid;
begin
  select user_id into v_user from group_players where id = new.player_id;
  select challenge_id into v_challenge from matches where id = new.match_id;
  if v_user is null or v_challenge is null then
    return new;
  end if;
  if exists (
    select 1 from match_players mp
      join group_players gp on gp.id = mp.player_id
      join matches m on m.id = mp.match_id
     where m.challenge_id = v_challenge and m.id <> new.match_id and gp.user_id = v_user
  ) then
    raise exception 'Bu oyuncu rakip takımın kadrosunda; iki takımda birden oynayamaz';
  end if;
  return new;
end;
$$;
create trigger guard_linked_roster before insert on public.match_players
  for each row execute function public.guard_linked_roster();

-- ---------------------------------------------------------------------------
-- Genel rating: yeni gruba katılan hesap sahibi mevcut rating'ini taşır
-- ---------------------------------------------------------------------------
create function public.copy_rating_on_join()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then
    return new;
  end if;
  insert into player_ratings (player_id, overall, raw, confidence, matches_played)
  select new.id, pr.overall, pr.raw, pr.confidence, pr.matches_played
    from player_ratings pr
    join group_players gp on gp.id = pr.player_id
   where gp.user_id = new.user_id and gp.id <> new.id
   order by pr.updated_at desc
   limit 1
  on conflict (player_id) do nothing;
  return new;
end;
$$;
create trigger copy_rating_on_join after insert on public.group_players
  for each row execute function public.copy_rating_on_join();

-- Mevcut veride aynı kişinin farklı gruplardaki rating'leri tek değere çekilir:
-- en çok maçı olan satırın değeri (uygulama yeniden hesaplayınca zaten düzeltir).
update public.player_ratings pr
   set overall = best.overall, raw = best.raw, confidence = best.confidence, matches_played = best.matches_played
  from public.group_players gp,
       lateral (
         select r.overall, r.raw, r.confidence, r.matches_played
           from public.player_ratings r
           join public.group_players g2 on g2.id = r.player_id
          where g2.user_id = gp.user_id
          order by r.matches_played desc, r.updated_at desc
          limit 1
       ) best
 where gp.id = pr.player_id and gp.user_id is not null;

-- Rating'i olmayan ama başka grubunda olan hesap sahiplerine de kopyala
insert into public.player_ratings (player_id, overall, raw, confidence, matches_played)
select gp.id, best.overall, best.raw, best.confidence, best.matches_played
  from public.group_players gp
  join lateral (
    select r.overall, r.raw, r.confidence, r.matches_played
      from public.player_ratings r
      join public.group_players g2 on g2.id = r.player_id
     where g2.user_id = gp.user_id
     order by r.matches_played desc, r.updated_at desc
     limit 1
  ) best on true
 where gp.user_id is not null
   and not exists (select 1 from public.player_ratings x where x.player_id = gp.id);

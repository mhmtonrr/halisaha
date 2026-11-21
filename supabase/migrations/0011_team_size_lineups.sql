-- Kaç kişilik oynandığı (5-11, her takım için) ve maçtaki diziliş.
--  * matches.team_size: her takımın sahadaki oyuncu sayısı (kaleci dahil). Eski maçlarda boş.
--  * Takım teklifi de kişi sayısını taşır; kabulde iki maça da yazılır.
--  * Diziliş: matches.formation_a/formation_b (ör. '2-3-1') ve match_players.slot (dizilişteki
--    sıra numarası, boşsa yedek). Düzenleme yetkisi mevcut RLS'tir (kaptan/yetkili/maçı kuran).

alter table public.matches
  add column team_size smallint check (team_size between 5 and 11),
  add column formation_a text check (char_length(formation_a) <= 16),
  add column formation_b text check (char_length(formation_b) <= 16);

alter table public.match_players
  add column slot smallint check (slot between 0 and 10);

-- Aynı takımda bir dizilişte iki oyuncu aynı yere dizilemez
create unique index match_players_slot_unique on public.match_players (match_id, team, slot) where slot is not null;

-- Oyuncu diğer takıma geçince eski takımın dizilişindeki yeri düşer (çakışma da olmaz)
create function public.reset_slot_on_team_change()
returns trigger language plpgsql as $$
begin
  if new.team is distinct from old.team then
    new.slot := null;
  end if;
  return new;
end;
$$;
create trigger reset_slot_on_team_change before update of team on public.match_players
  for each row execute function public.reset_slot_on_team_change();

-- ---------------------------------------------------------------------------
-- Teklif: kişi sayısı
-- ---------------------------------------------------------------------------
alter table public.match_challenges
  add column team_size smallint not null default 7 check (team_size between 5 and 11);

-- Yeni parametre varsayılanlı: yayındaki eski kod 6 argümanla çağırmaya devam eder
drop function public.create_challenge(uuid, uuid, timestamptz, text, text, text);
create function public.create_challenge(
  p_from uuid, p_to uuid, p_at timestamptz, p_venue text, p_fee text, p_message text,
  p_size smallint default 7
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_from = p_to then
    raise exception 'Kendi takımınıza teklif gönderemezsiniz';
  end if;
  if public.group_kind(p_from) is distinct from 'team' or public.group_kind(p_to) is distinct from 'team' then
    raise exception 'Teklifler sadece takımlar arasında gönderilir';
  end if;
  if not public.is_group_admin(p_from) then
    raise exception 'Teklifi sadece takımın kaptanı veya yetkilisi gönderir';
  end if;
  if p_at is null or p_at < now() then
    raise exception 'Maç zamanı geçmişte olamaz';
  end if;
  if p_size is null or p_size not between 5 and 11 then
    raise exception 'Kişi sayısı 5 ile 11 arasında olmalı';
  end if;
  if (select count(*) from match_challenges
       where from_group_id = p_from and to_group_id = p_to and status = 'pending') >= 3 then
    raise exception 'Bu takıma zaten bekleyen teklifleriniz var';
  end if;

  insert into match_challenges (from_group_id, to_group_id, created_by, proposed_at, venue, fee_note, message, team_size)
  values (p_from, p_to, auth.uid(), p_at,
          nullif(btrim(p_venue), ''), nullif(btrim(p_fee), ''), nullif(btrim(p_message), ''), p_size)
  returning id into v_id;
  return v_id;
end;
$$;

-- Kabulde iki maça da kişi sayısı yazılır
create or replace function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
  v_from_name text;
  v_to_name text;
  v_m_from uuid;
  v_m_to uuid;
begin
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if v_c is null then
    raise exception 'Teklif bulunamadı';
  end if;
  if not public.is_group_admin(v_c.to_group_id) then
    raise exception 'Teklifi sadece karşı takımın kaptanı veya yetkilisi yanıtlar';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Bu teklif zaten yanıtlandı';
  end if;

  if not p_accept then
    update match_challenges
       set status = 'declined', responded_by = auth.uid(), responded_at = now()
     where id = p_challenge_id;
    return null;
  end if;

  if v_c.proposed_at < now() then
    raise exception 'Teklif edilen zaman geçti';
  end if;
  select name into v_from_name from groups where id = v_c.from_group_id;
  select name into v_to_name from groups where id = v_c.to_group_id;

  insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id, team_size)
  values (v_c.from_group_id, v_c.proposed_at, v_c.venue, v_c.created_by, 'external', v_to_name, v_c.to_group_id, v_c.id, v_c.team_size)
  returning id into v_m_from;
  insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id, team_size)
  values (v_c.to_group_id, v_c.proposed_at, v_c.venue, auth.uid(), 'external', v_from_name, v_c.from_group_id, v_c.id, v_c.team_size)
  returning id into v_m_to;

  update match_challenges
     set status = 'accepted', responded_by = auth.uid(), responded_at = now()
   where id = p_challenge_id;
  return v_m_to;
end;
$$;

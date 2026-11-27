-- Uygulamadaki rakiple maç iki tarafın onayıyla kesinleşir (kullanıcı kararı 2026-11-27).
--  * Bağlı maçta (challenge_id) toplanırken matches.confirmed_at = "bu taraf hazır"; iki taraf da onaylayınca
--    iki maç aynı anda 'planned' olur. Onay geri alınabilir; tarih/saha değişikliği onayları sıfırlar.
--  * Teklif kabulünde iki maç da 'gathering' açılır / 'gathering'e döner (eski "Meydan Oku" teklifi dahil).

-- ---------------------------------------------------------------------------
-- 1) Kesinleştirme: dönüş 'planned' (maç kesinleşti) | 'waiting' (rakibin onayı bekleniyor)
-- ---------------------------------------------------------------------------
drop function public.confirm_match(uuid, timestamptz);
create function public.confirm_match(p_match uuid, p_starts_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_o matches;
  v_challenge uuid;
  v_count integer;
  v_min integer;
begin
  -- İki takım aynı anda onaylarsa kilitlenmesin: önce teklif satırı, sonra maçlar
  select challenge_id into v_challenge from matches where id = p_match;
  if v_challenge is not null then
    perform 1 from match_challenges where id = v_challenge for update;
  end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer kesinleştirir'; end if;
  if v_m.status::text <> 'gathering' then raise exception 'Bu maç toplanma aşamasında değil'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Maç saati gelecekte olmalı'; end if;
  if v_m.challenge_id is not null and (v_m.time_tbd or p_starts_at <> v_m.played_at) then
    raise exception 'Rakiple bağlı maçın saati önce rakiple anlaşılarak belirlenir';
  end if;
  if v_m.kind = 'external' and v_m.opponent_name is null and v_m.opponent_group_id is null then
    raise exception 'Kesinleştirmeden önce rakibi belirle';
  end if;
  v_count := public.match_roster_count(p_match);
  v_min := case when v_m.kind = 'internal' then 4 else 2 end;
  if v_count < v_min then raise exception 'Kesinleştirmek için kadroda en az % kişi olmalı', v_min; end if;

  if v_m.challenge_id is null then
    update matches set status = 'planned', played_at = p_starts_at, time_tbd = false, confirmed_at = now() where id = p_match;
    return 'planned';
  end if;

  select * into v_o from matches where challenge_id = v_m.challenge_id and id <> p_match for update;
  if v_o.id is null or v_o.status::text not in ('gathering', 'planned') then
    raise exception 'Rakibin maçı artık açık değil';
  end if;
  if v_o.status::text = 'gathering' then
    -- Rakip onayladıktan sonra kadrosu yetersiz kaldıysa onayı düşer
    if v_o.confirmed_at is not null and public.match_roster_count(v_o.id) < 2 then
      update matches set confirmed_at = null where id = v_o.id;
      v_o.confirmed_at := null;
    end if;
    if v_o.confirmed_at is null then
      if v_m.confirmed_at is not null then raise exception 'Kadronu zaten onayladın; rakibin onayı bekleniyor'; end if;
      update matches set confirmed_at = now() where id = p_match;
      return 'waiting';
    end if;
  end if;
  update matches
     set status = 'planned', time_tbd = false, confirmed_at = coalesce(confirmed_at, now())
   where challenge_id = v_m.challenge_id and status::text = 'gathering';
  return 'planned';
end;
$$;

create function public.unconfirm_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_challenge uuid;
begin
  select challenge_id into v_challenge from matches where id = p_match;
  if v_challenge is not null then
    perform 1 from match_challenges where id = v_challenge for update;
  end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Onayı sadece maçı kuran kişi veya yetkililer geri alır'; end if;
  if v_m.challenge_id is null or v_m.status::text <> 'gathering' or v_m.confirmed_at is null then
    raise exception 'Geri alınacak bir onay yok';
  end if;
  update matches set confirmed_at = null where id = p_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Teklif kabulü: iki maç da toplanır, onaylar boş
-- ---------------------------------------------------------------------------
create or replace function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
  v_from_name text;
  v_to_name text;
  v_m_from uuid;
  v_m_to uuid;
  v_awaiting uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if not found then raise exception 'Teklif bulunamadı'; end if;
  v_awaiting := coalesce(v_c.awaiting_group_id, v_c.to_group_id);
  if not public.is_group_admin(v_awaiting) then
    raise exception 'Teklife sadece sırası gelen takımın kaptanı veya yetkilisi yanıt verir';
  end if;
  if v_c.status <> 'pending' then raise exception 'Bu teklif zaten yanıtlandı'; end if;

  if not p_accept then
    update match_challenges set status = 'declined', responded_by = auth.uid(), responded_at = now() where id = p_challenge_id;
    return null;
  end if;

  if (case when v_c.proposed_tbd then (v_c.proposed_at at time zone 'Europe/Istanbul')::date < public.istanbul_today()
           else v_c.proposed_at < now() end) then
    raise exception 'Teklif edilen zaman geçti';
  end if;
  select name into v_from_name from groups where id = v_c.from_group_id;
  select name into v_to_name from groups where id = v_c.to_group_id;

  if v_c.from_match_id is not null then
    select id into v_m_from from matches where id = v_c.from_match_id and status::text in ('gathering', 'planned') for update;
    if v_m_from is null then raise exception 'Teklifin maçı artık açık değil'; end if;
    update matches
       set opponent_name = v_to_name, opponent_group_id = v_c.to_group_id, challenge_id = v_c.id,
           played_at = v_c.proposed_at, time_tbd = v_c.proposed_tbd, venue = v_c.venue,
           status = 'gathering', confirmed_at = null
     where id = v_m_from;
    insert into matches (group_id, played_at, time_tbd, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id,
                         team_size, capacity, open_to_members, status)
    values (v_c.to_group_id, v_c.proposed_at, v_c.proposed_tbd, v_c.venue,
            case when v_awaiting = v_c.to_group_id then auth.uid()
                 else coalesce(v_c.countered_by, (select created_by from groups where id = v_c.to_group_id)) end,
            'external', v_from_name, v_c.from_group_id, v_c.id, v_c.team_size, v_c.team_size, true, 'gathering')
    returning id into v_m_to;
  else
    -- Eski teklif (maça bağlı olmayan): iki takımda da toplanan maç açılır
    insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id,
                         team_size, capacity, open_to_members, status)
    values (v_c.from_group_id, v_c.proposed_at, v_c.venue, v_c.created_by, 'external', v_to_name, v_c.to_group_id, v_c.id,
            v_c.team_size, v_c.team_size, true, 'gathering')
    returning id into v_m_from;
    insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id,
                         team_size, capacity, open_to_members, status)
    values (v_c.to_group_id, v_c.proposed_at, v_c.venue, auth.uid(), 'external', v_from_name, v_c.from_group_id, v_c.id,
            v_c.team_size, v_c.team_size, true, 'gathering')
    returning id into v_m_to;
  end if;

  update match_challenges
     set status = 'accepted', responded_by = auth.uid(), responded_at = now(), awaiting_group_id = null
   where id = p_challenge_id;
  return case when public.is_group_member(v_c.to_group_id) then v_m_to else v_m_from end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Tarih/saha değişikliği kabulü: henüz kesinleşmemiş maçta onaylar sıfırlanır
-- ---------------------------------------------------------------------------
create or replace function public.respond_reschedule(p_challenge uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge for update;
  if v_c.id is null or v_c.status <> 'accepted' or v_c.pending_at is null then raise exception 'Bekleyen tarih değişikliği yok'; end if;
  if not public.is_group_admin(v_c.awaiting_group_id) then
    raise exception 'Tarih değişikliğine sadece karşı takımın kaptanı veya yetkilisi yanıt verir';
  end if;
  if p_accept then
    update matches
       set played_at = v_c.pending_at, time_tbd = coalesce(v_c.pending_tbd, false),
           venue = coalesce(v_c.pending_venue, venue),
           confirmed_at = case when status::text = 'gathering' then null else confirmed_at end,
           free_withdraw_until = case when status::text = 'planned' then now() + interval '24 hours' else free_withdraw_until end
     where challenge_id = p_challenge and status::text in ('gathering', 'planned');
    update match_challenges set proposed_at = v_c.pending_at, proposed_tbd = coalesce(v_c.pending_tbd, false),
           venue = coalesce(v_c.pending_venue, venue) where id = p_challenge;
  end if;
  update match_challenges
     set pending_at = null, pending_tbd = null, pending_venue = null, pending_by = null, awaiting_group_id = null
   where id = p_challenge;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Saati geçen toplanan maç: bağlı maçta sebep metni
-- ---------------------------------------------------------------------------
create or replace function public.cron_cancel_stale()
returns table (match_id uuid, group_id uuid, played_at timestamptz, time_tbd boolean, opponent_name text)
language sql security definer set search_path = public as $$
  update matches m
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = case when m.challenge_id is not null then 'İki takım onaylamadan maç zamanı geçti'
                              else 'Kadro tamamlanmadan maç zamanı geçti' end
   where m.status = 'gathering' and public.match_time_passed(m)
  returning m.id, m.group_id, m.played_at, m.time_tbd, m.opponent_name
$$;

-- ---------------------------------------------------------------------------
-- 5) Tek taraflı kesinleşmiş bağlı maçlar: kesin olan taraf "onayladı, rakip bekleniyor" durumuna döner
-- ---------------------------------------------------------------------------
update public.matches m set status = 'gathering', confirmed_at = coalesce(m.confirmed_at, now())
 where m.status = 'planned' and m.challenge_id is not null
   and exists (select 1 from public.matches o where o.challenge_id = m.challenge_id and o.id <> m.id and o.status = 'gathering');

do $$
declare
  f text;
begin
  foreach f in array array['confirm_match(uuid, timestamptz)', 'unconfirm_match(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

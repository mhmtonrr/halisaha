-- Rakip kilidi kalkar (kullanıcı kararları 2026-11-27):
--  * İki onay tamamlanmadan iki taraf da rakibi bırakabilir: iki maç da kadrosuyla "rakipsiz toplanıyor" kalır.
--  * Toplanan bağlı maçı iptal etmek yalnızca kendi maçını iptal eder; kesinleşmiş maçta ikisi de iptal olur.
--  * Aynı maçtan en fazla 3 takıma aynı anda teklif gider; ilk kabul eden rakip olur, diğerleri geri çekilir.

-- Bağı koparır: toplanan maçlardan rakip silinir, teklif kapanır (yetki çağıran fonksiyonda)
create function public.unlink_rival(p_challenge uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update matches
     set challenge_id = null, opponent_name = null, opponent_group_id = null, confirmed_at = null
   where challenge_id = p_challenge and status::text = 'gathering';
  update match_challenges
     set status = 'cancelled', responded_at = now(), awaiting_group_id = null,
         pending_at = null, pending_tbd = null, pending_venue = null, pending_by = null
   where id = p_challenge;
end;
$$;
revoke all on function public.unlink_rival(uuid) from public, anon, authenticated;

create function public.drop_rival(p_match uuid)
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
  if not public.is_group_admin(v_m.group_id) then raise exception 'Rakibi sadece takımın kaptanı veya yetkilisi bırakır'; end if;
  if v_m.challenge_id is null then raise exception 'Bu maç bir rakiple bağlı değil'; end if;
  if v_m.status::text <> 'gathering' then raise exception 'Kesinleşmiş maçta rakip bırakılamaz; maçı iptal edebilirsin'; end if;
  perform public.unlink_rival(v_m.challenge_id);
end;
$$;
revoke all on function public.drop_rival(uuid) from public, anon;
grant execute on function public.drop_rival(uuid) to authenticated;

create or replace function public.cancel_match(p_match uuid, p_reason text default null)
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
  if not public.can_manage_match(p_match) then raise exception 'Maçı sadece kuran kişi veya yetkililer iptal eder'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maç artık iptal edilemez'; end if;

  -- Bu maçtan gidip yanıt bekleyen teklifler geri çekilir
  update match_challenges set status = 'cancelled', responded_at = now(), awaiting_group_id = null
   where from_match_id = p_match and status = 'pending';

  if v_m.challenge_id is not null and v_m.status::text = 'gathering' then
    -- Yalnızca kendi maçımız iptal olur; rakibin maçı rakipsiz toplanmaya döner
    update matches
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(left(btrim(p_reason), 200), ''),
           challenge_id = null, confirmed_at = null
     where id = p_match;
    perform public.unlink_rival(v_m.challenge_id);
    return;
  end if;

  update matches
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(left(btrim(p_reason), 200), '')
   where (id = p_match or (v_m.challenge_id is not null and challenge_id = v_m.challenge_id))
     and status::text in ('gathering', 'planned');
  if v_m.challenge_id is not null then
    update match_challenges set status = 'cancelled' where id = v_m.challenge_id;
  end if;
end;
$$;

-- Teklifler sayfasından: bekleyen teklif geri çekilir; toplanan maçta rakip bırakılır; kesin maçta iki maç iptal
create or replace function public.cancel_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if v_c.id is null then raise exception 'Teklif bulunamadı'; end if;
  if not (public.is_group_admin(v_c.from_group_id) or public.is_group_admin(v_c.to_group_id)) then
    raise exception 'Bu işlem için yetkili olmalısınız';
  end if;

  if v_c.status = 'pending' then
    if not public.is_group_admin(v_c.from_group_id) then
      raise exception 'Bekleyen teklifi sadece gönderen takım geri çekebilir (karşı takım reddedebilir)';
    end if;
  elsif v_c.status = 'accepted' then
    if exists (select 1 from matches where challenge_id = v_c.id and status::text not in ('gathering', 'planned', 'cancelled')) then
      raise exception 'Skoru girilmiş maç iptal edilemez';
    end if;
    if exists (select 1 from matches where challenge_id = v_c.id and status::text = 'gathering') then
      perform public.unlink_rival(v_c.id);
      return;
    end if;
    update matches
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
     where challenge_id = v_c.id and status::text in ('gathering', 'planned');
  else
    raise exception 'Bu teklif iptal edilemez';
  end if;

  update match_challenges set status = 'cancelled', responded_at = now() where id = p_challenge_id;
end;
$$;

create or replace function public.create_challenge_v2(p_match uuid, p_to uuid, p_message text default null, p_fee text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.is_group_admin(v_m.group_id) then raise exception 'Teklifi sadece takımın kaptanı veya yetkilisi gönderir'; end if;
  if v_m.kind <> 'external' or public.group_kind(p_to) is distinct from 'team' or p_to = v_m.group_id then
    raise exception 'Teklif sadece başka bir takıma gönderilir';
  end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then raise exception 'Bu maç için teklif gönderilemez'; end if;
  if v_m.challenge_id is not null then raise exception 'Bu maç zaten bir rakiple bağlı'; end if;
  if exists (select 1 from match_challenges where from_match_id = p_match and to_group_id = p_to and status = 'pending') then
    raise exception 'Bu takıma bu maç için bekleyen bir teklifin var';
  end if;
  if (select count(*) from match_challenges where from_match_id = p_match and status = 'pending') >= 3 then
    raise exception 'Bir maç için aynı anda en fazla 3 takıma teklif gönderilir; önce birini geri çek';
  end if;
  if (select count(*) from match_challenges where from_group_id = v_m.group_id and to_group_id = p_to and status = 'pending') >= 3 then
    raise exception 'Bu takıma zaten bekleyen teklifleriniz var';
  end if;
  insert into match_challenges (from_group_id, to_group_id, created_by, proposed_at, proposed_tbd, venue, fee_note, message,
                                team_size, from_match_id, awaiting_group_id)
  values (v_m.group_id, p_to, auth.uid(), v_m.played_at, v_m.time_tbd, v_m.venue,
          nullif(left(btrim(p_fee), 120), ''), nullif(left(btrim(p_message), 300), ''), coalesce(v_m.team_size, 7), p_match, p_to)
  returning id into v_id;
  return v_id;
end;
$$;

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
  -- Aynı maçın iki teklifi aynı anda kabul edilirse kilitlenmesin: önce maç, sonra teklif
  perform 1 from matches where id = (select from_match_id from match_challenges where id = p_challenge_id) for update;
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if not found then raise exception 'Teklif bulunamadı'; end if;
  v_awaiting := coalesce(v_c.awaiting_group_id, v_c.to_group_id);
  if not public.is_group_admin(v_awaiting) then
    raise exception 'Teklife sadece sırası gelen takımın kaptanı veya yetkilisi yanıt verir';
  end if;
  if v_c.status <> 'pending' then raise exception 'Bu teklif zaten yanıtlandı veya geri çekildi'; end if;

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
    select id into v_m_from from matches
     where id = v_c.from_match_id and status::text in ('gathering', 'planned') and challenge_id is null;
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
    -- İlk kabul eden rakip olur
    update match_challenges set status = 'cancelled', responded_at = now(), awaiting_group_id = null
     where from_match_id = v_c.from_match_id and status = 'pending' and id <> p_challenge_id;
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

-- Bekleyen rakip(ler): maç başına tek satır; birden fazlaysa "İlk takım +N"
create or replace function public.match_pending_rivals(p_ids uuid[])
returns table (match_id uuid, group_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select c.from_match_id,
         (array_agg(g.id order by c.created_at, g.name))[1],
         (array_agg(g.name order by c.created_at, g.name))[1]
           || case when count(*) > 1 then ' +' || (count(*) - 1) else '' end
    from match_challenges c
    join groups g on g.id = c.to_group_id
   where c.from_match_id = any(p_ids) and c.status = 'pending' and public.can_view_match(c.from_match_id)
   group by c.from_match_id
$$;

-- 0015 sonrası düzeltmeler (code-review bulguları).
--  1. Mevkisiz başvuran kabul edilemiyordu (is_goalkeeper null).
--  2. Maç oynanınca/iptal olunca ilan açık kalıyor ve takımın 5 ilan sınırını dolduruyordu.
--  6. Geri çekilen başvurunun yeniden başvurusu 10 bekleyen başvuru sınırını atlıyordu.
--  7. Kabul edilmiş ödünç oyuncu kadrodan çıkarılınca başvurusu 'accepted', ilan 'filled' kalıyordu.
--  8. player_reliability herhangi bir kullanıcının kaydını herkese veriyordu ve hiçbir yerde kullanılmıyordu.

-- 8) Kullanılmayan ve kimlik doğrulamasız güvenilirlik sorgusu kaldırılır (UI listing_applicants kullanır)
drop function public.player_reliability(uuid);

-- 1) Mevkisiz oyuncu da kabul edilir (kaleci değil sayılır)
create or replace function public.decide_application(p_listing uuid, p_user uuid, p_accept boolean)
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
  values (v_l.match_id, v_gp, 'A', v_pos, coalesce(v_pos = 'GK', false))
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

-- 6) Bekleyen başvuru sınırı yeniden başvuruda da geçerli (bu ilan hariç sayılır)
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

-- 2) Sınır sadece hâlâ planlanmış ve gelecekteki maçların açık ilanlarını sayar
create or replace function public.create_listing(
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
  if (
    select count(*) from player_listings l join matches m on m.id = l.match_id
     where l.group_id = v_m.group_id and l.status = 'open' and m.status = 'planned' and m.played_at > now()
  ) >= 5 then
    raise exception 'Takımın en fazla 5 açık ilanı olabilir';
  end if;

  insert into player_listings (group_id, match_id, created_by, needed, positions, min_overall, note)
  values (v_m.group_id, p_match, auth.uid(), p_needed, coalesce(p_positions, '{}'::text[]), p_min_overall, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- 2) Maç planlanmış olmaktan çıkınca (sonuç girildi, oylama, iptal) açık ilan kapanır
create function public.close_listings_on_match_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update player_listings set status = 'closed' where match_id = new.id and status = 'open';
  return new;
end;
$$;
create trigger close_listings_on_match_change after update of status on public.matches
  for each row when (old.status = 'planned' and new.status <> 'planned')
  execute function public.close_listings_on_match_change();

-- Geçmiş veride maçı artık planlanmış olmayan açık ilanlar kapatılır
update public.player_listings l set status = 'closed'
  from public.matches m
 where m.id = l.match_id and l.status = 'open' and m.status <> 'planned';

-- 7) Kabul edilmiş ödünç oyuncu maç kadrosundan çıkarılırsa başvurusu geri çekilmiş sayılır ve dolmuş ilan yeniden açılır
create function public.release_loan_on_roster_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_listing uuid;
begin
  select user_id into v_user from group_players where id = old.player_id;
  if v_user is null then
    return old;
  end if;
  for v_listing in select id from player_listings where match_id = old.match_id loop
    update listing_applications set status = 'withdrawn', decided_at = now()
     where listing_id = v_listing and user_id = v_user and status = 'accepted';
    if found then
      update player_listings set status = 'open'
       where id = v_listing and status = 'filled'
         and exists (select 1 from matches where id = old.match_id and status = 'planned');
    end if;
  end loop;
  return old;
end;
$$;
create trigger release_loan_on_roster_removal after delete on public.match_players
  for each row execute function public.release_loan_on_roster_removal();

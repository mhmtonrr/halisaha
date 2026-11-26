-- 0053: maç ekranı kadro panosu (Kadro / Yedek / Gelmeyenler arasında taşıma) ve zorunlu mazeret.

-- Yöneten (misafirde kaptan/yetkili) bir kişiyi 'in' | 'reserve' | 'out' bölümüne taşır.
-- Üyede p_user, misafirde p_player verilir. Önceki durumu döndürür ('in', 'reserve', ..., 'none').
create or replace function public.move_roster(p_match uuid, p_user uuid, p_player uuid, p_to text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
  v_from text;
  v_member boolean;
  v_gp group_players;
  v_a integer;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  if p_to not in ('in', 'reserve', 'out') then raise exception 'Geçersiz işlem'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_manage_match(p_match) then raise exception 'Kadroyu sadece maçı kuran kişi veya yetkililer düzenler'; end if;
  if v_m.status::text not in ('gathering', 'planned') then raise exception 'Bu maçın kadrosu artık değişmez'; end if;

  if p_user is not null then
    select * into v_e from match_entries where match_id = p_match and user_id = p_user;
  else
    if not public.is_group_admin(v_m.group_id) then raise exception 'Misafiri sadece kaptan veya yetkili taşır'; end if;
    select * into v_gp from group_players where id = p_player and group_id = v_m.group_id and user_id is null;
    if v_gp.id is null then raise exception 'Misafir bulunamadı'; end if;
    select * into v_e from match_entries where match_id = p_match and player_id = p_player;
    if v_e.id is null then raise exception 'Misafir bu maçta değil'; end if;
  end if;
  v_from := coalesce(v_e.status, 'none');
  if v_from = 'pending' then raise exception 'Önce başvuruyu onayla veya reddet'; end if;

  if p_to = 'out' then
    if v_from not in ('in', 'reserve') then return v_from; end if;
    update match_entries set status = 'left', queued_at = null, updated_at = now() where id = v_e.id;
    delete from match_players mp
     where mp.match_id = p_match
       and mp.player_id in (select id from group_players
                             where (p_user is not null and user_id = p_user) or (p_user is null and id = p_player));
    return v_from;
  end if;

  if v_from = p_to then return v_from; end if;

  if p_user is not null then
    v_member := exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is null and not is_loan);
    -- Takım dışından biri ancak daha önce kadroda/yedekte yer aldıysa taşınır; ayrılan üye geri yazılmaz
    if not v_member and (
         v_from not in ('in', 'reserve', 'left')
         or exists (select 1 from group_players where group_id = v_m.group_id and user_id = p_user and left_at is not null and not is_loan)
       ) then
      raise exception 'Bu kişi takımda değil; davet göndermen gerekir';
    end if;
  end if;

  if p_to = 'in' then
    if public.match_roster_count(p_match) >= v_m.capacity then raise exception 'Kadro dolu; önce birini çıkar'; end if;
    if p_user is not null then
      perform public.put_in_roster(v_m, p_user, v_e.position);
      update match_entries set source = case when v_e.id is null then 'organizer' else source end,
             added_by = auth.uid(), queued_at = null, updated_at = now()
       where match_id = p_match and user_id = p_user;
    else
      select count(*) filter (where team = 'A'), count(*) into v_a, v_total from match_players where match_id = p_match;
      insert into match_players (match_id, player_id, team, position, is_goalkeeper)
      values (p_match, p_player,
              case when v_m.kind = 'external' or v_m.status::text = 'gathering' or v_a <= v_total - v_a then 'A' else 'B' end,
              v_gp.position, coalesce(v_gp.position = 'GK', false))
      on conflict (match_id, player_id) do nothing;
      update match_entries set queued_at = null, updated_at = now() where id = v_e.id;
    end if;
    return v_from;
  end if;

  -- Yedeğe: önce kayıt güncellenir (kadrodan silme tetikleyicisi yalnızca 'in' kayda dokunur)
  if v_e.id is null then
    insert into match_entries (match_id, user_id, status, source, queued_at, added_by)
    values (p_match, p_user, 'reserve', 'organizer', now(), auth.uid());
  else
    update match_entries set status = 'reserve', queued_at = now(), added_by = auth.uid(), updated_at = now() where id = v_e.id;
    delete from match_players mp
     where mp.match_id = p_match
       and mp.player_id in (select id from group_players
                             where (p_user is not null and user_id = p_user) or (p_user is null and id = p_player));
  end if;
  return v_from;
end;
$$;
revoke all on function public.move_roster(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.move_roster(uuid, uuid, uuid, text) to authenticated;

-- Maçtan çekilmede mazeret zorunlu (diğer kurallar 0042 ile aynı)
create or replace function public.request_withdrawal(p_match uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_me group_players;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Mazeretini yaz (en az 3 karakter)'; end if;
  select * into v_m from matches where id = p_match;
  if not found then raise exception 'Maç bulunamadı'; end if;
  if v_m.status <> 'planned' then
    raise exception 'Bu maç artık planlanmış değil; çekilme isteği gönderilemez';
  end if;
  if v_m.played_at <= now() then
    raise exception 'Maç saati geçti; kaptanla konuş (gelmezsen "gelmedi" işaretlenebilir)';
  end if;
  select gp.* into v_me
    from match_players mp join group_players gp on gp.id = mp.player_id
   where mp.match_id = p_match and gp.user_id = auth.uid() and gp.left_at is null
   limit 1;
  if not found then raise exception 'Bu maçın kadrosunda değilsin'; end if;
  if exists (select 1 from match_withdrawals where match_id = p_match and player_id = v_me.id and status = 'pending') then
    raise exception 'Zaten bekleyen bir çekilme isteğin var';
  end if;

  if public.can_manage_match(p_match) or coalesce(v_m.free_withdraw_until, '-infinity') > now() then
    insert into match_withdrawals (match_id, player_id, reason, late, status, decided_by, decided_at)
    values (p_match, v_me.id, btrim(p_reason), v_m.played_at - now() < interval '3 hours', 'approved', auth.uid(), now());
    delete from match_players where match_id = p_match and player_id = v_me.id;
    return 'approved';
  end if;

  insert into match_withdrawals (match_id, player_id, reason, late)
  values (p_match, v_me.id, btrim(p_reason), v_m.played_at - now() < interval '3 hours');
  return 'pending';
end;
$$;

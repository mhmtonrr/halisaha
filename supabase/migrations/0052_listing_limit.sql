-- Adam ara'da birden çok yer tek seferde seçilir (Keşfet + gruplar); maç başına açık ilan sınırı 5'ten 15'e çıkar.

create or replace function public.create_listing(p_match uuid, p_target uuid default null, p_positions text[] default '{}', p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_status text := 'active';
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_m from matches where id = p_match for update;
  if v_m.id is null then raise exception 'Maç bulunamadı'; end if;
  if not public.can_create_match(v_m.group_id) then
    raise exception 'İlanı sadece kaptan, yetkili veya organizatör açar';
  end if;
  if v_m.status::text not in ('gathering', 'planned') or public.match_time_passed(v_m) then
    raise exception 'Bu maç için artık adam aranamaz';
  end if;
  if p_positions is not null and not (p_positions <@ array['GK', 'DEF', 'MID', 'FWD']) then raise exception 'Geçersiz mevki'; end if;
  if p_target is not null then
    if p_target = v_m.group_id then raise exception 'Maçın kendi grubuna ilan açılmaz; üyeler maçı zaten görüyor'; end if;
    if not public.is_group_member(p_target) then raise exception 'İlanı sadece üyesi olduğun gruba paylaşabilirsin'; end if;
    if not public.can_create_match(p_target) then v_status := 'pending'; end if;
  end if;
  if (select count(*) from match_listings where match_id = p_match and status in ('pending', 'active')) >= 15 then
    raise exception 'Bir maça en fazla 15 ilan açılır';
  end if;
  if exists (select 1 from match_listings where match_id = p_match and status in ('pending', 'active')
              and target_group_id is not distinct from p_target) then
    raise exception 'Bu yerde zaten açık bir ilan var';
  end if;
  insert into match_listings (match_id, target_group_id, status, positions, note, created_by, decided_by, decided_at)
  values (p_match, p_target, v_status, coalesce(p_positions, '{}'), nullif(left(btrim(p_note), 200), ''), auth.uid(),
          case when v_status = 'active' and p_target is not null then auth.uid() end,
          case when v_status = 'active' and p_target is not null then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

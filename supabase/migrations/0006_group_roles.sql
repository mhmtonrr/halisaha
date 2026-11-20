-- Gruplarda da takımlardaki yetki modeli: kurucu (captain) + yetkililer (admin) + üyeler.
-- Maçı sadece kurucu ve yetkililer kurar; rolleri sadece kurucu değiştirir.

-- Mevcut grupların kurucusu "captain" olur (arayüzde "Kurucu" diye görünür)
update public.group_players gp
   set role = 'captain'
  from public.groups g
 where g.id = gp.group_id
   and g.kind = 'community'
   and gp.user_id = g.created_by
   and gp.role = 'admin';

-- Yeni grup/takımı kuran her zaman captain
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_players (group_id, user_id, display_name, role, position)
  select new.id, new.created_by, p.display_name, 'captain', p.preferred_position
  from profiles p where p.id = new.created_by;
  return new;
end;
$$;

-- Rol yönetimi her iki türde aynı: sadece kaptan/kurucu
create or replace function public.set_member_role(p_player_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target group_players;
  v_me uuid;
begin
  select * into v_target from group_players where id = p_player_id;
  if v_target is null then
    raise exception 'Oyuncu bulunamadı';
  end if;
  v_me := public.my_player_id(v_target.group_id);

  if p_role not in ('captain', 'admin', 'member') then
    raise exception 'Geçersiz rol';
  end if;
  if v_target.user_id is null then
    raise exception 'Misafirlere yetki verilemez';
  end if;
  if v_target.id = v_me then
    raise exception 'Kendi rolünüzü değiştiremezsiniz';
  end if;
  if not public.is_group_captain(v_target.group_id) then
    raise exception 'Yetkileri sadece kaptan/kurucu değiştirebilir';
  end if;

  if p_role = 'captain' then
    -- Devir: eski kaptan/kurucu yetkili olur
    update group_players set role = 'admin' where id = v_me;
  end if;
  update group_players set role = p_role where id = p_player_id;
end;
$$;

-- Oyuncu çıkarma: kaptan çıkarılamaz, yetkilileri sadece kaptan çıkarır
drop policy "yetkili oyuncu çıkarır" on public.group_players;
create policy "yetkili oyuncu çıkarır" on public.group_players
  for delete to authenticated
  using (
    public.is_group_admin(group_id)
    and role <> 'captain'
    and (role = 'member' or public.is_group_captain(group_id))
  );

-- Maçı her iki türde de sadece kaptan/kurucu ve yetkililer kurar
drop policy "maç oluşturur" on public.matches;
create policy "maç oluşturur" on public.matches
  for insert to authenticated
  with check (created_by = auth.uid() and public.is_group_admin(group_id));

-- ---------------------------------------------------------------------------
-- Davet kodu gizliliği: takımlar herkese açık olduğundan invite_code sütunu
-- doğrudan okunamaz. Takımlarda kaptan/yetkililer, gruplarda üyeler RPC ile alır.
-- ---------------------------------------------------------------------------
revoke select on public.groups from authenticated, anon;
grant select (id, name, created_by, created_at, kind, city, district, color, description)
  on public.groups to authenticated;

create function public.group_invite_code(p_group_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select invite_code from groups g
   where g.id = p_group_id
     and (public.is_group_admin(g.id) or (g.kind = 'community' and public.is_group_member(g.id)))
$$;

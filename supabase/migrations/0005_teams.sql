-- Takımlar: herkese açık, bölgesel, kaptan + yetkili rolleri.
-- Gruplar (topluluk) olduğu gibi kalır. İkisi aynı altyapıyı (oyuncular, maçlar,
-- oylama, rating) paylaşır; groups.kind ile ayrılır.

-- ---------------------------------------------------------------------------
-- Alanlar
-- ---------------------------------------------------------------------------
alter table public.groups
  add column kind text not null default 'community' check (kind in ('community', 'team')),
  add column city text check (char_length(city) between 2 and 40),
  add column district text check (char_length(district) between 2 and 40),
  add column color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  add column description text check (char_length(description) <= 200),
  add constraint team_has_city check (kind = 'community' or city is not null);

create index on public.groups (kind, city, district);

-- Rol: kaptan (sadece takımlarda), yönetici/yetkili, üye
alter table public.group_players drop constraint group_players_role_check;
alter table public.group_players
  add constraint group_players_role_check check (role in ('captain', 'admin', 'member'));

-- ---------------------------------------------------------------------------
-- Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------------

-- Kaptan da yönetici yetkilerine sahiptir
create or replace function public.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and role in ('admin', 'captain')
  )
$$;

create function public.is_group_captain(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and role = 'captain'
  )
$$;

-- Takımlar herkese açık; gruplar sadece üyelere
create function public.is_group_visible(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_group_member(p_group_id)
      or exists (select 1 from groups where id = p_group_id and kind = 'team')
$$;

create function public.group_kind(p_group_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select kind from groups where id = p_group_id
$$;

-- Takımı kuran kaptan, grubu kuran yönetici olur
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_players (group_id, user_id, display_name, role, position)
  select new.id, new.created_by, p.display_name,
         case when new.kind = 'team' then 'captain' else 'admin' end,
         p.preferred_position
  from profiles p where p.id = new.created_by;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rol yönetimi (doğrudan update yerine; kimse kendini kaptan yapamasın diye)
-- ---------------------------------------------------------------------------
create function public.set_member_role(p_player_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target group_players;
  v_kind text;
  v_me uuid;
begin
  select * into v_target from group_players where id = p_player_id;
  if v_target is null then
    raise exception 'Oyuncu bulunamadı';
  end if;
  v_kind := public.group_kind(v_target.group_id);
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

  if v_kind = 'team' then
    if not public.is_group_captain(v_target.group_id) then
      raise exception 'Yetkileri sadece kaptan değiştirebilir';
    end if;
    if p_role = 'captain' then
      -- Kaptanlık devri: eski kaptan yetkili olur
      update group_players set role = 'admin' where id = v_me;
    end if;
  else
    if p_role = 'captain' then
      raise exception 'Gruplarda kaptan yoktur';
    end if;
    if not public.is_group_admin(v_target.group_id) then
      raise exception 'Bu işlem için yönetici olmalısınız';
    end if;
  end if;

  update group_players set role = p_role where id = p_player_id;
end;
$$;

-- Davet linkini yeniler (eski link çalışmaz olur)
create function public.regenerate_invite(p_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Bu işlem için yetkili olmalısınız';
  end if;
  update groups set invite_code = v_code where id = p_group_id;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Satır seviyesinde güvenlik
-- ---------------------------------------------------------------------------

-- Görünürlük: takımlar herkese açık
drop policy "üyeler grubu görür" on public.groups;
create policy "grubu/takımı görür" on public.groups
  for select to authenticated
  using (public.is_group_visible(id) or created_by = auth.uid());

drop policy "grup oluştur" on public.groups;
create policy "grup/takım oluştur" on public.groups
  for insert to authenticated with check (created_by = auth.uid());

drop policy "üyeler oyuncuları görür" on public.group_players;
create policy "oyuncuları görür" on public.group_players
  for select to authenticated using (public.is_group_visible(group_id));

-- Rol değişikliği RPC üzerinden; doğrudan güncelleme yok
drop policy "admin oyuncuları düzenler" on public.group_players;

-- Oyuncu çıkarma: kaptan çıkarılamaz; yetkilileri sadece kaptan çıkarabilir
drop policy "admin oyuncu çıkarır" on public.group_players;
create policy "yetkili oyuncu çıkarır" on public.group_players
  for delete to authenticated
  using (
    public.is_group_admin(group_id)
    and role <> 'captain'
    and (role = 'member' or public.is_group_captain(group_id) or public.group_kind(group_id) = 'community')
  );

drop policy "üyeler maçları görür" on public.matches;
create policy "maçları görür" on public.matches
  for select to authenticated using (public.is_group_visible(group_id));

-- Takımlarda maçı sadece kaptan/yetkili kurar
drop policy "üyeler maç oluşturur" on public.matches;
create policy "maç oluşturur" on public.matches
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_group_member(group_id)
    and (public.group_kind(group_id) = 'community' or public.is_group_admin(group_id))
  );

drop policy "üyeler kadroyu görür" on public.match_players;
create policy "kadroyu görür" on public.match_players
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)));

drop policy "üyeler sonuçları görür" on public.match_results;
create policy "sonuçları görür" on public.match_results
  for select to authenticated
  using (public.is_group_visible(public.match_group(match_id)));

drop policy "üyeler ratingleri görür" on public.player_ratings;
create policy "ratingleri görür" on public.player_ratings
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
    where gp.id = player_id and public.is_group_visible(gp.group_id)
  ));

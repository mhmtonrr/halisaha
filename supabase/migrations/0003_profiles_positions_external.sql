-- Oyuncu profili, maça özel mevki ve rakip takıma karşı maç.
-- Sadece ekleme yapar; mevcut veriyi değiştirmez.

-- ---------------------------------------------------------------------------
-- Profil alanları
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column secondary_positions text[] not null default '{}'
    check (secondary_positions <@ array['GK', 'DEF', 'MID', 'FWD']),
  add column preferred_foot text check (preferred_foot in ('L', 'R', 'B')),
  add column shirt_number smallint check (shirt_number between 1 and 99),
  add column bio text check (char_length(bio) <= 160);

-- Profili günceller ve kullanıcının tüm gruplarındaki adını/mevkisini eşitler.
create function public.update_my_profile(
  p_display_name text,
  p_position text,
  p_secondary text[],
  p_foot text,
  p_shirt integer,
  p_bio text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(p_display_name);
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'İsim 2-40 karakter olmalı';
  end if;
  if p_position is not null and p_position not in ('GK', 'DEF', 'MID', 'FWD') then
    raise exception 'Geçersiz mevki';
  end if;

  update profiles
     set display_name = v_name,
         preferred_position = p_position,
         secondary_positions = coalesce(
           array(select distinct x from unnest(p_secondary) x
                 where x is distinct from p_position), '{}'),
         preferred_foot = p_foot,
         shirt_number = p_shirt,
         bio = nullif(btrim(p_bio), '')
   where id = auth.uid();

  update group_players
     set display_name = v_name,
         position = p_position
   where user_id = auth.uid();
end;
$$;

-- Gruba katılırken/grup kurarken profildeki mevki de gelsin
create or replace function public.join_group(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  select id into v_group_id from groups where invite_code = p_invite_code;
  if v_group_id is null then
    raise exception 'Geçersiz davet kodu';
  end if;
  insert into group_players (group_id, user_id, display_name, position)
  select v_group_id, auth.uid(), display_name, preferred_position
  from profiles where id = auth.uid()
  on conflict (group_id, user_id) do nothing;
  return v_group_id;
end;
$$;

create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_players (group_id, user_id, display_name, role, position)
  select new.id, new.created_by, p.display_name, 'admin', p.preferred_position
  from profiles p where p.id = new.created_by;
  return new;
end;
$$;

-- Misafir aktarılırken mevki: üyenin profili, yoksa misafirdeki
create or replace function public.claim_guest(p_guest_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_guest group_players;
  v_member group_players;
begin
  select * into v_guest from group_players where id = p_guest_id;
  select * into v_member from group_players where id = p_member_id;
  if v_guest is null or v_member is null or v_guest.group_id <> v_member.group_id then
    raise exception 'Oyuncular bulunamadı';
  end if;
  if not public.is_group_admin(v_guest.group_id) then
    raise exception 'Bu işlem için yönetici olmalısınız';
  end if;
  if v_guest.user_id is not null then
    raise exception 'Bu oyuncu misafir değil';
  end if;
  if exists (select 1 from match_players where player_id = p_member_id) then
    raise exception 'Üyenin zaten maç geçmişi var';
  end if;

  delete from group_players where id = p_member_id;
  update group_players
     set user_id = v_member.user_id,
         display_name = v_member.display_name,
         role = v_member.role,
         position = coalesce(v_member.position, v_guest.position)
   where id = p_guest_id;
end;
$$;

-- Mevcut üyelerin grup kaydındaki mevkiyi profile taşı (profilde boşsa)
update public.profiles p
   set preferred_position = gp.position
  from (
    select distinct on (user_id) user_id, position
    from public.group_players
    where user_id is not null and position is not null
    order by user_id, created_at
  ) gp
 where gp.user_id = p.id and p.preferred_position is null;

-- ---------------------------------------------------------------------------
-- Maça özel mevki (maçı kuran veya yönetici değiştirir; RLS zaten buna göre)
-- ---------------------------------------------------------------------------
alter table public.match_players
  add column position text check (position in ('GK', 'DEF', 'MID', 'FWD'));
update public.match_players set position = 'GK' where is_goalkeeper;

-- ---------------------------------------------------------------------------
-- Rakip takıma karşı maç: kadroda sadece bizimkiler (hepsi A takımı),
-- score_a = biz, score_b = rakip
-- ---------------------------------------------------------------------------
alter table public.matches
  add column kind text not null default 'internal' check (kind in ('internal', 'external')),
  add column opponent_name text check (char_length(opponent_name) <= 60),
  add constraint external_has_opponent
    check (kind = 'internal' or coalesce(char_length(btrim(opponent_name)), 0) >= 2);

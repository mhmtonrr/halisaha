-- Gruptan/takımdan ayrılma. Kayıt SİLİNMEZ: group_players satırı kalır (maç kadroları, oylar, sonuçlar ve kişinin
-- genel rating'i buna bağlı), sadece `left_at` dolar ve kişi aktif üye sayılmaz. Aynı davet koduyla tekrar katılırsa
-- kayıt yeniden açılır (rol "üye" olarak). Misafir kayıtları eskisi gibi silinir.

alter table public.group_players add column left_at timestamptz;
create index on public.group_players (user_id) where left_at is null;

-- Üyelik ve yetki fonksiyonları ayrılmış satırları saymaz
create or replace function public.my_player_id(p_group_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from group_players where group_id = p_group_id and user_id = auth.uid() and left_at is null
$$;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and not is_loan and left_at is null
  )
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and role in ('admin', 'captain') and left_at is null
  )
$$;

create or replace function public.is_group_captain(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_players
    where group_id = p_group_id and user_id = auth.uid() and role = 'captain' and left_at is null
  )
$$;

create or replace function public.unread_counts()
returns table (group_id uuid, unread integer)
language sql stable security definer set search_path = public as $$
  select gp.group_id, count(m.id)::int
    from group_players gp
    left join chat_reads r on r.player_id = gp.id
    join group_messages m on m.group_id = gp.group_id
                         and m.id > coalesce(r.last_read_id, 0)
                         and m.deleted_at is null
                         and m.author_id is distinct from gp.id
   where gp.user_id = auth.uid() and not gp.is_loan and gp.left_at is null
   group by gp.group_id
$$;

-- Davet koduyla katılma: ayrılmış üye yeniden açılır (rol üye), ödünç oyuncu kalıcı üye olur
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
  on conflict (group_id, user_id) do update
    set is_loan = false,
        role = case when group_players.left_at is not null then 'member' else group_players.role end,
        left_at = null;
  return v_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ortak temizlik: gelecekteki (planlanmış) maç kadrolarından ve açık çağrılardan çıkar, satırı kapat
-- ---------------------------------------------------------------------------
create function public.deactivate_member(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from match_players mp using matches m
   where m.id = mp.match_id and mp.player_id = p_player_id and m.status = 'planned';
  delete from poll_responses pr using match_polls p
   where p.id = pr.poll_id and pr.player_id = p_player_id and p.status = 'open';
  update group_players set left_at = now() where id = p_player_id;
end;
$$;
revoke all on function public.deactivate_member(uuid) from public, anon, authenticated;

-- Kendi isteğiyle ayrıl
create function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me group_players;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select * into v_me from group_players
   where group_id = p_group and user_id = auth.uid() and left_at is null and not is_loan;
  if not found then raise exception 'Bu grubun üyesi değilsiniz'; end if;
  if v_me.role = 'captain' then
    raise exception 'Ayrılmadan önce kaptanlığı (kuruculuğu) başka birine devretmelisin';
  end if;
  -- Sonucu girilmiş ve oylaması süren maçın oylarını/ratingini eksik bırakma
  if exists (
    select 1 from match_players mp join matches m on m.id = mp.match_id
     where mp.player_id = v_me.id and m.status in ('voting', 'played')
  ) then
    raise exception 'Oylaması süren bir maçın var; oylama bitince ayrılabilirsin';
  end if;
  perform public.deactivate_member(v_me.id);
end;
$$;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- Yetkili oyuncu çıkarır: hesaplı üye ayrılmış sayılır (geçmişi kalır), misafir silinir (eskisi gibi)
create function public.remove_member(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t group_players;
begin
  select * into v_t from group_players where id = p_player_id;
  if not found then raise exception 'Oyuncu bulunamadı'; end if;
  if not public.is_group_admin(v_t.group_id) then raise exception 'Bu işlem için yetkili olmalısınız'; end if;
  if v_t.user_id = auth.uid() then raise exception 'Kendini çıkaramazsın; "Ayrıl" düğmesini kullan'; end if;
  if v_t.role = 'captain' then raise exception 'Kaptan çıkarılamaz'; end if;
  if v_t.role = 'admin' and not (public.is_group_captain(v_t.group_id) or public.group_kind(v_t.group_id) = 'community') then
    raise exception 'Yetkilileri sadece kaptan çıkarabilir';
  end if;
  if v_t.user_id is null then
    delete from group_players where id = v_t.id;
  elsif v_t.left_at is null then
    perform public.deactivate_member(v_t.id);
  end if;
end;
$$;
revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- Doğrudan silme sadece misafir kayıtları için kalır (hesaplı üyeler remove_member ile ayrılmış olur)
drop policy "yetkili oyuncu çıkarır" on public.group_players;
create policy "yetkili misafiri siler" on public.group_players
  for delete to authenticated
  using (public.is_group_admin(group_id) and user_id is null and role = 'member');

-- Tek başına kalan kaptan grubu/takımı siler (devredecek kimsesi yok). Geçmiş maçlar da gider; kişinin
-- genel rating'i sunucuda yeniden hesaplanır.
create function public.delete_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_captain(p_group) then
    raise exception 'Grubu sadece kaptan (kurucu) silebilir';
  end if;
  if exists (
    select 1 from group_players
     where group_id = p_group and user_id is not null and not is_loan and left_at is null and user_id <> auth.uid()
  ) then
    raise exception 'Grupta başka üyeler var; önce kaptanlığı devredip ayrıl';
  end if;
  delete from groups where id = p_group;
end;
$$;
revoke all on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;

-- Grup silme sadece delete_group RPC'siyle (kaptan ve tek üye şartıyla); eski "her yetkili silebilir" politikası kalkar
drop policy "admin grubu siler" on public.groups;

-- Maçtan çekilme isteği: kadroya alınan oyuncu planlanmış maçtan çıkmak isterse kaptan/yetkili onayı gerekir.
-- Onaylanan çekilme kadrodan çıkarır ve "gelmedi" sayılmaz (güvenilirliği bozmaz); reddedilirse oyuncu kadroda kalır,
-- yine gelmezse kaptan "gelmedi" işaretler. Kaptan/yetkili kendi adına doğrudan çıkar (kayıt "onaylı" düşer).

create table public.match_withdrawals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.group_players (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  -- İstek maça 3 saatten az kala geldi
  late boolean not null default false,
  -- closed: oyuncu başka yolla kadrodan çıktı veya maç planlanmış olmaktan çıktı (isteğin anlamı kalmadı)
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled', 'closed')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index match_withdrawals_pending_uq on public.match_withdrawals (match_id, player_id) where status = 'pending';
create index on public.match_withdrawals (match_id);
create index on public.match_withdrawals (player_id);

alter table public.match_withdrawals enable row level security;
create policy "çekilme isteğini sahibi ve yetkililer görür" on public.match_withdrawals
  for select to authenticated
  using (
    exists (select 1 from public.group_players gp where gp.id = player_id and gp.user_id = auth.uid())
    or public.is_group_admin(public.match_group(match_id))
  );

-- İstek gönder. 'pending' (onay bekliyor) veya 'approved' (kaptan/yetkili: doğrudan çıkarıldı) döner.
create function public.request_withdrawal(p_match uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_me group_players;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
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

  if public.is_group_admin(v_m.group_id) then
    insert into match_withdrawals (match_id, player_id, reason, late, status, decided_by, decided_at)
    values (p_match, v_me.id, nullif(btrim(p_reason), ''), v_m.played_at - now() < interval '3 hours', 'approved', auth.uid(), now());
    delete from match_players where match_id = p_match and player_id = v_me.id;
    return 'approved';
  end if;

  insert into match_withdrawals (match_id, player_id, reason, late)
  values (p_match, v_me.id, nullif(btrim(p_reason), ''), v_m.played_at - now() < interval '3 hours');
  return 'pending';
end;
$$;
revoke all on function public.request_withdrawal(uuid, text) from public, anon;
grant execute on function public.request_withdrawal(uuid, text) to authenticated;

-- İsteği geri çek (sadece sahibi, bekleyen)
create function public.cancel_withdrawal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update match_withdrawals w
     set status = 'cancelled', decided_at = now()
   where w.id = p_id and w.status = 'pending'
     and exists (select 1 from group_players gp where gp.id = w.player_id and gp.user_id = auth.uid());
  if not found then raise exception 'Bekleyen isteğin bulunamadı'; end if;
end;
$$;
revoke all on function public.cancel_withdrawal(uuid) from public, anon;
grant execute on function public.cancel_withdrawal(uuid) to authenticated;

-- Kaptan/yetkili karar verir
create function public.decide_withdrawal(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_w match_withdrawals;
  v_m matches;
begin
  select * into v_w from match_withdrawals where id = p_id;
  if not found then raise exception 'İstek bulunamadı'; end if;
  select * into v_m from matches where id = v_w.match_id;
  if not public.is_group_admin(v_m.group_id) then
    raise exception 'Çekilme isteğine sadece kaptan veya yetkililer karar verir';
  end if;
  if v_w.status <> 'pending' then raise exception 'Bu istek zaten sonuçlandı'; end if;
  if v_m.status <> 'planned' then raise exception 'Maç artık planlanmış değil'; end if;
  if p_approve then
    update match_withdrawals set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
    delete from match_players where match_id = v_w.match_id and player_id = v_w.player_id;
  else
    update match_withdrawals set status = 'denied', decided_by = auth.uid(), decided_at = now() where id = p_id;
  end if;
end;
$$;
revoke all on function public.decide_withdrawal(uuid, boolean) from public, anon;
grant execute on function public.decide_withdrawal(uuid, boolean) to authenticated;

-- Oyuncu başka yolla kadrodan çıkarsa (kaptan çıkardı, "gelmedi", ayrıldı) bekleyen istek anlamını yitirir
create function public.close_withdrawal_on_roster_removal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update match_withdrawals set status = 'closed', decided_at = now()
   where match_id = old.match_id and player_id = old.player_id and status = 'pending';
  return old;
end;
$$;
create trigger close_withdrawal_on_roster_removal after delete on public.match_players
  for each row execute function public.close_withdrawal_on_roster_removal();

-- Maç planlanmış olmaktan çıkınca (sonuç girildi, iptal) bekleyen istekler kapanır
create function public.close_withdrawals_on_match_start()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update match_withdrawals set status = 'closed', decided_at = now()
   where match_id = new.id and status = 'pending';
  return new;
end;
$$;
create trigger close_withdrawals_on_match_start after update of status on public.matches
  for each row when (old.status = 'planned' and new.status <> 'planned')
  execute function public.close_withdrawals_on_match_start();

-- Canlı güncelleme: istek ve karar maç ekranında anında görünsün
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_withdrawals') then
    alter publication supabase_realtime add table public.match_withdrawals;
  end if;
end $$;

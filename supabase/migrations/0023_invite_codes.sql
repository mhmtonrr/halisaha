-- Davet kodu: link yanında elle yazılabilen, okunaklı kod. Yeni kodlar 10 karakter (karışan O/0/I/1/L yok), ekranda
-- "XXXXX-XXXXX" gösterilir. Eski 12 karakterli kodlar çalışmaya devam eder. Katılırken büyük/küçük harf, boşluk ve tire yok sayılır.

create function public.new_invite_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  i integer;
begin
  loop
    v_code := '';
    for i in 1..10 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (select 1 from groups where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function public.new_invite_code() from public, anon;
grant execute on function public.new_invite_code() to authenticated;

alter table public.groups alter column invite_code set default public.new_invite_code();

-- Kullanıcının yazdığı kodu normalleştirir: boşluk/tire/büyük-küçük harf farkı yok sayılır
create function public.norm_invite(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'))
$$;

create or replace function public.regenerate_invite(p_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text := public.new_invite_code();
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Bu işlem için yetkili olmalısınız';
  end if;
  update groups set invite_code = v_code where id = p_group_id;
  return v_code;
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  select id into v_group_id from groups where upper(invite_code) = public.norm_invite(p_invite_code);
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

-- Katılmadan önce önizleme: kod hangi takıma/gruba ait? (kod bilen herkes görür; başka bilgi sızmaz)
create function public.invite_preview(p_code text)
returns table (group_id uuid, name text, kind text, city text, district text, color text, description text,
               members integer, already_member boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.kind, g.city, g.district, g.color, g.description,
         (select count(*)::int from group_players gp
           where gp.group_id = g.id and gp.user_id is not null and not gp.is_loan and gp.left_at is null),
         public.is_group_member(g.id)
    from groups g
   where auth.uid() is not null and upper(g.invite_code) = public.norm_invite(p_code)
$$;
revoke all on function public.invite_preview(text) from public, anon;
grant execute on function public.invite_preview(text) to authenticated;

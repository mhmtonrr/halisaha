-- Takım/grup logosu: groups.logo boş (otomatik arma), birleştirmeli arma, hazır logo veya yüklenen görsel.
-- Yüklenen görseller "logos" deposunda <grup_id>/<dosya>; herkes okur, sadece grubun kaptanı/yetkilisi yazar/siler.

-- Adres sadece grubun kendi klasöründeki depo dosyasını gösterebilir (başka siteye/gruba işaret edemez).
create or replace function public.logo_ok(p text, gid uuid) returns boolean
language sql immutable as $$
  select p is null or (
    char_length(p) <= 300 and (
      p ~ '^crest:[a-z]{2,16}\.[a-z]{2,16}\.[a-z]{2,16}\.[0-9a-f]{6}$'
      or p ~ '^preset:[a-z0-9-]{1,40}$'
      or p ~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/logos/' || gid::text || '/[A-Za-z0-9._-]+(\?v=[0-9]+)?$')
    )
  )
$$;

-- Güncelleme yetkisi mevcut "admin grubu düzenler" politikasında
alter table public.groups add column logo text check (public.logo_ok(logo, id));
grant select (logo) on public.groups to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 524288, array['image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Klasör adı grup kimliği değilse hayır (uuid dönüşümü hata vermesin)
create or replace function public.can_edit_logo(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_group_admin(p_folder::uuid) else false end
$$;

create policy "logos yetkili okur" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and public.can_edit_logo((storage.foldername(name))[1]));
create policy "logos yetkili yükler" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.can_edit_logo((storage.foldername(name))[1]));
create policy "logos yetkili değiştirir" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.can_edit_logo((storage.foldername(name))[1]))
  with check (bucket_id = 'logos' and public.can_edit_logo((storage.foldername(name))[1]));
create policy "logos yetkili siler" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.can_edit_logo((storage.foldername(name))[1]));

-- Logoyu döndüren fonksiyonlar (dönüş tipi değiştiği için önce silinir; eski kod fazla alanı yok sayar)
drop function public.invite_preview(text);
create function public.invite_preview(p_code text)
returns table (group_id uuid, name text, kind text, city text, district text, color text, description text,
               members integer, already_member boolean, logo text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.kind, g.city, g.district, g.color, g.description,
         (select count(*)::int from group_players gp
           where gp.group_id = g.id and gp.user_id is not null and not gp.is_loan and gp.left_at is null),
         public.is_group_member(g.id), g.logo
    from groups g
   where auth.uid() is not null and upper(g.invite_code) = public.norm_invite(p_code)
$$;
revoke all on function public.invite_preview(text) from public, anon;
grant execute on function public.invite_preview(text) to authenticated;

drop function public.discover_groups(text, text, text);
create or replace function public.discover_groups(p_city text default null, p_district text default null, p_kind text default null)
returns table (
  group_id uuid, name text, kind text, city text, district text, description text, color text,
  member_count integer, accepts_requests boolean, is_member boolean, my_request text, logo text
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.kind, g.city, g.district, g.description, g.color,
         (select count(*)::int from group_players gp where gp.group_id = g.id and gp.user_id is not null
            and gp.left_at is null and not gp.is_loan),
         public.accepts_join_requests(g.id),
         public.is_group_member(g.id),
         (select r.status from group_join_requests r where r.group_id = g.id and r.user_id = auth.uid()
           order by r.created_at desc limit 1),
         g.logo
    from groups g
   where g.archived_at is null and not g.is_temporary
     and (g.kind = 'team' or g.discoverable)
     and (p_kind is null or g.kind = p_kind)
     and (p_city is null or g.city = p_city)
     and (p_district is null or g.district = p_district)
   order by g.name
   limit 100
$$;
revoke all on function public.discover_groups(text, text, text) from public, anon;
grant execute on function public.discover_groups(text, text, text) to authenticated;

drop function public.match_overview(uuid[]);
create or replace function public.match_overview(p_ids uuid[])
returns table (
  match_id uuid, group_id uuid, group_name text, group_kind text, group_color text, city text, district text,
  status text, kind text, played_at timestamptz, time_tbd boolean, venue text, team_size smallint, capacity smallint,
  roster_count smallint, reserve_count smallint, opponent_name text, note text, positions text[],
  my_status text, is_member boolean, can_manage boolean, group_logo text
)
language sql stable security definer set search_path = public as $$
  select m.id, g.id, g.name, g.kind, g.color, g.city, g.district,
         m.status::text, m.kind, m.played_at, m.time_tbd, m.venue, m.team_size, m.capacity,
         m.roster_count, m.reserve_count, m.opponent_name, m.note,
         coalesce((select array_agg(distinct p) from match_listings l, unnest(l.positions) p
                    where l.match_id = m.id and l.status = 'active'), '{}'),
         (select e.status from match_entries e where e.match_id = m.id and e.user_id = auth.uid()),
         public.is_group_member(g.id), public.can_manage_match(m.id), g.logo
    from matches m join groups g on g.id = m.group_id
   where m.id = any(p_ids) and public.can_view_match(m.id)
$$;
revoke all on function public.match_overview(uuid[]) from public, anon;
grant execute on function public.match_overview(uuid[]) to authenticated;

create or replace function public.match_by_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_m matches;
  v_g groups;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısınız'; end if;
  select m.* into v_m from match_codes c join matches m on m.id = c.match_id where c.code = public.norm_invite(p_code);
  if v_m.id is null then return null; end if;
  select * into v_g from groups where id = v_m.group_id;
  return jsonb_build_object(
    'match_id', v_m.id, 'group_id', v_g.id, 'group_name', v_g.name, 'group_kind', v_g.kind, 'group_color', v_g.color, 'group_logo', v_g.logo,
    'city', v_g.city, 'district', v_g.district, 'status', v_m.status::text, 'kind', v_m.kind,
    'played_at', v_m.played_at, 'time_tbd', v_m.time_tbd, 'venue', v_m.venue, 'team_size', v_m.team_size,
    'capacity', v_m.capacity, 'roster_count', v_m.roster_count, 'reserve_count', v_m.reserve_count,
    'opponent_name', v_m.opponent_name, 'note', v_m.note,
    'fee_per_person', v_m.fee_per_person,
    'pending_rival', (select g2.name from match_challenges c join groups g2 on g2.id = c.to_group_id where c.from_match_id = v_m.id and c.status = 'pending' limit 1),
    'my_status', (select status from match_entries where match_id = v_m.id and user_id = auth.uid()),
    'is_member', public.is_group_member(v_g.id),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', gp.display_name, 'position', coalesce(mp.position, gp.position), 'guest', gp.user_id is null,
               'overall', ur.overall, 'photo_url', gp.photo_url) order by gp.display_name)
        from match_players mp join group_players gp on gp.id = mp.player_id
        left join user_ratings ur on ur.user_id = gp.user_id
       where mp.match_id = v_m.id), '[]'::jsonb));
end;
$$;

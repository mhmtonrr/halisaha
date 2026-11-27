-- Herkese açık takımın açık maçı yalnızca ilgililere (kullanıcı kararı 2026-11-27).
-- Toplanan / kesin / iptal / sonuçsuz maçı: takım üyesi, yöneten, kaydı olan (kadro, yedek, davetli, başvuran, "gelemem"),
-- açık ilanı gören ve eşleşmiş rakip takımın üyeleri görür. Oynanmış (skor onayı, oylama, kapanmış) maçlar takımda
-- herkese açık kalır. Davet bağlantısı (match_by_code) aynen çalışır. 'removed'/'rejected' engeli (0056) sürer.

create or replace function public.can_view_match(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
     where m.id = p_match
       and not public.match_blocked(m.id)
       and (public.is_group_member(m.group_id)
            or (m.status::text in ('played', 'voting', 'closed') and public.is_group_visible(m.group_id))
            or public.can_manage_match(m.id)
            or exists (select 1 from match_entries e where e.match_id = m.id and e.user_id = auth.uid()
                        and e.status in ('in', 'reserve', 'invited', 'pending', 'declined'))
            or public.is_match_participant(m.id)
            or exists (select 1 from match_listings l
                        where l.match_id = m.id and l.status = 'active'
                          and (l.target_group_id is null or public.is_group_member(l.target_group_id)))
            or (m.challenge_id is not null
                and exists (select 1 from matches o where o.challenge_id = m.challenge_id and public.is_group_member(o.group_id))))
  )
$$;

-- Üyelik koşulu ayrıca yazılı: yeni eklenen satır (insert ... returning) fonksiyonun görüntüsünde henüz yoktur
drop policy "maçları görür" on public.matches;
create policy "maçları görür" on public.matches
  for select to authenticated using (public.is_group_member(group_id) or public.can_view_match(id));

drop policy "kadroyu görür" on public.match_players;
create policy "kadroyu görür" on public.match_players
  for select to authenticated using (public.is_group_member(public.match_group(match_id)) or public.can_view_match(match_id));

drop policy "sonuçları görür" on public.match_results;
create policy "sonuçları görür" on public.match_results
  for select to authenticated using (public.is_group_member(public.match_group(match_id)) or public.can_view_match(match_id));

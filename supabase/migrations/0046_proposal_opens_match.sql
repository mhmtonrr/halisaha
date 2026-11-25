-- Yeniden tasarım 5a (kullanıcı kararı 2026-11-25): onaylanan üye önerisi artık çağrı değil toplanan maç açar.
-- Format öneride yok; onaylayan seçer (varsayılan 7v7). Maç öneren adına açılır (o yönetir, 0037'deki gibi), öneren kadroya yazılır,
-- gruba/takıma duyurulur. Takımda rakip sonra belirlenir. Saat geçmişse/yoksa "saat belli değil".

alter table public.match_proposals add column match_id uuid references public.matches (id) on delete set null;

drop function if exists public.decide_proposal(uuid, boolean);
create or replace function public.decide_proposal(p_id uuid, p_accept boolean, p_team_size smallint default 7)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p match_proposals;
  v_kind text;
  v_m matches;
  v_tbd boolean;
begin
  select * into v_p from match_proposals where id = p_id for update;
  if v_p.id is null then raise exception 'Öneri bulunamadı'; end if;
  if not public.can_create_match(v_p.group_id) then raise exception 'Öneriye sadece kurucu, yetkili ve organizatörler karar verir'; end if;
  if v_p.status <> 'pending' then raise exception 'Bu öneri zaten sonuçlandı'; end if;
  if not p_accept then
    update match_proposals set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return null;
  end if;
  if v_p.play_on < public.istanbul_today() then raise exception 'Önerinin günü geçti'; end if;
  if not exists (select 1 from group_players where group_id = v_p.group_id and user_id = v_p.proposed_by and left_at is null and not is_loan) then
    raise exception 'Öneren kişi artık grubun üyesi değil';
  end if;
  if p_team_size is null or p_team_size not between 5 and 11 then raise exception 'Kişi sayısı 5 ile 11 arasında olmalı'; end if;
  v_kind := case when public.group_kind(v_p.group_id) = 'team' then 'external' else 'internal' end;
  v_tbd := v_p.starts_at is null or v_p.starts_at <= now();
  insert into matches (group_id, played_at, time_tbd, venue, created_by, kind, team_size, capacity, open_to_members, note, status)
  values (v_p.group_id,
          case when v_tbd then (v_p.play_on + time '12:00') at time zone 'Europe/Istanbul' else v_p.starts_at end,
          v_tbd, v_p.venue, v_p.proposed_by, v_kind, p_team_size,
          case when v_kind = 'internal' then p_team_size * 2 else p_team_size end,
          true, v_p.note, 'gathering')
  returning * into v_m;
  perform public.put_in_roster(v_m, v_p.proposed_by, null);
  update match_entries set source = 'member' where match_id = v_m.id and user_id = v_p.proposed_by;
  update match_proposals set status = 'accepted', match_id = v_m.id, decided_by = auth.uid(), decided_at = now() where id = p_id;
  return v_m.id;
end;
$$;
revoke all on function public.decide_proposal(uuid, boolean, smallint) from public, anon;
grant execute on function public.decide_proposal(uuid, boolean, smallint) to authenticated;

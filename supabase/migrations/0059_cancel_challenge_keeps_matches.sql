-- Teklifler sayfasından iptal de maç ekranındaki gibi davranır: kabul edilmiş teklifin maçları silinmez,
-- "iptal edildi" olarak kalır (toplanan maç da iptal edilebilir).
create or replace function public.cancel_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if v_c.id is null then raise exception 'Teklif bulunamadı'; end if;
  if not (public.is_group_admin(v_c.from_group_id) or public.is_group_admin(v_c.to_group_id)) then
    raise exception 'Bu işlem için yetkili olmalısınız';
  end if;

  if v_c.status = 'pending' then
    if not public.is_group_admin(v_c.from_group_id) then
      raise exception 'Bekleyen teklifi sadece gönderen takım geri çekebilir (karşı takım reddedebilir)';
    end if;
  elsif v_c.status = 'accepted' then
    if exists (select 1 from matches where challenge_id = v_c.id and status::text not in ('gathering', 'planned', 'cancelled')) then
      raise exception 'Skoru girilmiş maç iptal edilemez';
    end if;
    update matches
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
     where challenge_id = v_c.id and status::text in ('gathering', 'planned');
  else
    raise exception 'Bu teklif iptal edilemez';
  end if;

  update match_challenges set status = 'cancelled', responded_at = now() where id = p_challenge_id;
end;
$$;

-- Yeniden tasarım 3. parça (kullanıcı kararları 2026-11-25): zamanlanmış işlerin durum değişiklikleri.
-- /api/cron/tick (pg_cron + pg_net her 15 dk; Vercel Cron günde 1 yedek) service role ile çağırır, bildirimleri uygulama yollar.
--  * Maça 3 saat kala boş yer varsa yedek sırasındaki ilk kişiler otomatik kadroya.
--  * Saati geçen (saat belli değilse günü biten) toplanan maç otomatik iptal.
--  * Kesin maç 2 gün içinde skor girilmezse sonuçsuz (no_result); bağlı maçta rakibi bekleyen (played) de.
-- Fonksiyonlar sadece service role'e açık.

create or replace function public.cron_promote_reserves()
returns table (match_id uuid, group_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_m matches;
  v_e match_entries;
begin
  for v_m in
    select * from matches m
     where m.status in ('gathering', 'planned') and not m.time_tbd
       and m.played_at > now() and m.played_at <= now() + interval '3 hours'
       and m.reserve_count > 0 and m.roster_count < m.capacity
     for update skip locked
  loop
    loop
      exit when public.match_roster_count(v_m.id) >= v_m.capacity;
      select * into v_e from match_entries e
       where e.match_id = v_m.id and e.status = 'reserve' and e.user_id is not null
       order by e.queued_at nulls last, e.created_at
       limit 1;
      exit when v_e.id is null;
      perform public.put_in_roster(v_m, v_e.user_id, v_e.position);
      update match_entries set queued_at = null, updated_at = now() where id = v_e.id;
      match_id := v_m.id; group_id := v_m.group_id; user_id := v_e.user_id;
      return next;
      v_e := null;
    end loop;
  end loop;
end;
$$;

create or replace function public.cron_cancel_stale()
returns table (match_id uuid, group_id uuid, played_at timestamptz, time_tbd boolean, opponent_name text)
language sql security definer set search_path = public as $$
  update matches m
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Kadro tamamlanmadan maç zamanı geçti'
   where m.status = 'gathering' and public.match_time_passed(m)
  returning m.id, m.group_id, m.played_at, m.time_tbd, m.opponent_name
$$;

create or replace function public.cron_no_result()
returns table (match_id uuid, group_id uuid)
language sql security definer set search_path = public as $$
  update matches m set status = 'no_result'
   where m.status in ('planned', 'played') and m.played_at < now() - interval '2 days'
  returning m.id, m.group_id
$$;

do $$
declare
  f text;
begin
  foreach f in array array['cron_promote_reserves()', 'cron_cancel_stale()', 'cron_no_result()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

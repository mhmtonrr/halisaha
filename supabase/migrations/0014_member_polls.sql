-- Üye çağrısı: grupta üyeler maç kuramaz ama ÇAĞRI açabilir. Çağrı şartı sağlarsa kendiliğinden maça dönüşür
-- (uygulama tarafı, src/lib/polls.ts): kontenjan dolunca hemen; son yanıt süresi bitince "geliyorum" diyenler
-- kontenjanın en az %70'iyse onlarla, değilse çağrı iptal olur. Yetkililerin çağrısı eskisi gibi elle onaylanır.
-- Takımda çağrıyı sadece yetkililer açar.

alter table public.match_polls
  add column auto_match boolean not null default false,
  -- Her takımın oyuncu sayısı (5-11); kontenjan = 2 x team_size. Yetkili çağrılarında boş olabilir.
  add column team_size smallint check (team_size between 5 and 11);

-- Üyenin çağrı açması: sınırlar burada zorunlu (spam ve "açıp unutulan çağrı" olmasın)
--  * sadece gruplarda, sadece üyeler
--  * maç en az 3 saat sonra, en fazla 14 gün içinde
--  * son yanıt süresi (boşsa maçtan 3 saat önce) maçtan en az 1 saat önce ve gelecekte
--  * yetkili olmayan üye aynı anda en fazla 1 açık çağrı açabilir
-- Çağrıyı açan kişi otomatik "geliyorum" olur.
create function public.create_member_poll(
  p_group uuid, p_starts_at timestamptz, p_venue text, p_size smallint,
  p_deadline timestamptz default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_deadline timestamptz;
  v_id uuid;
  v_me uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if public.group_kind(p_group) is distinct from 'community' then
    raise exception 'Üye çağrısı sadece gruplarda açılır; takımda çağrıyı kaptan ve yetkililer açar';
  end if;
  if not public.is_group_member(p_group) then
    raise exception 'Bu grubun üyesi değilsiniz';
  end if;
  if p_size is null or p_size not between 5 and 11 then
    raise exception 'Kişi sayısı 5 ile 11 arasında olmalı';
  end if;
  if p_starts_at is null or p_starts_at < now() + interval '3 hours' then
    raise exception 'Maç en az 3 saat sonrasına planlanmalı';
  end if;
  if p_starts_at > now() + interval '14 days' then
    raise exception 'Maç en fazla 14 gün sonrasına planlanabilir';
  end if;
  v_deadline := coalesce(p_deadline, p_starts_at - interval '3 hours');
  if v_deadline > p_starts_at - interval '1 hour' then
    raise exception 'Son yanıt süresi maçtan en az 1 saat önce olmalı';
  end if;
  if v_deadline <= now() then
    raise exception 'Son yanıt süresi geçmişte olamaz';
  end if;
  if not public.is_group_admin(p_group) and exists (
    select 1 from match_polls
     where group_id = p_group and created_by = auth.uid() and status = 'open' and auto_match
  ) then
    raise exception 'Zaten açık bir çağrın var; önce onu iptal et veya sonuçlanmasını bekle';
  end if;

  insert into match_polls (group_id, created_by, starts_at, venue, capacity, deadline, note, auto_match, team_size)
  values (p_group, auth.uid(), p_starts_at, nullif(btrim(p_venue), ''), p_size * 2, v_deadline,
          nullif(btrim(p_note), ''), true, p_size)
  returning id into v_id;

  v_me := public.my_player_id(p_group);
  insert into poll_responses (poll_id, player_id, answer) values (v_id, v_me, 'yes');
  return v_id;
end;
$$;

-- Çağrıyı kapat (iptal): açan kişi veya yetkili. Maça dönüşmüş çağrı kapatılamaz.
create function public.close_poll(p_poll_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_poll match_polls;
begin
  select * into v_poll from match_polls where id = p_poll_id;
  if v_poll is null then
    raise exception 'Çağrı bulunamadı';
  end if;
  if v_poll.created_by <> auth.uid() and not public.is_group_admin(v_poll.group_id) then
    raise exception 'Çağrıyı sadece açan kişi veya yetkili iptal edebilir';
  end if;
  if v_poll.status <> 'open' then
    raise exception 'Bu çağrı zaten kapalı veya maça dönüştü';
  end if;
  update match_polls set status = 'closed' where id = p_poll_id;
end;
$$;

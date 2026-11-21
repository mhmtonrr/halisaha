-- Takımlar arası maç teklifi.
-- Takım A, takım B'ye tarih/saha/ücret içeren teklif gönderir; B kabul ederse iki takımda da
-- birer "rakibe karşı" (external) maç oluşur ve ortak teklif kaydıyla (challenge_id) bağlanır.
-- Her takım kendi oyuncularını kendi içinde puanlar (rating motoru değişmez).
-- Skor iki taraftan da girilir; ikisi birbirinin aynası olunca iki maçın da oylaması açılır.

-- ---------------------------------------------------------------------------
-- Teklifler
-- ---------------------------------------------------------------------------
create table public.match_challenges (
  id uuid primary key default gen_random_uuid(),
  from_group_id uuid not null references public.groups (id) on delete cascade,
  to_group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  proposed_at timestamptz not null,
  venue text check (char_length(venue) <= 80),
  fee_note text check (char_length(fee_note) <= 120),
  message text check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_group_id <> to_group_id)
);
create index on public.match_challenges (to_group_id, status, created_at desc);
create index on public.match_challenges (from_group_id, status, created_at desc);

-- Maçı teklife bağlar; karşı takımın bağlı maçı ve rakip takım
alter table public.matches
  add column challenge_id uuid references public.match_challenges (id) on delete set null,
  add column opponent_group_id uuid references public.groups (id) on delete set null;
create index on public.matches (challenge_id);

-- ---------------------------------------------------------------------------
-- Satır seviyesinde güvenlik: teklifi iki takımın üyeleri görür, yazma sadece RPC ile
-- ---------------------------------------------------------------------------
alter table public.match_challenges enable row level security;
create policy "teklifi iki takımın üyeleri görür" on public.match_challenges
  for select to authenticated
  using (public.is_group_member(from_group_id) or public.is_group_member(to_group_id));

-- ---------------------------------------------------------------------------
-- RPC'ler
-- ---------------------------------------------------------------------------

-- Teklif gönder: kendi takımının yetkilisi, karşı taraf da bir takım olmalı
create function public.create_challenge(
  p_from uuid, p_to uuid, p_at timestamptz, p_venue text, p_fee text, p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısınız';
  end if;
  if p_from = p_to then
    raise exception 'Kendi takımınıza teklif gönderemezsiniz';
  end if;
  if public.group_kind(p_from) is distinct from 'team' or public.group_kind(p_to) is distinct from 'team' then
    raise exception 'Teklifler sadece takımlar arasında gönderilir';
  end if;
  if not public.is_group_admin(p_from) then
    raise exception 'Teklifi sadece takımın kaptanı veya yetkilisi gönderir';
  end if;
  if p_at is null or p_at < now() then
    raise exception 'Maç zamanı geçmişte olamaz';
  end if;
  if (select count(*) from match_challenges
       where from_group_id = p_from and to_group_id = p_to and status = 'pending') >= 3 then
    raise exception 'Bu takıma zaten bekleyen teklifleriniz var';
  end if;

  insert into match_challenges (from_group_id, to_group_id, created_by, proposed_at, venue, fee_note, message)
  values (p_from, p_to, auth.uid(), p_at,
          nullif(btrim(p_venue), ''), nullif(btrim(p_fee), ''), nullif(btrim(p_message), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Karşı takımın yetkilisi kabul/ret eder. Kabulde iki takımda da planlanmış maç açılır.
-- Dönen değer: kabul edenin tarafında oluşan maçın id'si (ret'te null).
create function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
  v_from_name text;
  v_to_name text;
  v_m_from uuid;
  v_m_to uuid;
begin
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if v_c is null then
    raise exception 'Teklif bulunamadı';
  end if;
  if not public.is_group_admin(v_c.to_group_id) then
    raise exception 'Teklifi sadece karşı takımın kaptanı veya yetkilisi yanıtlar';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Bu teklif zaten yanıtlandı';
  end if;

  if not p_accept then
    update match_challenges
       set status = 'declined', responded_by = auth.uid(), responded_at = now()
     where id = p_challenge_id;
    return null;
  end if;

  if v_c.proposed_at < now() then
    raise exception 'Teklif edilen zaman geçti';
  end if;
  select name into v_from_name from groups where id = v_c.from_group_id;
  select name into v_to_name from groups where id = v_c.to_group_id;

  insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id)
  values (v_c.from_group_id, v_c.proposed_at, v_c.venue, v_c.created_by, 'external', v_to_name, v_c.to_group_id, v_c.id)
  returning id into v_m_from;
  insert into matches (group_id, played_at, venue, created_by, kind, opponent_name, opponent_group_id, challenge_id)
  values (v_c.to_group_id, v_c.proposed_at, v_c.venue, auth.uid(), 'external', v_from_name, v_c.from_group_id, v_c.id)
  returning id into v_m_to;

  update match_challenges
     set status = 'accepted', responded_by = auth.uid(), responded_at = now()
   where id = p_challenge_id;
  return v_m_to;
end;
$$;

-- İptal: gönderen takım bekleyen teklifi geri çeker; kabul edilmiş ama oynanmamış
-- maçı iki takımdan birinin yetkilisi iptal eder (iki taraftaki maç da silinir).
create function public.cancel_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c match_challenges;
begin
  select * into v_c from match_challenges where id = p_challenge_id for update;
  if v_c is null then
    raise exception 'Teklif bulunamadı';
  end if;
  if not (public.is_group_admin(v_c.from_group_id) or public.is_group_admin(v_c.to_group_id)) then
    raise exception 'Bu işlem için yetkili olmalısınız';
  end if;

  if v_c.status = 'pending' then
    if not public.is_group_admin(v_c.from_group_id) then
      raise exception 'Bekleyen teklifi sadece gönderen takım geri çekebilir (karşı takım reddedebilir)';
    end if;
  elsif v_c.status = 'accepted' then
    if exists (select 1 from matches where challenge_id = v_c.id and status <> 'planned') then
      raise exception 'Skoru girilmiş maç iptal edilemez';
    end if;
    delete from matches where challenge_id = v_c.id;
  else
    raise exception 'Bu teklif iptal edilemez';
  end if;

  update match_challenges set status = 'cancelled', responded_at = now() where id = p_challenge_id;
end;
$$;

-- Bağlı maçta skor girildikten sonra çağrılır: iki taraf da skor girmiş ve skorlar
-- birbirinin aynasıysa iki maçın da oylaması açılır. Dönen değer:
--   'waiting'  rakip henüz skor girmedi
--   'mismatch' skorlar uyuşmuyor (taraflar düzeltmeli)
--   'settled'  skorlar eşleşti, oylamalar açıldı
create function public.settle_linked_match(p_match_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me matches;
  v_other matches;
  v_deadline timestamptz := now() + interval '24 hours';
begin
  if not public.can_manage_match(p_match_id) then
    raise exception 'Bu maçı yönetme yetkiniz yok';
  end if;
  select * into v_me from matches where id = p_match_id for update;
  if v_me.challenge_id is null or v_me.status <> 'played' then
    raise exception 'Bu maç için skor eşleştirmesi yapılamaz';
  end if;
  select * into v_other from matches
   where challenge_id = v_me.challenge_id and id <> v_me.id for update;
  if v_other is null or v_other.status <> 'played' then
    return 'waiting';
  end if;
  if v_me.score_a is distinct from v_other.score_b or v_me.score_b is distinct from v_other.score_a then
    return 'mismatch';
  end if;

  update matches set status = 'voting', voting_deadline = v_deadline
   where id in (v_me.id, v_other.id);
  return 'settled';
end;
$$;

-- Sohbette "voting" kartı artık skor onayı bekleyen (played) maçtan da gelir
create or replace function public.chat_on_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            '⚽ Maç kuruldu: ' || public.chat_tr_date(new.played_at)
              || case when new.kind = 'external' then ' · vs ' || new.opponent_name else '' end
              || coalesce(' · ' || new.venue, ''),
            new.id);
  elsif new.status = 'voting' and old.status in ('planned', 'played') then
    insert into group_messages (group_id, kind, body, match_id)
    values (new.group_id, 'system',
            '🗳️ Maç bitti (' || new.score_a || '-' || new.score_b || '). Oylama açıldı, takım arkadaşlarını puanla!',
            new.id);
  end if;
  return new;
end;
$$;

-- Teklif etkinlikleri iki takımın sohbetine düşer
create function public.chat_on_challenge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_to text;
begin
  select name into v_from from groups where id = new.from_group_id;
  select name into v_to from groups where id = new.to_group_id;
  if tg_op = 'INSERT' then
    insert into group_messages (group_id, kind, body)
    values (new.to_group_id, 'system',
            '🤝 ' || v_from || ' maç teklif etti: ' || public.chat_tr_date(new.proposed_at)
              || coalesce(' · ' || new.venue, '') || '. Teklifler sayfasından yanıtlayın.');
  elsif new.status <> old.status and new.status in ('accepted', 'declined') then
    insert into group_messages (group_id, kind, body)
    values (new.from_group_id, 'system',
            case when new.status = 'accepted'
                 then '✅ ' || v_to || ' maç teklifini kabul etti: ' || public.chat_tr_date(new.proposed_at)
                 else '❌ ' || v_to || ' maç teklifini reddetti.' end);
  end if;
  return new;
end;
$$;
create trigger chat_on_challenge after insert or update of status on public.match_challenges
  for each row execute function public.chat_on_challenge();

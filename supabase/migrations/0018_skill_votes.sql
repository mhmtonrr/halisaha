-- Yetenek oylaması: maç sonrası "kim öne çıktı?" işaretlemesi.
-- Her oy veren (maçta sahada olan hesap sahibi) her kategoride en fazla 2 kişi seçer. Oylar anonimdir:
-- sadece oy veren kendi pusulasını görür; yazma sadece submit_skill_ballot RPC'siyle. Karttaki değerler
-- (player_ratings gibi) sunucuda hesaplanıp player_skills'e yazılır (service role).

create table public.skill_ballots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  voter_id uuid not null references public.group_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, voter_id)
);
create index on public.skill_ballots (voter_id);

create table public.skill_picks (
  ballot_id uuid not null references public.skill_ballots (id) on delete cascade,
  category text not null check (category in
    ('HIZ', 'ŞUT', 'PAS', 'DRİ', 'DEF', 'FİZ', 'REF', 'ATL', 'HAV', 'YER', 'DAĞ', 'İLT')),
  nominee_id uuid not null references public.group_players (id) on delete cascade,
  primary key (ballot_id, category, nominee_id)
);
create index on public.skill_picks (nominee_id);

-- Hesaplanmış yetenekler: kişinin her group_players satırına aynen yazılır (player_ratings gibi)
create table public.player_skills (
  player_id uuid primary key references public.group_players (id) on delete cascade,
  skills jsonb not null default '{}'::jsonb,
  voters smallint not null default 0,
  ballots smallint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.skill_ballots enable row level security;
alter table public.skill_picks enable row level security;
alter table public.player_skills enable row level security;

create policy "kendi pusulamı gör" on public.skill_ballots
  for select to authenticated
  using (exists (select 1 from public.group_players gp where gp.id = voter_id and gp.user_id = auth.uid()));

create policy "kendi işaretlerimi gör" on public.skill_picks
  for select to authenticated
  using (exists (
    select 1 from public.skill_ballots b join public.group_players gp on gp.id = b.voter_id
    where b.id = ballot_id and gp.user_id = auth.uid()
  ));

-- Yetenekler rating'lerle aynı görünürlükte (üye olunan gruplar + herkese açık takımlar)
create policy "yetenekleri gör" on public.player_skills
  for select to authenticated
  using (exists (
    select 1 from public.group_players gp
    where gp.id = player_id and public.is_group_visible(gp.group_id)
  ));

-- ---------------------------------------------------------------------------
-- Pusula gönder: p_picks = {"HIZ": ["<oyuncu id>", ...], ...}; tekrar göndermek eskisinin yerine geçer.
-- ---------------------------------------------------------------------------
create function public.submit_skill_ballot(p_match_id uuid, p_picks jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_voter uuid;
  v_ballot uuid;
  v_status match_status;
  v_played timestamptz;
  v_challenge uuid;
  v_cat text;
  v_ids jsonb;
  v_id uuid;
  v_gk boolean;
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then raise exception 'Geçersiz oy'; end if;

  select status, played_at, challenge_id into v_status, v_played, v_challenge from matches where id = p_match_id;
  if not found then raise exception 'Maç bulunamadı'; end if;
  if v_status not in ('voting', 'closed') or v_played < now() - interval '7 days' then
    raise exception 'Bu maç için yetenek oylaması kapalı';
  end if;

  select mp.player_id into v_voter
    from match_players mp join group_players gp on gp.id = mp.player_id
   where mp.match_id = p_match_id and gp.user_id = auth.uid()
   limit 1;
  if v_voter is null then raise exception 'Bu maçta oynamadığın için oy veremezsin'; end if;

  -- Önce hepsini doğrula
  for v_cat, v_ids in select key, value from jsonb_each(p_picks) loop
    if v_cat not in ('HIZ', 'ŞUT', 'PAS', 'DRİ', 'DEF', 'FİZ', 'REF', 'ATL', 'HAV', 'YER', 'DAĞ', 'İLT') then
      raise exception 'Bilinmeyen kategori';
    end if;
    if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) > 2 then
      raise exception 'Her kategoride en fazla 2 kişi seçebilirsin';
    end if;
    v_gk := v_cat in ('REF', 'ATL', 'HAV', 'YER', 'DAĞ', 'İLT');
    for v_id in select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x loop
      if not exists (
        select 1
          from match_players mp
          join group_players gp on gp.id = mp.player_id
          join matches m on m.id = mp.match_id
         where mp.player_id = v_id
           and (m.id = p_match_id or (v_challenge is not null and m.challenge_id = v_challenge))
           and gp.user_id is distinct from auth.uid()
           and ((coalesce(mp.position, case when mp.is_goalkeeper then 'GK' end, gp.position, '') = 'GK') = v_gk)
      ) then
        raise exception 'Geçersiz oyuncu seçimi';
      end if;
    end loop;
    if (select count(distinct x) from jsonb_array_elements_text(v_ids) x) <> jsonb_array_length(v_ids) then
      raise exception 'Aynı oyuncu iki kez seçilemez';
    end if;
  end loop;

  insert into skill_ballots (match_id, voter_id) values (p_match_id, v_voter)
    on conflict (match_id, voter_id) do update set created_at = now()
    returning id into v_ballot;
  delete from skill_picks where ballot_id = v_ballot;
  for v_cat, v_ids in select key, value from jsonb_each(p_picks) loop
    insert into skill_picks (ballot_id, category, nominee_id)
      select v_ballot, v_cat, (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x;
  end loop;
end $$;

revoke all on function public.submit_skill_ballot(uuid, jsonb) from public, anon;
grant execute on function public.submit_skill_ballot(uuid, jsonb) to authenticated;

-- Canlı güncelleme: kart değerleri değişince sayfalar yenilensin
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_skills') then
    alter publication supabase_realtime add table public.player_skills;
  end if;
end $$;

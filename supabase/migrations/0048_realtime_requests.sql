-- Canlı güncelleme: bekleyen istekler ve maç kayıtları Realtime yayınına (2026-11-26).
-- match_entries ve match_listings ana sayfada zaten dinleniyordu ama yayında değildi (0042/0043'te eklenmemiş):
-- kadro/yedek/başvuru ve ilan değişince sayfalar artık kendiliğinden yenilenir.
-- group_join_requests, match_proposals: İstekler sayfası (/g/[id]/istekler) ve ana sayfa yapılacaklar sayacı.
-- Olaylar RLS'e göre süzülür (kimse göremeyeceği satırın olayını almaz).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['match_entries', 'match_listings', 'match_proposals', 'group_join_requests'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

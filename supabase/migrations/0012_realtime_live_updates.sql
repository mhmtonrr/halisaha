-- Uygulama genelinde canlı güncelleme: sayfalar bu tablolardaki değişiklikleri Realtime ile dinleyip
-- kendini yeniler (sayfayı elle yenilemek gerekmez). Realtime RLS'e uyar: kullanıcı sadece görebildiği
-- satırların değişikliğini alır. Sohbet (group_messages) zaten yayında.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'match_challenges', 'matches', 'match_players', 'match_results',
      'match_polls', 'poll_responses', 'group_players'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

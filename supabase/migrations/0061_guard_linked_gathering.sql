-- Uygulamadaki rakiple bağlı maçta iki taraflı onay (0060) API'den doğrudan güncellemeyle atlanamasın:
-- toplanırken durum, onay, rakip bağlantısı ve skor yalnızca güvenli fonksiyonlarla (RPC / zamanlanmış iş) değişir.
-- Tetikleyici bilerek "security definer" DEĞİL: RPC içinden gelen güncellemede current_user fonksiyonun sahibidir.
create function public.guard_linked_gathering()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated'
     and (new.status, new.confirmed_at, new.challenge_id, new.score_a, new.score_b)
         is distinct from (old.status, old.confirmed_at, old.challenge_id, old.score_a, old.score_b) then
    raise exception 'Rakiple bağlı maç iki takım da onaylamadan değiştirilemez';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_linked_gathering() from public, anon, authenticated;

create trigger guard_linked_gathering before update on public.matches
  for each row when (old.challenge_id is not null and old.status = 'gathering')
  execute function public.guard_linked_gathering();

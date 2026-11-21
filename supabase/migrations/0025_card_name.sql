-- Kartta görünen ad: isteğe bağlı; boşsa kartta gerçek ad (display_name) kullanılır.
-- Karakter kümesi ve uzunluk burada da zorlanır (sunucu kodu ayrıca küfür listesine bakar).
-- group_players.card_name, display_name gibi profilin kopyasıdır: eklemede doldurulur, profil değişince eşitlenir.

create or replace function public.card_name_ok(p text) returns boolean
language sql immutable as $$
  select p is null or (
    p = btrim(p)
    and char_length(p) between 2 and 20
    and p ~ '^[A-Za-zÀ-ÖØ-öø-ɏ .]+$'
    and p !~ '(^|[^A-Za-zÀ-ÖØ-öø-ɏ])\.'
    and p !~ '  '
  )
$$;

alter table public.profiles add column card_name text check (public.card_name_ok(card_name));
alter table public.group_players add column card_name text check (public.card_name_ok(card_name));

create or replace function public.fill_player_card_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.card_name is null then
    select card_name into new.card_name from profiles where id = new.user_id;
  end if;
  return new;
end $$;

create trigger group_players_card_name before insert on public.group_players
  for each row execute function public.fill_player_card_name();

create or replace function public.sync_card_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update group_players set card_name = new.card_name where user_id = new.id;
  return null;
end $$;

create trigger profiles_card_name after update of card_name on public.profiles
  for each row when (old.card_name is distinct from new.card_name)
  execute function public.sync_card_name();

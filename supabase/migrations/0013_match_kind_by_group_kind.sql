-- Takım ve grup farkı: TAKIM sadece rakibe karşı (external) maç kurar; GRUP kendi aralarında (internal) maç kurar.
-- Sadece yeni kayıtlar için zorunlu (insert); mevcut maçlar olduğu gibi kalır.
create function public.enforce_match_kind()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  select kind into v_kind from groups where id = new.group_id;
  if v_kind = 'team' and new.kind <> 'external' then
    raise exception 'Takımlar sadece rakibe karşı maç kurar';
  end if;
  if v_kind = 'community' and new.kind <> 'internal' then
    raise exception 'Gruplar kendi aralarında maç kurar; rakibe karşı maç için bir takım kurun';
  end if;
  return new;
end;
$$;
create trigger enforce_match_kind before insert on public.matches
  for each row execute function public.enforce_match_kind();

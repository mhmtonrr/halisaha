-- Teklif kabulünde rakip takım için açılan maça saha ücreti kopyalanır (sonrasında her takım kendi maçında değiştirir).

create function public.copy_challenge_fee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.challenge_id is not null and new.fee_per_person is null then
    select fee_per_person into new.fee_per_person from matches
     where challenge_id = new.challenge_id and group_id <> new.group_id and fee_per_person is not null
     limit 1;
  end if;
  return new;
end;
$$;
revoke all on function public.copy_challenge_fee() from public, anon, authenticated;

create trigger copy_challenge_fee_on_match before insert on public.matches
  for each row execute function public.copy_challenge_fee();

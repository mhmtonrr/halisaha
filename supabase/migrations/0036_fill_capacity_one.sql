-- 0035 düzeltmesi: eski match_polls_capacity_check (2-40) 1 kişilik "adam ara"yı reddediyordu.
-- Kontenjan 1-40 olur; toplama çağrısındaki 2-40 sınırı create/update_gather_poll içinde, adam aramadaki 1-10 match_polls_fill_shape'te kalır.
alter table public.match_polls drop constraint match_polls_capacity_check;
alter table public.match_polls add constraint match_polls_capacity_check check (capacity between 1 and 40);

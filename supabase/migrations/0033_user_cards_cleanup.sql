-- 0032'den sonra: hesap sahiplerinin kart verisi user_ratings / user_skills'te tek satırdır.
-- Üyelik satırlarına (group_players) kopyalanan eski satırlar ve kopyalayan tetikleyici kaldırılır.
-- player_ratings / player_skills artık sadece misafirler (user_id boş) içindir.

drop trigger if exists copy_rating_on_join on public.group_players;
drop function if exists public.copy_rating_on_join();

delete from public.player_ratings pr
 using public.group_players gp
 where gp.id = pr.player_id and gp.user_id is not null;

delete from public.player_skills ps
 using public.group_players gp
 where gp.id = ps.player_id and gp.user_id is not null;

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
await db.query(`update profiles set height_cm=182, weight_kg=76, available_days='{0,2,4}' where id=$1`, [U(1)]);
ok("boy/kilo/müsait gün kaydedilir", (await q(`select height_cm h, weight_kg w, available_days d from profiles where id=$1`, [U(1)]))[0].h === 182);
ok("geçersiz boy reddedilir", await fails(`update profiles set height_cm=50 where id=$1`, [U(1)]));
ok("geçersiz gün reddedilir", await fails(`update profiles set available_days='{9}' where id=$1`, [U(1)]));
await db.query(`update profiles set frozen_at=now() where id=$1`, [U(1)]);
ok("hesap dondurulabilir", (await q(`select frozen_at f from profiles where id=$1`, [U(1)]))[0].f !== null);

await db.query(`insert into profile_private (user_id, birth_date) values ($1,'1995-06-15')`, [U(1)]);
ok("doğum tarihi birth_year'ı eşitler", (await q(`select birth_year y from profiles where id=$1`, [U(1)]))[0].y === 1995);
await as(2);
ok("başkasının doğum tarihini göremez", (await q(`select * from profile_private`)).length === 0);
ok("başkası adına doğum tarihi ekleyemez", await fails(`insert into profile_private (user_id, birth_date) values ($1,'1990-01-01')`, [U(1)]));

await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
ok("oyuncu engellenir", (await q(`select count(*)::int c from user_blocks`))[0].c === 1);
ok("aynı kişi iki kez engellenemez", await fails(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]));
ok("kendini engelleyemez", await fails(`insert into user_blocks (blocked_user_id) values ($1)`, [U(2)]));
ok("hem oyuncu hem takım verilemez", await fails(`insert into user_blocks (blocked_user_id, blocked_group_id) values ($1, gen_random_uuid())`, [U(1)]));
await as(1);
ok("engellenen kişi engel kaydını göremez", (await q(`select * from user_blocks`)).length === 0);
await as(2);
await db.query(`delete from user_blocks`);
ok("engelleyen engeli kaldırır", (await q(`select * from user_blocks`)).length === 0);

// Özel grup engellenemez, takım engellenir
await db.exec(`reset role`);
await db.exec(`insert into groups (id, name, kind, created_by, city) values ('00000000-0000-0000-0000-0000000000a1','Özel','community','${U(1)}','İstanbul'),('00000000-0000-0000-0000-0000000000a2','Takım','team','${U(1)}','İstanbul')`);
await as(2);
ok("özel grup engellenemez", await fails(`insert into user_blocks (blocked_group_id) values ('00000000-0000-0000-0000-0000000000a1')`));
await db.query(`insert into user_blocks (blocked_group_id) values ('00000000-0000-0000-0000-0000000000a2')`);
ok("takım engellenir", (await q(`select count(*)::int c from user_blocks`))[0].c === 1);

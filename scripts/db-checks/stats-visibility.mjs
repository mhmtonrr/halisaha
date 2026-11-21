import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
ok("varsayılan 'teammates'", (await q(`select stats_visibility v from profiles where id=$1`, [U(1)]))[0].v === "teammates");
await db.query(`update profiles set stats_visibility='public' where id=$1`, [U(1)]);
ok("kullanıcı kendi görünürlüğünü 'public' yapabilir", (await q(`select stats_visibility v from profiles where id=$1`, [U(1)]))[0].v === "public");
ok("geçersiz değer reddedilir", await fails(`update profiles set stats_visibility='herkes' where id=$1`, [U(1)]));
ok("boş değer reddedilir", await fails(`update profiles set stats_visibility=null where id=$1`, [U(1)]));
ok("başkasının görünürlüğünü değiştiremez", (await db.query(`update profiles set stats_visibility='public' where id=$1`, [U(2)])).affectedRows === 0);
await as(2);
ok("başkasının ayarını okuyabilir (sunucu kontrolü için)", (await q(`select stats_visibility v from profiles where id=$1`, [U(1)]))[0].v === "public");

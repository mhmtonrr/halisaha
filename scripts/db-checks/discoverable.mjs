import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
ok("varsayılan açık", (await q(`select discoverable d from profiles where id=$1`, [U(1)]))[0].d === true);
await db.query(`update profiles set discoverable=false where id=$1`, [U(1)]);
ok("kullanıcı kendi görünürlüğünü kapatabilir", (await q(`select discoverable d from profiles where id=$1`, [U(1)]))[0].d === false);
ok("boş değer reddedilir", await fails(`update profiles set discoverable=null where id=$1`, [U(1)]));
ok("başkasının ayarını değiştiremez", (await db.query(`update profiles set discoverable=false where id=$1`, [U(2)])).affectedRows === 0);

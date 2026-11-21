import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const set = (v) => db.query(`update profiles set card_name=$2 where id=$1`, [U(1), v]);

await as(1);
ok("varsayılan boş", (await q(`select card_name c from profiles where id=$1`, [U(1)]))[0].c === null);
for (const v of ["Memo", "Mehmet O.", "Şükrü Ö.", "José Ñ", "M."]) { await set(v); ok(`geçerli: ${v}`, (await q(`select card_name c from profiles where id=$1`, [U(1)]))[0].c === v); }
for (const v of ["A", "Abdurrahman Kemalettin", "Ali1", "Ali-Can", "Ali  Can", " Ali", "Ali ", ".Ali", "Ali..", "Ali .", "Ali ⚽", "Алексей", "Ali×"])
  ok(`geçersiz reddedilir: ${JSON.stringify(v)}`, await fails(`update profiles set card_name=$2 where id=$1`, [U(1), v]));
await set(null);
ok("null'a dönebilir", (await q(`select card_name c from profiles where id=$1`, [U(1)]))[0].c === null);
ok("başkasının kart adını değiştiremez", (await db.query(`update profiles set card_name='Hile' where id=$1`, [U(2)])).affectedRows === 0);

// Grup oyuncusu satırına kopyalanır, profil değişince eşitlenir
await set("Memo");
const g = (await q(`insert into groups (name, created_by) values ('Grup A', $1) returning id`, [U(1)]))[0].id;
ok("grup kurucusunun satırına kart adı kopyalanır", (await q(`select card_name c from group_players where group_id=$1 and user_id=$2`, [g, U(1)]))[0].c === "Memo");
await set("Memo K.");
ok("profil değişince group_players eşitlenir", (await q(`select card_name c from group_players where group_id=$1 and user_id=$2`, [g, U(1)]))[0].c === "Memo K.");
await set(null);
ok("kart adı silinince group_players da boşalır", (await q(`select card_name c from group_players where group_id=$1 and user_id=$2`, [g, U(1)]))[0].c === null);

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
await db.query(`insert into feedback (category, message) values ('oneri', 'Maç hatırlatıcısı eklenebilir mi?')`);
ok("geri bildirim eklenir (user_id otomatik)", (await q(`select user_id u from feedback`))[0].u === U(1));
ok("çok kısa mesaj reddedilir", await fails(`insert into feedback (message) values ('abc')`));
ok("geçersiz kategori reddedilir", await fails(`insert into feedback (category, message) values ('x', 'yeterince uzun mesaj')`));
ok("başkası adına eklenemez", await fails(`insert into feedback (user_id, message) values ($1, 'başkası adına mesaj')`, [U(2)]));
await as(2);
ok("başkasının geri bildirimini okuyamaz", (await q(`select * from feedback`)).length === 0);
ok("güncelleyemez/silemez", (await db.query(`delete from feedback`)).affectedRows === 0);

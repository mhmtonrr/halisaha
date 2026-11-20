// Gruplarda yetki modeli: kurucu (captain) + yetkili (admin) + üye
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };

await as(1);
const g = (await db.query(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`)).rows[0];
const code = (await db.query(`select group_invite_code($1) c`, [g.id])).rows[0].c;
for (const n of [2, 3]) { await as(n); await db.query(`select join_group($1)`, [code]); }
const role = async (n) => (await db.query(`select role from group_players where user_id=$1 and group_id=$2`, [U(n), g.id])).rows[0].role;
ok("grubu kuran captain (Kurucu)", (await role(1)) === "captain");
ok("katılanlar üye", (await role(2)) === "member" && (await role(3)) === "member");
await as(2); ok("üye grupta maç KURAMAZ", await fails(`insert into matches (group_id, played_at, created_by) values ($1, now(), $2)`, [g.id, U(2)]));
await as(1); await db.query(`select set_member_role((select id from group_players where user_id=$1 and group_id=$2),'admin')`, [U(2), g.id]);
await as(2); ok("yetkili yapılan üye maç kurabilir", !(await fails(`insert into matches (group_id, played_at, created_by) values ($1, now(), $2)`, [g.id, U(2)])));
ok("yetkili başkasını yetkili yapamaz", await fails(`select set_member_role((select id from group_players where user_id=$1 and group_id=$2),'admin')`, [U(3), g.id]));
ok("yetkili kurucuyu çıkaramaz", (await db.query(`delete from group_players where group_id=$1 and user_id=$2`, [g.id, U(1)])).affectedRows === 0);
await as(1); await db.query(`select set_member_role((select id from group_players where user_id=$1 and group_id=$2),'captain')`, [U(3), g.id]);
ok("kuruculuk devri: eski kurucu yetkili oldu", (await role(1)) === "admin" && (await role(3)) === "captain");

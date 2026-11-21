import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
const team = (await q(`insert into groups (name, created_by, kind, city) values ('Takım X','${U(1)}','team','İstanbul') returning id`))[0].id;
const grp = (await q(`insert into groups (name, created_by) values ('Grup X','${U(1)}') returning id`))[0].id;
const ins = (g, kind, opp) => db.query(`insert into matches (group_id, played_at, created_by, kind, opponent_name) values ($1, now() + interval '1 day', $2, $3, $4)`, [g, U(1), kind, opp]);

await ins(team, "external", "Rakip FK");
ok("takım rakibe karşı maç kurabilir", true);
ok("takım kendi aramızda maç kuramaz", await fails(`insert into matches (group_id, played_at, created_by, kind) values ($1, now() + interval '1 day', $2, 'internal')`, [team, U(1)]));
await ins(grp, "internal", null);
ok("grup kendi aramızda maç kurabilir", (await q(`select count(*)::int c from matches where group_id=$1`, [grp]))[0].c === 1);
ok("grup rakibe karşı maç kuramaz", await fails(`insert into matches (group_id, played_at, created_by, kind, opponent_name) values ($1, now() + interval '1 day', $2, 'external', 'Rakip')`, [grp, U(1)]));
await db.exec("reset role");
ok("mevcut maçlar (eski veri) güncellenebilir: kural sadece yeni kayıtlarda", (await db.query(`update matches set venue='Saha' where group_id=$1`, [team])).affectedRows === 1);

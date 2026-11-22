import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// u1 özel grup (community) kurar, u2 katılır; u3 yabancı; u4 herkese açık takımda
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Özel','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
await as(2); await db.query(`select join_group($1)`, [code]);
await as(4);
await q(`insert into groups (name, created_by, kind, city) values ('Açık Takım','${U(4)}','team','İstanbul') returning id`);

await db.exec("reset role");
await db.query(`insert into user_ratings (user_id, overall, raw, confidence, matches_played) values ($1, 92, 1, 1, 9), ($2, 70, 1, 1, 3), ($3, 66, 1, 1, 3), ($4, 80, 1, 1, 5)`, [U(1), U(2), U(3), U(4)]);
await db.query(`insert into user_skills (user_id, skills) values ($1, '{"HIZ":80}'), ($2, '{"HIZ":60}')`, [U(1), U(2)]);

await as(2);
ok("kendi kartımı görürüm", (await q(`select count(*)::int c from user_ratings where user_id=$1`, [U(2)]))[0].c === 1);
ok("aynı özel grubun üyesinin kartını görürüm", (await q(`select overall from user_ratings where user_id=$1`, [U(1)]))[0]?.overall === 92);
ok("aynı grubun üyesinin yeteneklerini görürüm", (await q(`select count(*)::int c from user_skills where user_id=$1`, [U(1)]))[0].c === 1);
ok("herkese açık takım üyesinin kartını görürüm", (await q(`select overall from user_ratings where user_id=$1`, [U(4)]))[0]?.overall === 80);
ok("hiçbir grubu ortak olmayan yabancının (özel grupta olmayan) kartı görünmez", (await q(`select count(*)::int c from user_ratings where user_id=$1`, [U(3)]))[0].c === 0);
ok("kart verisini istemciden yazamam", await fails(`update user_ratings set overall = 99 where user_id=$1`, [U(2)]) || (await q(`select overall from user_ratings where user_id=$1`, [U(2)]))[0].overall === 70);
ok("istemciden kart ekleyemem", await fails(`insert into user_ratings (user_id, overall, raw, confidence, matches_played) values ($1, 99, 1, 1, 1)`, [U(2)]));
await as(3);
ok("özel grubun kartı yabancıya görünmez", (await q(`select count(*)::int c from user_ratings where user_id=$1`, [U(1)]))[0].c === 0);
ok("my_rating kendi kartımı verir, yoksa 65", (await q(`select my_rating() r`))[0].r === 66);
await as(2);
ok("my_rating (u2) 70", (await q(`select my_rating() r`))[0].r === 70);

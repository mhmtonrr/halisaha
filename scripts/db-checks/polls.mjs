import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
await as(1); const g = (await db.query(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`)).rows[0];
const code = (await db.query(`select group_invite_code($1) c`, [g.id])).rows[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(2); ok("üye çağrı açamaz", await fails(`insert into match_polls (group_id, created_by, starts_at) values ($1,$2, now()+interval '2 day')`, [g.id, U(2)]));
await as(1); const p = (await db.query(`insert into match_polls (group_id, created_by, starts_at, venue, capacity) values ($1,$2, now()+interval '2 day','Petroller',2) returning id`, [g.id, U(1)])).rows[0];
for (const [n, a] of [[3, "yes"], [2, "yes"], [4, "yes"], [1, "maybe"]]) { await as(n); await db.query(`select respond_poll($1,$2)`, [p.id, a]); await new Promise((r) => setTimeout(r, 5)); }
await as(2); ok("üye kendini onaylayamaz (RPC)", await fails(`select set_poll_approval($1, my_player_id($2), true)`, [p.id, g.id]));
ok("üye doğrudan yazamaz", await fails(`update poll_responses set approved=true where poll_id=$1`, [p.id]) || (await db.query(`update poll_responses set approved=true where poll_id=$1`, [p.id])).affectedRows === 0);
await as(1); const n = (await db.query(`select approve_first_responders($1) n`, [p.id])).rows[0].n;
const approved = (await db.query(`select u.email from poll_responses r join group_players gp on gp.id=r.player_id join auth.users u on u.id=gp.user_id where poll_id=$1 and approved order by u.email`, [p.id])).rows.map((r) => r.email[1]);
ok(`kontenjan (2) kadar ilk gelen onaylandı: ${approved.join(",")} (beklenen 2,3)`, n === 2 && approved.join() === "2,3");
await as(3); await db.query(`select respond_poll($1,'no')`, [p.id]);
ok("vazgeçen oyuncunun onayı düştü", (await db.query(`select approved from poll_responses where poll_id=$1 and player_id=my_player_id($2)`, [p.id, g.id])).rows[0].approved === false);
await as(1); await db.query(`select set_poll_approval($1, (select player_id from poll_responses r join group_players gp on gp.id=r.player_id where gp.user_id=$2 and poll_id=$1), true)`, [p.id, U(4)]);
ok("yetkili tek tek onaylayabildi", (await db.query(`select count(*)::int c from poll_responses where poll_id=$1 and approved`, [p.id])).rows[0].c === 2);
ok("'belki' diyen onaylanamaz", await fails(`select set_poll_approval($1, my_player_id($2), true)`, [p.id, g.id]));
await db.query(`update match_polls set status='closed' where id=$1`, [p.id]);
await as(2); ok("kapalı çağrıya yanıt verilemez", await fails(`select respond_poll($1,'yes')`, [p.id]));
await as(5); ok("grup dışı çağrıyı göremez", (await db.query(`select count(*)::int c from match_polls`)).rows[0].c === 0);

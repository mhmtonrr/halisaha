// 0045: zamanlanmış işler — 3 saat kala yedekten kadro, saati geçen toplanan maç iptal, 2 gün skorsuz maç sonuçsuz.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

await as(1);
const T = (await one(`insert into groups (name, created_by, kind, city) values ('Kartallar','${U(1)}','team','Kırklareli') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [T])).c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
// Kapasite 2: u1 kadroda, u2 kadroda, u3 ve u4 yedek
const M = (await one(`select create_match_v2($1, current_date + 1, time '21:00', 5::smallint, 'external', 'Aslanlar', null, null, 2::smallint) id`, [T])).id;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select respond_match($1, 'yes')`, [M]); }
await as(1);
await db.query(`select confirm_match($1, (current_date + 1 + time '21:00') at time zone 'Europe/Istanbul')`, [M]);
ok("yetkili cron işini çağıramaz", await fails(`select * from cron_promote_reserves()`));

await db.exec("reset role");
const st = async (m) => (await one(`select status::text s from matches where id=$1`, [m])).s;
// u2 kadrodan çıkar (yer açılır); maç 3 saatten uzak → kimse alınmaz
await db.query(`delete from match_players where match_id=$1 and player_id=(select id from group_players where group_id=$2 and user_id=$3)`, [M, T, U(2)]);
ok("3 saatten uzak maçta yedek alınmaz", (await q(`select * from cron_promote_reserves()`)).length === 0);
await db.query(`update matches set played_at = now() + interval '2 hours' where id=$1`, [M]);
const pr = await q(`select * from cron_promote_reserves()`);
ok("3 saat kala ilk sıradaki yedek kadroya alınır (tek yer)", pr.length === 1 && pr[0].user_id === U(3));
ok("sayaç güncel: kadro 2, yedek 1", (await one(`select roster_count, reserve_count from matches where id=$1`, [M])).roster_count === 2);
ok("tekrar çalışınca kimse alınmaz (dolu)", (await q(`select * from cron_promote_reserves()`)).length === 0);

// Toplanan maç: saati geçince iptal; saat belli değilse gün bitince
await as(1);
const G1 = (await one(`select create_match_v2($1, current_date + 1, time '21:00', 5::smallint, 'external') id`, [T])).id;
const G2 = (await one(`select create_match_v2($1, current_date, null, 5::smallint, 'external') id`, [T])).id;
await db.exec("reset role");
await db.query(`update matches set played_at = now() - interval '1 minute' where id=$1`, [G1]);
const cc = await q(`select * from cron_cancel_stale()`);
ok("saati geçen toplanan maç iptal olur", cc.length === 1 && cc[0].match_id === G1 && (await st(G1)) === "cancelled");
ok("saati belli olmayan bugünkü maç gün bitmeden iptal olmaz", (await st(G2)) === "gathering");
await db.query(`update matches set played_at = now() - interval '2 days' where id=$1`, [G2]);
await db.query(`select * from cron_cancel_stale()`);
ok("günü geçince iptal olur", (await st(G2)) === "cancelled");
ok("kesin maç iptal edilmez", (await st(M)) === "planned");

// Sonuçsuz
await db.query(`update matches set played_at = now() - interval '1 day' where id=$1`, [M]);
ok("1 gün skorsuz maç dokunulmaz", (await q(`select * from cron_no_result()`)).length === 0);
await db.query(`update matches set played_at = now() - interval '49 hours' where id=$1`, [M]);
ok("2 gün skorsuz kesin maç sonuçsuz kapanır", (await q(`select * from cron_no_result()`)).length === 1 && (await st(M)) === "no_result");

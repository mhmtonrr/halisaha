import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const future = "now() + interval '3 day'";

// Takım A: u1 kaptan, u2 oyuncu, u3 oyuncu. Takım B: u4 kaptan. u5 yabancı.
await as(1);
const A = (await q(`insert into groups (name, created_by, kind, city) values ('Takım A','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeA = (await q(`select group_invite_code($1) c`, [A]))[0].c;
await as(4);
const B = (await q(`insert into groups (name, created_by, kind, city) values ('Takım B','${U(4)}','team','İstanbul') returning id`))[0].id;
for (const n of [2, 3]) { await as(n); await db.query(`select join_group($1)`, [codeA]); }
const gp = async (n, g) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), g]))[0].id;

// --- kişi sayısı
await as(1);
const d = (await q(`select create_challenge($1,$2,${future},null,null,null) id`, [A, B]))[0].id;
ok("eski 6 argümanlı çağrı çalışır, varsayılan 7 kişilik", (await q(`select team_size from match_challenges where id=$1`, [d]))[0].team_size === 7);
const c9 = (await q(`select create_challenge($1,$2,${future},null,null,null, 9::smallint) id`, [A, B]))[0].id;
ok("9 kişilik teklif saklandı", (await q(`select team_size from match_challenges where id=$1`, [c9]))[0].team_size === 9);
ok("4 kişilik reddedilir", await fails(`select create_challenge($1,$2,${future},null,null,null, 4::smallint)`, [A, B]));
ok("12 kişilik reddedilir", await fails(`select create_challenge($1,$2,${future},null,null,null, 12::smallint)`, [A, B]));
await as(4);
await db.query(`select respond_challenge($1,true)`, [c9]);
ok("kabulde iki maça da kişi sayısı yazıldı", (await q(`select count(*)::int c from matches where challenge_id=$1 and team_size=9`, [c9]))[0].c === 2);
ok("maça 12 kişilik yazılamaz", await fails(`update matches set team_size=12 where challenge_id=$1`, [c9]));

// --- diziliş: slot ve formasyon
await as(1);
const m = (await q(`insert into matches (group_id, played_at, created_by, kind, opponent_name, team_size) values ($1, ${future}, $2, 'external', 'Rakip', 7) returning id`, [A, U(1)]))[0].id;
const [p1, p2, p3] = [await gp(1, A), await gp(2, A), await gp(3, A)];
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'A'),($1,$4,'A')`, [m, p1, p2, p3]);
await db.query(`update matches set formation_a='2-3-1' where id=$1`, [m]);
await db.query(`update match_players set slot=0 where match_id=$1 and player_id=$2`, [m, p1]);
await db.query(`update match_players set slot=1 where match_id=$1 and player_id=$2`, [m, p2]);
ok("kaptan dizilişi ve slotları kaydeder", (await q(`select count(*)::int c from match_players where match_id=$1 and slot is not null`, [m]))[0].c === 2);
ok("aynı slota iki oyuncu dizilemez", await fails(`update match_players set slot=0 where match_id=$1 and player_id=$2`, [m, p3]));
ok("slot 11 geçersiz", await fails(`update match_players set slot=11 where match_id=$1 and player_id=$2`, [m, p3]));
await db.query(`update match_players set team='B' where match_id=$1 and player_id=$2`, [m, p1]);
ok("takım değişince slot düşer", (await q(`select slot from match_players where match_id=$1 and player_id=$2`, [m, p1]))[0].slot === null);
await db.query(`update match_players set slot=0 where match_id=$1 and player_id=$2`, [m, p1]); // p1 artık B takımında
await db.query(`update match_players set slot=0 where match_id=$1 and player_id=$2`, [m, p3]); // A takımında 0. slot boştu
ok("aynı slot numarası iki takımda ayrı kullanılabilir", (await q(`select count(*)::int c from match_players where match_id=$1 and slot=0`, [m]))[0].c === 2);
await as(2);
ok("normal oyuncu dizilişi değiştiremez", (await db.query(`update match_players set slot=5 where match_id=$1 and player_id=$2`, [m, p3])).affectedRows === 0
  && (await db.query(`update matches set formation_a='3-3' where id=$1`, [m])).affectedRows === 0);
await as(5);
ok("yabancı açık maçın dizilişini göremez (0058)", (await q(`select formation_a from matches where id=$1`, [m])).length === 0);
await db.exec(`reset role; update matches set status='closed', score_a=1, score_b=0 where id='${m}'`);
await as(5);
ok("yabancı oynanmış maçın dizilişini okur (takım herkese açık)", (await q(`select formation_a from matches where id=$1`, [m]))[0]?.formation_a === "2-3-1"
  && (await q(`select count(*)::int c from match_players where match_id=$1 and slot is not null`, [m]))[0].c === 3);
ok("yabancı dizilişi değiştiremez", (await db.query(`update match_players set slot=4 where match_id=$1`, [m])).affectedRows === 0);

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const future = "now() + interval '3 day'";

// A takımı: u1 (kaptan), u2. B takımı: u3 (kaptan), u4. u5 yabancı. u2 ayrıca bir toplulukta (C) da.
await as(1);
const A = (await q(`insert into groups (name, created_by, kind, city) values ('Takım A','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeA = (await q(`select group_invite_code($1) c`, [A]))[0].c;
await as(3);
const B = (await q(`insert into groups (name, created_by, kind, city) values ('Takım B','${U(3)}','team','İstanbul') returning id`))[0].id;
const codeB = (await q(`select group_invite_code($1) c`, [B]))[0].c;
await as(2); await db.query(`select join_group($1)`, [codeA]);
await as(4); await db.query(`select join_group($1)`, [codeB]);
const gp = async (n, g) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), g]))[0]?.id;

await as(1);
const ch = (await q(`select create_challenge($1,$2,${future},null,null,null) id`, [A, B]))[0].id;
await as(3); await db.query(`select respond_challenge($1,true)`, [ch]);
await db.exec("reset role");
const ms = await q(`select id, group_id from matches where challenge_id=$1`, [ch]);
const mA = ms.find((m) => m.group_id === A).id, mB = ms.find((m) => m.group_id === B).id;
const [a1, a2, b3, b4] = [await gp(1, A), await gp(2, A), await gp(3, B), await gp(4, B)];

// --- kadro koruması
await as(1);
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'A')`, [mA, a1, a2]);
await as(3);
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'A')`, [mB, b3, b4]);
// u2, B takımına da katılıp rakip kadroya eklenmeye çalışılırsa engellenir
await as(2); await db.query(`select join_group($1)`, [codeB]);
const b2 = await gp(2, B);
await as(3);
ok("aynı kişi iki rakip kadroda birden olamaz", await fails(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [mB, b2]));

// --- skor + oylama aç
await as(1); await db.query(`update matches set score_a=3, score_b=2, status='played' where id=$1`, [mA]);
await as(3); await db.query(`update matches set score_a=2, score_b=3, status='played' where id=$1`, [mB]);
ok("skorlar eşleşti", (await q(`select settle_linked_match($1) r`, [mB]))[0].r === "settled");

// --- çapraz oy
await as(1);
const vote = (m, v, t, s = 7) => db.query(`insert into votes (match_id, voter_id, target_id, score) values ($1,$2,$3,$4)`, [m, v, t, s]);
await vote(mA, a1, a2); ok("takım arkadaşına oy", true);
await vote(mA, a1, b3); await vote(mA, a1, b4); ok("rakip takım oyuncularına oy (kendi maçına yazılır)", true);
ok("oyuncu kendi adına olmayan oy veremez", await fails(`insert into votes (match_id, voter_id, target_id, score) values ($1,$2,$3,7)`, [mA, a2, a1]));
await as(4);
await vote(mB, b4, b3); await vote(mB, b4, a1); await vote(mB, b4, a2);
ok("B tarafı da A oyuncularına oy verir", (await q(`select count(*)::int c from votes where voter_id=$1`, [b4]))[0].c === 3);
await as(5); // yabancı
ok("yabancı oy veremez", await fails(`insert into votes (match_id, voter_id, target_id, score) values ($1,$2,$3,7)`, [mA, a1, b3]));
await as(1);
ok("kendi oylarını görür, başkasınınkini görmez", (await q(`select count(*)::int c from votes`))[0].c === 3);
// maçta olmayan birine oy: u5'in bir group_player'ı yok; B'de olup kadroda olmayan b2'ye oy
ok("kadroda olmayan oyuncuya oy verilemez", await fails(`insert into votes (match_id, voter_id, target_id, score) values ($1,$2,$3,7)`, [mA, a1, b2]));

// --- ilerleme iki maçı sayar
await as(1);
const prog = (await q(`select * from voting_progress($1)`, [mA]))[0];
ok(`ilerleme iki kadroyu birlikte sayar: ${prog.voters}/${prog.eligible} (beklenen 2/4)`, prog.voters === 2 && prog.eligible === 4);
await as(5);
ok("üye olmayan ilerlemeyi göremez", (await q(`select * from voting_progress($1)`, [mA])).length === 0);

// --- genel rating kopyalanır
await db.exec("reset role");
await db.query(`insert into player_ratings (player_id, overall, raw, confidence, matches_played) values ($1,81,1.3,0.9,12)`, [a1]);
await as(1);
const C = (await q(`insert into groups (name, created_by) values ('Grup C','${U(1)}') returning id`))[0].id;
await db.exec("reset role");
const cp = await q(`select pr.overall, pr.matches_played from group_players gp join player_ratings pr on pr.player_id=gp.id where gp.group_id=$1 and gp.user_id=$2`, [C, U(1)]);
ok("yeni gruba katılan oyuncuya mevcut genel rating kopyalandı (81, 12 maç)", cp.length === 1 && cp[0].overall === 81 && cp[0].matches_played === 12);
const g2 = await q(`select count(*)::int c from group_players where user_id=$1 and group_id=$2`, [U(3), C]);
await as(1); const cCode = (await q(`select group_invite_code($1) c`, [C]))[0].c;
await as(3); await db.query(`select join_group($1)`, [cCode]);
await db.exec("reset role");
ok("hiç rating'i olmayan oyuncuya kopyalanacak rating yok (65 varsayılanı uygulama tarafında)", (await q(`select count(*)::int c from group_players gp join player_ratings pr on pr.player_id=gp.id where gp.group_id=$1 and gp.user_id=$2`, [C, U(3)]))[0].c === 0 && g2[0].c === 0);

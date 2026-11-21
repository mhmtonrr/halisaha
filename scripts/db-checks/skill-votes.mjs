import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// Grup: u1 (kurucu), u2, u3, u4 üye; u5 yabancı. u4 kaleci.
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
const gp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), G]))[0].id;
const [p1, p2, p3, p4] = [await gp(1), await gp(2), await gp(3), await gp(4)];

await db.exec("reset role");
const M = (await q(`insert into matches (group_id, played_at, created_by, kind, status, voting_deadline) values ($1, now() - interval '1 hour', $2, 'internal', 'voting', now() + interval '1 day') returning id`, [G, U(1)]))[0].id;
await db.query(`insert into match_players (match_id, player_id, team, position) values ($1,$2,'A',null),($1,$3,'A',null),($1,$4,'B',null),($1,$5,'B','GK')`, [M, p1, p2, p3, p4]);

// --- gönderme
await as(1);
await db.query(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2, p3], ŞUT: [p3] })]);
ok("saha kategorisinde 2 kişi seçilebilir", (await q(`select count(*)::int c from skill_picks`))[0].c === 3);
ok("kendi pusulasını görür", (await q(`select count(*)::int c from skill_ballots`))[0].c === 1);
ok("kendine oy veremez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p1] })]));
ok("kategoride 2'den fazla kişi seçilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2, p3, p4] })]));
ok("aynı oyuncu iki kez seçilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ PAS: [p2, p2] })]));
ok("saha kategorisinde kaleci seçilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ DEF: [p4] })]));
ok("kaleci kategorisinde saha oyuncusu seçilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ REF: [p2] })]));
await db.query(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ REF: [p4] })]);
ok("kaleci kategorisinde kaleci seçilebilir", (await q(`select count(*)::int c from skill_picks where category='REF'`))[0].c === 1);
await db.exec("reset role");
await db.query(`update match_players set position=null, is_goalkeeper=true where match_id=$1 and player_id=$2`, [M, p4]);
await as(1);
await db.query(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ ATL: [p4] })]);
ok("kaleci işareti (is_goalkeeper) da kaleci sayılır", (await q(`select count(*)::int c from skill_picks where category='ATL'`))[0].c === 1);
ok("bilinmeyen kategori reddedilir", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ UÇMA: [p2] })]));
ok("tekrar göndermek eskisinin yerine geçer", (await q(`select count(*)::int c from skill_picks`))[0].c === 1 && (await q(`select count(*)::int c from skill_ballots`))[0].c === 1);

// --- gizlilik ve yetki
await as(2);
ok("başkasının pusulasını göremez", (await q(`select count(*)::int c from skill_ballots`))[0].c === 0 && (await q(`select count(*)::int c from skill_picks`))[0].c === 0);
ok("doğrudan pusula yazamaz", await fails(`insert into skill_ballots (match_id, voter_id) values ($1,$2)`, [M, p2]));
await as(1);
ok("pusula sahibi bile doğrudan işaret yazamaz", await fails(`insert into skill_picks (ballot_id, category, nominee_id) select id, 'HIZ', $1 from skill_ballots`, [p3]));
ok("pusula sahibi bile doğrudan pusulayı değiştiremez", (await db.query(`update skill_ballots set created_at = now() - interval '9 days'`)).affectedRows === 0);
await as(5);
ok("maçta oynamayan oy veremez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2] })]));
await db.exec("reset role");
const gp5 = (await q(`insert into group_players (group_id, display_name) values ($1,'Misafir') returning id`, [G]))[0].id;
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [M, gp5]);
await as(2);
await db.query(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [gp5] })]);
await db.exec("reset role");
ok("misafir oyuncu işaretlenebilir", (await q(`select count(*)::int c from skill_picks where nominee_id=$1`, [gp5]))[0].c === 1);
await as(1);

// --- zaman penceresi ve durum
await db.exec("reset role");
await db.query(`update matches set status='planned' where id=$1`, [M]);
await as(3);
ok("planlanmış maçta oy verilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2] })]));
await db.exec("reset role");
await db.query(`update matches set status='closed', played_at = now() - interval '8 days' where id=$1`, [M]);
await as(3);
ok("7 günden eski maçta oy verilemez", await fails(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2] })]));
await db.exec("reset role");
await db.query(`update matches set played_at = now() - interval '2 days' where id=$1`, [M]);
await as(3);
await db.query(`select submit_skill_ballot($1, $2::jsonb)`, [M, JSON.stringify({ HIZ: [p2] })]);
await db.exec("reset role");
ok("kapanmış yeni maçta oy verilebilir (son oy veren de katılabilsin)", (await q(`select count(*)::int c from skill_ballots where voter_id=$1`, [p3]))[0].c === 1);

// --- player_skills yazma ve okuma
await db.exec("reset role");
await db.query(`insert into player_skills (player_id, skills, voters, ballots) values ($1, '{"HIZ":72}', 2, 2)`, [p2]);
await as(5);
ok("üyesi olmadığı özel grubun yeteneklerini göremez", (await q(`select count(*)::int c from player_skills`))[0].c === 0);
await as(3);
ok("grup üyesi yetenekleri görür", (await q(`select count(*)::int c from player_skills`))[0].c === 1);
ok("üye yetenek yazamaz", await fails(`insert into player_skills (player_id, skills) values ($1, '{}')`, [p3]) || await fails(`update player_skills set skills='{"HIZ":99}'`));

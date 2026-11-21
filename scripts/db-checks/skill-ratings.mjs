import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const J = JSON.stringify;

// Grup: u1 (kurucu), u2, u3, u4 (kaleci); u5 yabancı. İki maç (oylamada) hepsi sahada + bir misafir.
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
const gp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), G]))[0].id;
const [p1, p2, p3, p4] = [await gp(1), await gp(2), await gp(3), await gp(4)];
await db.exec("reset role");
const guest = (await q(`insert into group_players (group_id, display_name) values ($1,'Misafir') returning id`, [G]))[0].id;
const mkMatch = async () => {
  const m = (await q(`insert into matches (group_id, played_at, created_by, kind, status, voting_deadline) values ($1, now() - interval '1 hour', $2, 'internal', 'voting', now() + interval '1 day') returning id`, [G, U(1)]))[0].id;
  await db.query(`insert into match_players (match_id, player_id, team, position) values ($1,$2,'A',null),($1,$3,'A',null),($1,$4,'B',null),($1,$5,'B','GK'),($1,$6,'B',null)`, [m, p1, p2, p3, p4, guest]);
  return m;
};
const m1 = await mkMatch();

await as(1);
ok("tek maçla kimse listelenmez", (await q(`select * from skill_queue(10)`)).length === 0);
ok("tek maçla değerlendirilemez", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p2, J({ HIZ: 7 })]));
await db.exec("reset role");
const m2 = await mkMatch();
await as(1);
const queue = await q(`select * from skill_queue(10)`);
ok("2 maçtan sonra 4 kişi listelenir (3 üye + misafir)", queue.length === 4);
ok("misafir 'is_guest' ve kaleci 'keeper' işaretli", queue.find((r) => r.target_player === guest)?.is_guest === true && queue.find((r) => r.target_player === p4)?.keeper === true);
ok("kendin listede yok", !queue.some((r) => r.target_player === p1));
ok("limit uygulanır", (await q(`select * from skill_queue(2)`)).length === 2);

// --- gönderme kuralları
await db.query(`select submit_skill_rating($1, $2::jsonb)`, [p2, J({ HIZ: 8, ŞUT: 6, PAS: null, DRİ: 7 })]);
ok("saha oyuncusu puanlanır, boş (bilmiyorum) saklanmaz", (await q(`select scores from skill_ratings`))[0].scores.HIZ === 8 && !("PAS" in (await q(`select scores from skill_ratings`))[0].scores));
ok("kendini değerlendiremez", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p1, J({ HIZ: 7 })]));
ok("saha oyuncusuna kaleci kategorisi verilemez", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p2, J({ REF: 7 })]));
await db.query(`select submit_skill_rating($1, $2::jsonb)`, [p4, J({ REF: 9, ATL: 7 })]);
ok("kaleci kaleci kategorileriyle puanlanır", (await q(`select scores from skill_ratings where target_user=$1`, [U(4)]))[0].scores.REF === 9);
ok("kaleciye saha kategorisi verilemez", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p4, J({ HIZ: 7 })]));
ok("11 reddedilir", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p3, J({ HIZ: 11 })]));
ok("0 reddedilir", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p3, J({ HIZ: 0 })]));
ok("ondalık reddedilir", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p3, J({ HIZ: 7.5 })]));
ok("hepsi boşsa reddedilir", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p3, J({ HIZ: null })]));
ok("bilinmeyen kategori reddedilir", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p3, J({ UÇMA: 7 })]));
await db.query(`select submit_skill_rating($1, $2::jsonb)`, [guest, J({ HIZ: 5 })]);
ok("misafir de puanlanır", (await q(`select count(*)::int c from skill_ratings where target_player=$1`, [guest]))[0].c === 1);

// --- tekrar gönderme yerine geçer, 30 gün kuralı
await db.query(`select submit_skill_rating($1, $2::jsonb)`, [p2, J({ HIZ: 3 })]);
ok("tekrar göndermek eskisinin yerine geçer", (await q(`select count(*)::int c, max((scores->>'HIZ')::int) h from skill_ratings where target_user=$1`, [U(2)]))[0].c === 1 && (await q(`select (scores->>'HIZ')::int h from skill_ratings where target_user=$1`, [U(2)]))[0].h === 3);
ok("değerlendirdiklerin 30 gün listeden çıkar", (await q(`select * from skill_queue(10)`)).length === 1);
await db.exec("reset role");
await db.query(`update skill_ratings set updated_at = now() - interval '31 days' where target_user=$1`, [U(2)]);
await as(1);
ok("30 günden eski değerlendirme tekrar önerilir", (await q(`select * from skill_queue(10)`)).some((r) => r.target_player === p2));

// --- gizlilik ve yetki
await as(2);
ok("başkasının değerlendirmesini göremez", (await q(`select count(*)::int c from skill_ratings`))[0].c === 0);
await as(1);
ok("kendi değerlendirmelerini görür", (await q(`select count(*)::int c from skill_ratings`))[0].c === 3);
ok("doğrudan yazamaz", await fails(`insert into skill_ratings (voter_id, target_user, scores) values ('${U(1)}','${U(3)}','{"HIZ":10}')`));
ok("doğrudan değiştiremez", (await db.query(`update skill_ratings set scores='{"HIZ":10}'`)).affectedRows === 0);
await as(5);
ok("birlikte oynamadığın biri değerlendirilemez", await fails(`select submit_skill_rating($1, $2::jsonb)`, [p2, J({ HIZ: 7 })]));
ok("yabancının sırası boş", (await q(`select * from skill_queue(10)`)).length === 0);
ok("shared_players doğrudan çağrılamaz", await fails(`select * from shared_players($1)`, [U(1)]));

// --- planlanmış maç sayılmaz
await db.exec("reset role");
await db.query(`update matches set status='planned' where id in ($1,$2)`, [m1, m2]);
await as(1);
ok("oylamaya/kapanışa ulaşmamış maçlar sayılmaz", (await q(`select * from skill_queue(10)`)).length === 0);

// --- rakip takım maçları: iki bağlı maç tek havuz; rakipler birbirini değerlendirebilir
await db.exec("reset role");
await as(6);
const A = (await q(`insert into groups (name, created_by, kind, city) values ('Takım A','${U(6)}','team','İstanbul') returning id`))[0].id;
await as(7);
const B = (await q(`insert into groups (name, created_by, kind, city) values ('Takım B','${U(7)}','team','İstanbul') returning id`))[0].id;

for (let i = 0; i < 2; i++) {
  await as(6);
  const ch = (await q(`select create_challenge($1,$2, now() + interval '3 day', null, null, null) id`, [A, B]))[0].id;
  await as(7); await db.query(`select respond_challenge($1,true)`, [ch]);
  await db.exec("reset role");
  const ms = await q(`select id, group_id from matches where challenge_id=$1`, [ch]);
  const gA = (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(6), A]))[0].id;
  const gB = (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(7), B]))[0].id;
  await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [ms.find((m) => m.group_id === A).id, gA]);
  await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [ms.find((m) => m.group_id === B).id, gB]);
  await db.query(`update matches set status='voting', score_a=1, score_b=1 where challenge_id=$1`, [ch]);

}
await as(6);
const rq = await q(`select * from skill_queue(10)`);
ok("rakip takım oyuncusu 2 bağlı maçtan sonra listelenir", rq.length === 1 && rq[0].matches === 2);
await db.query(`select submit_skill_rating($1, $2::jsonb)`, [rq[0].target_player, J({ HIZ: 8, FİZ: 6 })]);
ok("rakip oyuncu puanlanır", (await q(`select count(*)::int c from skill_ratings`))[0].c === 1);

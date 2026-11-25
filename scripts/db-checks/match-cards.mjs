// Sohbetten maç kartı (0031 → 0043/0047): kart = kişiye özel davet; sadece maç türü (eski çağrı kartı 0047'de kalktı).
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// U1 takımın kaptanı, U2 sıradan üye, U3/U4 dışarıdan
await as(1);
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Kart Takımı','${U(1)}','team','İstanbul') returning id`))[0].id;
await db.exec("reset role");
await db.exec(`insert into group_players (group_id, user_id, display_name, role) values ('${T}','${U(2)}','U2','member')`);
const m = (await q(`insert into matches (group_id, played_at, venue, created_by, kind, opponent_name) values ($1, now() + interval '3 day', 'Meydan Saha', $2, 'external', 'Rakip FK') returning id`, [T, U(1)]))[0].id;
await as(1);
const g = (await q(`select create_match_v2($1, current_date + 4, null, 5::smallint, 'external', null, 'Poll Saha', null, 6::smallint) id`, [T]))[0].id;

const id1 = (await q(`select share_match_card($1,'match',$2) id`, [U(3), g]))[0].id;
ok("kaptan toplanan maçın kartını gönderir", !!id1);
const msg = (await q(`select kind, body, card, match_id from dm_messages where id=$1`, [id1]))[0];
ok("kart özeti saklanır (grup adı, saha, kadro, saat belli değil)", msg.kind === "match" && msg.card.group_name === "Kart Takımı" && msg.card.venue === "Poll Saha" && msg.card.capacity === 6 && msg.card.time_tbd === true && msg.match_id === g);
ok("mesaj gövdesi özet metin taşır", msg.body.includes("Maç") && msg.body.includes("Kart Takımı"));
ok("kart alıcıyı davetli yapar", (await q(`select status from match_entries where match_id=$1 and user_id=$2`, [g, U(3)]))[0]?.status === "invited");
ok("planlı maç kartı gönderilir", !!(await q(`select share_match_card($1,'match',$2) id`, [U(3), m]))[0].id);
ok("aynı kart aynı kişiye tekrar gönderilemez", await fails(`select share_match_card($1,'match',$2)`, [U(3), g]));
ok("kendine gönderilemez", await fails(`select share_match_card($1,'match',$2)`, [U(1), g]));
ok("eski çağrı türü reddedilir", await fails(`select share_match_card($1,'poll',$2)`, [U(4), g]));
ok("doğrudan kart insert yapılamaz", await fails(`insert into dm_messages (thread_id, author_id, kind, body, card, match_id) select thread_id, author_id, 'match', 'x', '{}', $1 from dm_messages limit 1`, [m]));

await as(3);
const rows = await q(`select kind, card from dm_messages where kind='match' order by id`);
ok("alıcı kartları görür", rows.length === 2 && rows[0].card.type === "match");
ok("tanımayandan gelen kart istek olarak düşer", (await q(`select status from dm_threads`))[0].status === "pending");
ok("davetli üye olmadığı maçı görür", (await q(`select 1 from matches where id=$1`, [g])).length === 1);

await as(2);
ok("kadroda olmayan sıradan üye kart gönderemez", await fails(`select share_match_card($1,'match',$2)`, [U(4), g]));
await as(4);
ok("yabancı kart gönderemez", await fails(`select share_match_card($1,'match',$2)`, [U(3), m]));
ok("üçüncü kişi başkasının kartını göremez", (await q(`select * from dm_messages where kind='match'`)).length === 0);

// Bitmiş maç
await db.exec("reset role");
await db.exec(`update matches set status='played' where id='${m}'`);
await as(1);
ok("açık olmayan maç paylaşılamaz", await fails(`select share_match_card($1,'match',$2)`, [U(4), m]));

// Engel
await as(4);
await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
await as(1);
ok("engelleyene kart gönderilemez", await fails(`select share_match_card($1,'match',$2)`, [U(4), g]));

// Arkadaşa kart: istek beklemeden açık sohbet
await as(1);
await db.query(`select send_friend_request($1)`, [U(2)]);
await as(2);
await db.query(`select respond_friend_request($1,true)`, [U(1)]);
await as(1);
await db.query(`select share_match_card($1,'match',$2)`, [U(2), g]);
ok("arkadaşa kart açık sohbete düşer", (await q(`select status from dm_threads where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [U(1), U(2)]))[0].status === "accepted");

// --- Maç kartı paylaşılmış takım silinebilir (0039) ---
await db.exec(`reset role`);
const silOk = await db.query(`delete from groups where id=$1`, [T]).then(() => true, (e) => (console.log(e.message), false));
ok("maç kartı paylaşılmış takım silinebilir", silOk);
ok("kart sohbette kalır, bağlantısı boşalır", (await q(`select count(*)::int c from dm_messages where kind='match' and match_id is null`))[0].c > 0);

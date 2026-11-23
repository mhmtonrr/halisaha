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
// Adam arama (eski ilan) kartı: birleşik çağrıda purpose='fill'
const l = (await q(`insert into match_polls (group_id, created_by, purpose, play_on, starts_at, venue, capacity, positions, match_id) values ($1,$2,'fill', current_date + 3, now() + interval '3 day','Meydan Saha',2,'{GK}',$3) returning id`, [T, U(1), m]))[0].id;
const p = (await q(`insert into match_polls (group_id, created_by, play_on, venue, capacity) values ($1,$2, current_date + 4,'Poll Saha',10) returning id`, [T, U(1)]))[0].id;

await as(1);
const id1 = (await q(`select share_match_card($1,'poll',$2) id`, [U(3), l]))[0].id;
ok("kaptan adam arama kartı gönderir", !!id1);
const msg = (await q(`select kind, body, card, poll_id from dm_messages where id=$1`, [id1]))[0];
ok("kart özeti saklanır (grup adı, saha, ihtiyaç)", msg.kind === "match" && msg.card.group_name === "Kart Takımı" && msg.card.venue === "Meydan Saha" && msg.card.capacity === 2 && msg.card.purpose === "fill" && msg.poll_id === l);
ok("mesaj gövdesi özet metin taşır", msg.body.includes("Adam aranıyor") && msg.body.includes("Kart Takımı"));
const id2 = (await q(`select share_match_card($1,'poll',$2) id`, [U(3), p]))[0].id;
ok("saati belli olmayan çağrı kartı gönderilir", (await q(`select card from dm_messages where id=$1`, [id2]))[0].card.time_tbd === true);
ok("planlı maç kartı gönderilir", !!(await q(`select share_match_card($1,'match',$2) id`, [U(3), m]))[0].id);
ok("aynı kart aynı kişiye tekrar gönderilemez", await fails(`select share_match_card($1,'poll',$2)`, [U(3), l]));
ok("kendine gönderilemez", await fails(`select share_match_card($1,'poll',$2)`, [U(1), l]));
ok("geçersiz tür reddedilir", await fails(`select share_match_card($1,'xyz',$2)`, [U(4), l]));
ok("doğrudan kart insert yapılamaz", await fails(`insert into dm_messages (thread_id, author_id, kind, body, card, match_id) select thread_id, author_id, 'match', 'x', '{}', $1 from dm_messages limit 1`, [m]));

await as(3);
const rows = await q(`select kind, card from dm_messages where kind='match' order by id`);
ok("alıcı kartları görür", rows.length === 3 && rows[0].card.type === "poll");
ok("tanımayandan gelen kart istek olarak düşer", (await q(`select status from dm_threads`))[0].status === "pending");

await as(2);
ok("sıradan üye kart gönderemez", await fails(`select share_match_card($1,'poll',$2)`, [U(4), l]));
await as(4);
ok("yabancı kart gönderemez", await fails(`select share_match_card($1,'match',$2)`, [U(3), m]));
ok("üçüncü kişi başkasının kartını göremez", (await q(`select * from dm_messages where kind='match'`)).length === 0);

// Kapalı ilan / bitmiş maç
await db.exec("reset role");
await db.exec(`update match_polls set status='closed' where id='${l}'; update matches set status='played' where id='${m}'`);
await as(1);
ok("kapalı adam arama paylaşılamaz", await fails(`select share_match_card($1,'poll',$2)`, [U(4), l]));
ok("planlı olmayan maç paylaşılamaz", await fails(`select share_match_card($1,'match',$2)`, [U(4), m]));

// Engel
await as(4);
await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
await as(1);
ok("engelleyene kart gönderilemez", await fails(`select share_match_card($1,'poll',$2)`, [U(4), p]));

// Arkadaşa kart: istek beklemeden açık sohbet
await as(1);
await db.query(`select send_friend_request($1)`, [U(2)]);
await as(2);
await db.query(`select respond_friend_request($1,true)`, [U(1)]);
await db.query(`delete from group_players where user_id=$1`, [U(2)]).catch(() => {});
await as(1);
await db.query(`select share_match_card($1,'poll',$2)`, [U(2), p]);
ok("arkadaşa kart açık sohbete düşer", (await q(`select status from dm_threads where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [U(1), U(2)]))[0].status === "accepted");

// --- Maç kartı paylaşılmış takım silinebilir (0039) ---
await db.exec(`reset role`);
const silOk = await db.query(`delete from groups where id=$1`, [T]).then(() => true, (e) => (console.log(e.message), false));
ok("maç kartı paylaşılmış takım silinebilir", silOk);
ok("kart sohbette kalır, bağlantısı boşalır", (await q(`select count(*)::int c from dm_messages where kind='match' and poll_id is null and match_id is null`))[0].c > 0);

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const status = async (a, b) => (await q(`select status from friendships where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)`, [U(a), U(b)]))[0]?.status;

await as(1);
ok("istek gider (pending)", (await q(`select send_friend_request($1) s`, [U(2)]))[0].s === "pending" && (await status(1, 2)) === "pending");
ok("aynı isteği tekrar atmak zararsız", (await q(`select send_friend_request($1) s`, [U(2)]))[0].s === "pending" && (await q(`select count(*)::int c from friendships`))[0].c === 1);
ok("kendine istek atılamaz", await fails(`select send_friend_request($1)`, [U(1)]));
ok("doğrudan insert yapılamaz", await fails(`insert into friendships (user_a, user_b, requested_by) values ($1,$2,$1)`, [U(1), U(3)]));
ok("gönderen kendi isteğini kabul edemez", await fails(`select respond_friend_request($1, true)`, [U(2)]));
await as(3);
ok("üçüncü kişi isteği göremez", (await q(`select * from friendships`)).length === 0);
ok("üçüncü kişi kabul edemez", await fails(`select respond_friend_request($1, true)`, [U(1)]));
await as(2);
ok("alıcı isteği görür", (await q(`select * from friendships`)).length === 1);
await db.query(`select respond_friend_request($1, true)`, [U(1)]);
ok("kabul edince arkadaş olurlar", (await status(1, 2)) === "accepted" && (await q(`select are_friends($1,$2) f`, [U(1), U(2)]))[0].f === true);
ok("kabul edilmiş arkadaşlığa tekrar yanıt verilemez", await fails(`select respond_friend_request($1, true)`, [U(1)]));

// Arkadaşlar arasında mesaj isteği yok
const t = (await q(`select start_dm($1) id`, [U(1)]))[0].id;
ok("arkadaşla konuşma doğrudan açık", (await q(`select status from dm_threads where id=$1`, [t]))[0].status === "accepted");
await db.query(`select send_dm($1,'bir')`, [t]); await db.query(`select send_dm($1,'iki')`, [t]);
ok("arkadaşlar istek beklemeden yazışır", (await q(`select count(*)::int c from dm_messages where thread_id=$1`, [t]))[0].c === 2);

// Tanımadıkla bekleyen konuşma, arkadaşlık kabul edilince açılır
await as(3);
const t2 = (await q(`select start_dm($1) id`, [U(4)]))[0].id;
ok("tanımadıkla konuşma istek olarak açılır", (await q(`select status from dm_threads where id=$1`, [t2]))[0].status === "pending");
await db.query(`select send_friend_request($1)`, [U(4)]);
await as(4);
await db.query(`select respond_friend_request($1, true)`, [U(3)]);
ok("arkadaşlık kabulü bekleyen konuşmayı açar", (await q(`select status from dm_threads where id=$1`, [t2]))[0].status === "accepted");

// Karşılıklı istek kendiliğinden kabul
await as(1);
await db.query(`select send_friend_request($1)`, [U(3)]);
await as(3);
ok("karşılıklı istek kendiliğinden kabul olur", (await q(`select send_friend_request($1) s`, [U(1)]))[0].s === "accepted" && (await status(1, 3)) === "accepted");

// Reddetme ve geri çekme
await as(2);
await db.query(`select send_friend_request($1)`, [U(4)]);
await as(4);
await db.query(`select respond_friend_request($1, false)`, [U(2)]);
ok("reddedilen istek silinir", (await status(2, 4)) === undefined);
await as(2);
await db.query(`select send_friend_request($1)`, [U(4)]);
await db.query(`select remove_friendship($1)`, [U(4)]);
ok("gönderen bekleyen isteği geri çeker", (await status(2, 4)) === undefined);
await db.query(`select remove_friendship($1)`, [U(1)]);
ok("arkadaşlıktan çıkılır", (await status(1, 2)) === undefined);
ok("arkadaşlıktan çıkınca konuşma ve mesajlar durur", (await q(`select count(*)::int c from dm_messages where thread_id=$1`, [t]))[0].c === 2);

// Engel
await as(1);
await db.query(`select send_friend_request($1)`, [U(2)]);
await as(2);
await db.query(`select respond_friend_request($1, true)`, [U(1)]);
await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
ok("engel arkadaşlığı bitirir", (await status(1, 2)) === undefined);
ok("engelleyen engelliye istek atamaz", await fails(`select send_friend_request($1)`, [U(1)]));
await as(1);
ok("engellenen de istek atamaz", await fails(`select send_friend_request($1)`, [U(2)]));

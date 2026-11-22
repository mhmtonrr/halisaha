import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
const G = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// U1 = takımın kaptanı, U3 = sıradan üye, U2/U4 = dışarıdan
await db.exec(`insert into groups (id, name, kind, created_by, city) values ('${G(1)}','Takım','team','${U(1)}','İstanbul'),('${G(2)}','Özel','community','${U(1)}','İstanbul')`);
await db.exec(`update group_players set role='member' where user_id='${U(3)}'`);
await db.exec(`insert into group_players (group_id, user_id, display_name, role) values ('${G(1)}','${U(3)}','U3','member') on conflict do nothing`);

// --- Birebir sohbet ---
await as(1);
const t = (await q(`select start_dm($1) id`, [U(2)]))[0].id;
ok("herkes herkesle konuşma açabilir (istek)", (await q(`select status, requested_by from dm_threads where id=$1`, [t]))[0].status === "pending");
ok("aynı kişiyle ikinci konuşma açılmaz", (await q(`select start_dm($1) id`, [U(2)]))[0].id === t);
ok("karşıdan açınca da aynı konuşma", (await (async () => { await as(2); return (await q(`select start_dm($1) id`, [U(1)]))[0].id === t; })()));
await as(1);
await db.query(`select send_dm($1, 'Selam')`, [t]);
ok("istek: ilk mesaj gider", (await q(`select count(*)::int c from dm_messages where thread_id=$1`, [t]))[0].c === 1);
ok("istek kabul edilmeden ikinci mesaj atılamaz", await fails(`select send_dm($1, 'Cevap ver')`, [t]));
ok("mesaja doğrudan insert yapılamaz", await fails(`insert into dm_messages (thread_id, author_id, body) values ($1, $2, 'x')`, [t, U(1)]));
ok("başkası adına mesaj atılamaz", await fails(`select send_dm($1, 'x')`, [t]) === true);
await as(3);
ok("üçüncü kişi konuşmayı göremez", (await q(`select * from dm_threads`)).length === 0 && (await q(`select * from dm_messages`)).length === 0);
ok("üçüncü kişi mesaj atamaz", await fails(`select send_dm($1, 'x')`, [t]));
await as(2);
ok("alıcı isteği ve mesajı görür", (await q(`select * from dm_messages where thread_id=$1`, [t])).length === 1);
ok("alıcının okunmamışı 1", (await q(`select unread from dm_unread_counts()`))[0].unread === 1);
await db.query(`select mark_dm_read($1)`, [t]);
ok("okundu işaretleyince sayaç sıfırlanır", (await q(`select * from dm_unread_counts()`)).length === 0);
ok("gönderen isteği kabul edemez", await (async () => { await as(1); return fails(`select respond_dm_request($1, true)`, [t]); })());
await as(2);
await db.query(`select send_dm($1, 'Merhaba')`, [t]);
ok("alıcı yazınca konuşma kabul edilir", (await q(`select status from dm_threads where id=$1`, [t]))[0].status === "accepted");
await as(1);
await db.query(`select send_dm($1, 'Maça gelir misin?')`, [t]);
ok("kabulden sonra serbest yazışma", (await q(`select count(*)::int c from dm_messages where thread_id=$1`, [t]))[0].c === 3);
ok("son mesaj konuşmaya yazılır", (await q(`select last_body b from dm_threads where id=$1`, [t]))[0].b === "Maça gelir misin?");
const mid = (await q(`select id from dm_messages where thread_id=$1 order by id desc limit 1`, [t]))[0].id;
await as(2);
ok("başkasının mesajını silemez", await fails(`select delete_dm_message($1)`, [mid]));
await as(1);
await db.query(`select delete_dm_message($1)`, [mid]);
ok("yazar kendi mesajını siler", (await q(`select deleted_at d from dm_messages where id=$1`, [mid]))[0].d !== null);

// Reddedilen istek
await as(4);
const t2 = (await q(`select start_dm($1) id`, [U(1)]))[0].id;
await db.query(`select send_dm($1, 'Selam')`, [t2]);
await as(1);
await db.query(`select respond_dm_request($1, false)`, [t2]);
ok("reddedilen istek okunmamışta görünmez", (await q(`select * from dm_unread_counts() where thread_id=$1`, [t2])).length === 0);
await as(4);
ok("reddedilen istekte gönderen yazamaz", await fails(`select send_dm($1, 'tekrar')`, [t2]));

// Engel
await as(2);
await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
await as(1);
ok("engelleyene mesaj atılamaz", await fails(`select send_dm($1, 'x')`, [t]));
ok("engelleyene yeni konuşma açılamaz", await fails(`select start_dm($1)`, [U(2)]));
await as(2);
ok("engelleyen de engellediğine yazamaz", await fails(`select send_dm($1, 'x')`, [t]));
await db.query(`delete from user_blocks`);

// --- Takıma/gruba davet ---
await as(3);
ok("sıradan üye davet gönderemez", await fails(`select invite_to_group($1, $2)`, [G(1), U(2)]));
await as(2);
ok("üye olmayan davet gönderemez", await fails(`select invite_to_group($1, $2)`, [G(1), U(4)]));
await as(1);
ok("kaptan kendini davet edemez", await fails(`select invite_to_group($1, $2)`, [G(1), U(1)]));
ok("zaten üyeyi davet edemez", await fails(`select invite_to_group($1, $2)`, [G(1), U(3)]));
const inv = (await q(`select invite_to_group($1, $2) id`, [G(1), U(4)]))[0].id;
ok("kaptan davet gönderir", !!inv);
ok("aynı kişiye ikinci bekleyen davet olmaz", await fails(`select invite_to_group($1, $2)`, [G(1), U(4)]));
const inv2 = (await q(`select invite_to_group($1, $2) id`, [G(2), U(4)]))[0].id;
ok("başka gruba ayrı davet gider", !!inv2);
ok("davet kartı konuşmaya düşer", (await q(`select count(*)::int c from dm_messages where kind='invite' and invite_id in ($1,$2)`, [inv, inv2]))[0].c === 2);
await as(4);
const invs = await q(`select group_name, group_kind, status from group_invites order by group_name`);
ok("davet edilen daveti ve grup adını görür", invs.length === 2 && invs[0].group_name === "Takım");
ok("davet kartı mesajlarda görünür", (await q(`select * from dm_messages where kind='invite'`)).length === 2);
ok("davetli başkasının davetini kabul edemez", await (async () => { await as(2); return fails(`select respond_group_invite($1, true)`, [inv]); })());
await as(4);
await db.query(`select respond_group_invite($1, true)`, [inv]);
ok("kabul edince üye olur", (await q(`select count(*)::int c from group_players where group_id=$1 and user_id=$2`, [G(1), U(4)]))[0].c === 1);
ok("kabul edilen davet tekrar yanıtlanamaz", await fails(`select respond_group_invite($1, true)`, [inv]));
await db.query(`select respond_group_invite($1, false)`, [inv2]);
ok("reddedilen davetle üye olunmaz", (await q(`select count(*)::int c from group_players where group_id=$1 and user_id=$2`, [G(2), U(4)]))[0].c === 0);
await db.query(`update group_invites set status='accepted' where id=$1`, [inv2]);
ok("davete doğrudan update etki etmez", (await q(`select status from group_invites where id=$1`, [inv2]))[0].status === "declined");

// Geri çekme ve engel
await as(1);
await db.query(`select cancel_group_invite((select invite_to_group($1, $2)))`, [G(2), U(2)]);
ok("kaptan daveti geri çeker", (await q(`select status from group_invites where invitee_id=$1 and group_id=$2 order by created_at desc limit 1`, [U(2), G(2)]))[0].status === "cancelled");
await as(2);
await db.query(`insert into user_blocks (blocked_user_id) values ($1)`, [U(1)]);
await as(1);
ok("engelleyen kişiye davet gönderilemez", await fails(`select invite_to_group($1, $2)`, [G(1), U(2)]));
await as(3);
ok("ilgisiz üye başkasının davetlerini göremez", (await q(`select * from group_invites`)).length === 0);

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// Grup: u1 kurucu, u2 yetkili, u3/u4 üye, u5 yabancı
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where user_id=$1 and group_id=$2), 'admin')`, [U(2), G]);
const gp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), G]))[0].id;
const [p1, p2, p3, p4] = [await gp(1), await gp(2), await gp(3), await gp(4)];
await db.exec("reset role");
const mk = async (hours, status = "planned") => (await q(`insert into matches (group_id, played_at, created_by, kind, status) values ($1, now() + interval '${hours} hours', $2, 'internal', '${status}') returning id`, [G, U(1)]))[0].id;
const fut = await mk(48), soon = await mk(2), past = await mk(-1);
const roster = async (m) => db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'A'),($1,$4,'B'),($1,$5,'B')`, [m, p1, p2, p3, p4]);
for (const m of [fut, soon, past]) await roster(m);
const inRoster = async (m, p) => (await q(`select count(*)::int c from match_players where match_id=$1 and player_id=$2`, [m, p]))[0].c === 1;

// --- istek
await as(3);
ok("üye çekilme isteği gönderir (bekliyor)", (await q(`select request_withdrawal($1, 'Dizim ağrıyor') r`, [fut]))[0].r === "pending");
ok("istek onaylanana kadar oyuncu kadroda kalır", await inRoster(fut, p3));
ok("aynı maça ikinci bekleyen istek reddedilir", await fails(`select request_withdrawal($1, 'Mazeret')`, [fut]));
ok("çok erken istek 'son dakika' değil", (await q(`select late from match_withdrawals where player_id=$1 and match_id=$2`, [p3, fut]))[0].late === false);
ok("sebep kaydedilir", (await q(`select reason from match_withdrawals where match_id=$1`, [fut]))[0].reason === "Dizim ağrıyor");
await db.query(`select request_withdrawal($1, 'Mazeret')`, [soon]);
ok("3 saatten az kalınca 'son dakika' işaretlenir", (await q(`select late from match_withdrawals where match_id=$1 and player_id=$2`, [soon, p3]))[0].late === true);
ok("201 karakterlik sebep reddedilir", await fails(`select request_withdrawal($1, $2)`, [past, "x".repeat(201)]));
ok("maç saati geçmişse istek gönderilemez", await fails(`select request_withdrawal($1, 'Mazeret')`, [past]));
await as(5);
ok("kadroda olmayan istek gönderemez", await fails(`select request_withdrawal($1, 'Mazeret')`, [fut]));

// --- görünürlük
ok("yabancı istekleri göremez", (await q(`select count(*)::int c from match_withdrawals`))[0].c === 0);
await as(4);
ok("başka üye de göremez", (await q(`select count(*)::int c from match_withdrawals`))[0].c === 0);
await as(3);
ok("sahibi kendi isteklerini görür", (await q(`select count(*)::int c from match_withdrawals`))[0].c === 2);
await as(2);
ok("yetkili istekleri görür", (await q(`select count(*)::int c from match_withdrawals`))[0].c === 2);
ok("doğrudan yazılamaz", await fails(`insert into match_withdrawals (match_id, player_id) values ($1,$2)`, [fut, p4]));
ok("doğrudan güncellenemez", (await db.query(`update match_withdrawals set status='approved'`)).affectedRows === 0);

// --- karar
const reqFut = (await q(`select id from match_withdrawals where match_id=$1`, [fut]))[0].id;
const reqSoon = (await q(`select id from match_withdrawals where match_id=$1`, [soon]))[0].id;
await as(4);
ok("sıradan üye karar veremez", await fails(`select decide_withdrawal($1, true)`, [reqFut]));
await as(3);
ok("istek sahibi kendi isteğine karar veremez", await fails(`select decide_withdrawal($1, true)`, [reqFut]));
await as(2);
await db.query(`select decide_withdrawal($1, true)`, [reqFut]);
ok("onaylanınca oyuncu kadrodan çıkar", !(await inRoster(fut, p3)));
ok("onaylı çekilme 'gelmedi' kaydı oluşturmaz", (await q(`select count(*)::int c from match_no_shows where user_id=$1`, [U(3)]))[0].c === 0);
ok("kayıt 'approved' ve karar veren yazılı", (await q(`select status, decided_by from match_withdrawals where id=$1`, [reqFut]))[0].status === "approved");
ok("sonuçlanmış isteğe tekrar karar verilemez", await fails(`select decide_withdrawal($1, false)`, [reqFut]));
await db.query(`select decide_withdrawal($1, false)`, [reqSoon]);
ok("reddedilince oyuncu kadroda kalır", await inRoster(soon, p3));
ok("reddedilmiş istek 'denied'", (await q(`select status from match_withdrawals where id=$1`, [reqSoon]))[0].status === "denied");
await as(3);
ok("reddedildikten sonra yeniden istek gönderilebilir", (await q(`select request_withdrawal($1, 'Tekrar') r`, [soon]))[0].r === "pending");

// --- geri çekme
const again = (await q(`select id from match_withdrawals where match_id=$1 and status='pending'`, [soon]))[0].id;
await as(4);
ok("başkası isteği geri çekemez", await fails(`select cancel_withdrawal($1)`, [again]));
await as(3);
await db.query(`select cancel_withdrawal($1)`, [again]);
ok("sahibi isteği geri çeker", (await q(`select status from match_withdrawals where id=$1`, [again]))[0].status === "cancelled");
ok("geri çekilmiş istek tekrar geri çekilemez", await fails(`select cancel_withdrawal($1)`, [again]));

// --- kaptan/yetkili doğrudan çıkar
await as(2);
ok("yetkili kendini doğrudan çıkarır (onaylı kayıt)", (await q(`select request_withdrawal($1, 'İşim çıktı') r`, [fut]))[0].r === "approved" && !(await inRoster(fut, p2)));
await as(1);
ok("kaptan da doğrudan çıkar", (await q(`select request_withdrawal($1, 'Mazeret') r`, [fut]))[0].r === "approved" && !(await inRoster(fut, p1)));

// --- başka yolla kadrodan çıkma / maç başlaması bekleyeni kapatır
await as(4);
await db.query(`select request_withdrawal($1, 'Mazeret')`, [fut]);
await as(1);
await db.query(`delete from match_players where match_id=$1 and player_id=$2`, [fut, p4]);
ok("kaptan oyuncuyu çıkarırsa bekleyen istek 'closed' olur", (await q(`select status from match_withdrawals where match_id=$1 and player_id=$2`, [fut, p4]))[0].status === "closed");
await as(4);
await db.query(`select request_withdrawal($1, 'Mazeret')`, [soon]);
await db.exec("reset role");
await db.query(`update matches set status='played' where id=$1`, [soon]);
ok("maç planlanmış olmaktan çıkınca bekleyen istek 'closed' olur", (await q(`select status from match_withdrawals where match_id=$1 and player_id=$2`, [soon, p4]))[0].status === "closed");
await as(4);
ok("planlanmamış maça istek gönderilemez", await fails(`select request_withdrawal($1, 'Mazeret')`, [soon]));
// --- yetkisiz karar
await as(5);
ok("yabancı karar veremez", await fails(`select decide_withdrawal($1, true)`, [reqFut]));

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const at = (h) => `now() + interval '${h} hours'`;
const mk = (g, hours, size = 7, deadline = "null") => q(`select create_member_poll($1, ${at(hours)}, 'Saha', ${size}::smallint, ${deadline}, 'Not') id`, [g]);

// Grup G: u1 kurucu, u2 ve u3 üye. Takım T: u1 kaptan, u2 oyuncu. u4 yabancı.
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup G','${U(1)}') returning id`))[0].id;
const codeG = (await q(`select group_invite_code($1) c`, [G]))[0].c;
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Takım T','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeT = (await q(`select group_invite_code($1) c`, [T]))[0].c;
for (const n of [2, 3]) { await as(n); await db.query(`select join_group($1)`, [codeG]); }
await as(2); await db.query(`select join_group($1)`, [codeT]);

// --- üye çağrısı
await as(2);
ok("üye doğrudan çağrı tablosuna yazamaz (RLS)", await fails(`insert into match_polls (group_id, created_by, starts_at) values ($1,$2, ${at(48)})`, [G, U(2)]));
const p1 = (await mk(G, 48))[0].id;
const row = (await q(`select auto_match, team_size, capacity, status, deadline, starts_at from match_polls where id=$1`, [p1]))[0];
ok("üye çağrı açtı: otomatik, 7v7 → kontenjan 14", row.auto_match && row.team_size === 7 && row.capacity === 14 && row.status === "open");
ok("son yanıt süresi varsayılan: maçtan 3 saat önce", Math.abs(new Date(row.starts_at) - new Date(row.deadline) - 3 * 3600e3) < 1000);
ok("çağrıyı açan otomatik 'geliyorum'", (await q(`select count(*)::int c from poll_responses where poll_id=$1 and answer='yes'`, [p1]))[0].c === 1);
ok("üye ikinci açık çağrı açamaz", await fails(`select create_member_poll($1, ${at(72)}, null, 7::smallint, null, null)`, [G]));

await as(3);
ok("3 saatten yakın maç reddedilir", await fails(`select create_member_poll($1, ${at(2)}, null, 7::smallint, null, null)`, [G]));
ok("14 günden uzak maç reddedilir", await fails(`select create_member_poll($1, ${at(24 * 15)}, null, 7::smallint, null, null)`, [G]));
ok("kişi sayısı 4 reddedilir", await fails(`select create_member_poll($1, ${at(48)}, null, 4::smallint, null, null)`, [G]));
ok("12 reddedilir", await fails(`select create_member_poll($1, ${at(48)}, null, 12::smallint, null, null)`, [G]));
ok("son yanıt maçtan <1 saat önce reddedilir", await fails(`select create_member_poll($1, ${at(48)}, null, 7::smallint, ${at(47.5)}, null)`, [G]));
ok("son yanıt geçmişte reddedilir", await fails(`select create_member_poll($1, ${at(48)}, null, 7::smallint, now() - interval '1 hour', null)`, [G]));
const okDeadline = await mk(G, 48, 7, at(30));
ok("özel son yanıt süresi kabul edilir", okDeadline.length === 1);
await as(4);
ok("grup üyesi olmayan çağrı açamaz", await fails(`select create_member_poll($1, ${at(48)}, null, 7::smallint, null, null)`, [G]));
await as(2);
ok("takımda üye çağrı açamaz", await fails(`select create_member_poll($1, ${at(48)}, null, 7::smallint, null, null)`, [T]));
await as(1);
const adminPolls = await mk(G, 48);
const adminPoll2 = await mk(G, 72);
ok("yetkili sınırsız açık çağrı açabilir", adminPolls.length === 1 && adminPoll2.length === 1);
ok("yetkili eski usul (elle onaylı) çağrı açmaya devam eder", (await db.query(`insert into match_polls (group_id, created_by, starts_at, capacity) values ($1,$2, ${at(48)}, 10)`, [G, U(1)])).affectedRows === 1);
ok("eski usul çağrı otomatik değil", (await q(`select count(*)::int c from match_polls where group_id=$1 and not auto_match`, [G]))[0].c === 1);

// --- iptal
await as(3);
ok("başkasının çağrısını üye iptal edemez", await fails(`select close_poll($1)`, [p1]));
await as(2);
await db.query(`select close_poll($1)`, [p1]);
ok("açan kişi çağrıyı iptal edebilir", (await q(`select status from match_polls where id=$1`, [p1]))[0].status === "closed");
ok("kapalı çağrı tekrar kapatılamaz", await fails(`select close_poll($1)`, [p1]));
ok("iptalden sonra yeni çağrı açabilir", (await mk(G, 96)).length === 1);
await as(1);
const target = (await q(`select id from match_polls where group_id=$1 and created_by=$2 and status='open' and auto_match`, [G, U(2)]))[0].id;
await db.query(`select close_poll($1)`, [target]);
ok("yetkili üyenin çağrısını iptal edebilir", (await q(`select status from match_polls where id=$1`, [target]))[0].status === "closed");
await db.exec("reset role");
await db.query(`update match_polls set status='converted' where id=$1`, [adminPolls[0].id]);
await as(1);
ok("maça dönüşmüş çağrı iptal edilemez", await fails(`select close_poll($1)`, [adminPolls[0].id]));

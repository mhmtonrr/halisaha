// 0034: organizatör rolü. Maç/çağrı sadece kurucu, yetkili, organizatör açar; herkes kendi maçını yönetir;
// organizatör üye yönetemez ve başkasının maçına dokunamaz.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// Grup: u1 kurucu, u2 yetkili, u3 organizatör, u4 üye, u5 yabancı
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
const gp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), G]))[0].id;
await as(1);
const [p1, p2, p3, p4] = [await gp(1), await gp(2), await gp(3), await gp(4)];
await db.query(`select set_member_role($1, 'admin')`, [p2]);
await db.query(`select set_member_role($1, 'organizer')`, [p3]);
ok("kurucu organizatör rolü verir", (await q(`select role from group_players where id=$1`, [p3]))[0].role === "organizer");
await as(2);
ok("yetkili rol veremez", await fails(`select set_member_role($1, 'organizer')`, [p4]));
await as(3);
ok("organizatör rol veremez", await fails(`select set_member_role($1, 'organizer')`, [p4]));

// --- maç açma yetkisi
const can = async (n) => { await as(n); return (await q(`select can_create_match($1) c`, [G]))[0].c; };
ok("kurucu, yetkili, organizatör maç açabilir; üye ve yabancı açamaz",
  (await can(1)) && (await can(2)) && (await can(3)) && !(await can(4)) && !(await can(5)));
const insMatch = (n) => `insert into matches (group_id, played_at, created_by, kind) values ('${G}', now() + interval '48 hours', '${U(n)}', 'internal') returning id`;
await as(4);
ok("üye maç kuramaz (RLS)", await fails(insMatch(4)));
ok("üye maç ayarlayamaz", await fails(`select create_match_v2($1, current_date + 2, null, 5::smallint, 'internal') id`, [G]));
await as(3);
const M3 = (await q(insMatch(3)))[0].id;
ok("organizatör maç kurar", !!M3);
const P3 = (await q(`select create_match_v2($1, current_date + 2, null, 5::smallint, 'internal', null, null, null, 10::smallint, false) id`, [G]))[0].id;
ok("organizatör maç ayarlar (toplanan)", !!P3);
await as(1);
const M1 = (await q(insMatch(1)))[0].id;
const P1 = (await q(`select create_match_v2($1, current_date + 2, null, 5::smallint, 'internal', null, null, null, 10::smallint, false) id`, [G]))[0].id;

// --- kendi maçını yönetme, başkasınınkine dokunamama
await as(3);
ok("organizatör kendi maçının kadrosunu düzenler", (await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'B'),($1,$4,'A')`, [M3, p3, p4, p1])).affectedRows === 3);
ok("organizatör başkasının maçının kadrosuna dokunamaz", await fails(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [M1, p3]));
ok("organizatör başkasının maçını güncelleyemez", (await db.query(`update matches set venue='X' where id=$1`, [M1])).affectedRows === 0);
ok("organizatör kendi maçına da misafir ekleyemez (0042: sadece kaptan/yetkili)", await fails(`select add_match_guest($1, 'Misafir Ali', 'MID')`, [M3]));
await as(2);
const g1 = (await q(`select add_match_guest($1, 'Misafir Ali', 'MID') id`, [M3]))[0].id;
await as(3);
ok("yetkili misafir ekler (gruba + kadroya)", (await q(`select count(*)::int c from match_players where match_id=$1 and player_id=$2`, [M3, g1]))[0].c === 1);
ok("misafir dengeye göre B'ye yazılır (A:2, B:1)", (await q(`select team from match_players where match_id=$1 and player_id=$2`, [M3, g1]))[0].team === "B");
ok("organizatör başkasının maçına misafir ekleyemez", await fails(`select add_match_guest($1, 'Misafir Veli', null)`, [M1]));
ok("tek harfli misafir adı reddedilir", await fails(`select add_match_guest($1, 'A', null)`, [M3]));
ok("geçersiz mevki reddedilir", await fails(`select add_match_guest($1, 'Misafir Can', 'XX')`, [M3]));
await as(4);
ok("üye misafir ekleyemez", await fails(`select add_match_guest($1, 'Misafir Can', null)`, [M3]));
await as(2);
ok("yetkili başkasının maçına misafir ekler", !!(await q(`select add_match_guest($1, 'Misafir Can', 'GK') id`, [M3]))[0].id);
await db.exec("reset role");
await db.query(`update matches set status='voting', score_a=1, score_b=0, voting_deadline=now() + interval '1 day' where id=$1`, [M1]);
await as(1);
ok("planlanmamış maça misafir eklenmez", await fails(`select add_match_guest($1, 'Misafir Can', null)`, [M1]));

// --- toplanan maç yönetimi
await as(3);
ok("organizatör başkasının maçını erteleyemez", await fails(`select reschedule_match($1, current_date + 3, null)`, [P1]));
ok("organizatör başkasının maçına kesin gelen ekleyemez", await fails(`select manage_entry($1, $2, 'add')`, [P1, U(4)]));
ok("organizatör kendi maçını erteler", !(await fails(`select reschedule_match($1, current_date + 3, null)`, [P3])));
ok("organizatör kendi maçına kesin gelen ekler", !(await fails(`select manage_entry($1, $2, 'add')`, [P3, U(4)])));
await as(2);
ok("yetkili organizatörün maçını yönetir", !(await fails(`select reschedule_match($1, current_date + 4, null)`, [P3])));

// --- çekilme kararı: maçı kuran organizatör verir
await as(4);
ok("üye organizatörün maçından çekilme ister", (await q(`select request_withdrawal($1, null) r`, [M3]))[0].r === "pending");
const W = (await q(`select id from match_withdrawals where match_id=$1`, [M3]))[0].id;
await as(3);
ok("organizatör kendi maçındaki isteği görür", (await q(`select count(*)::int c from match_withdrawals where id=$1`, [W]))[0].c === 1);
await db.query(`select decide_withdrawal($1, true)`, [W]);
ok("organizatör çekilmeyi onaylar, oyuncu kadrodan çıkar", (await q(`select count(*)::int c from match_players where match_id=$1 and player_id=$2`, [M3, p4]))[0].c === 0);

// --- organizatör üye yönetemez
await as(3);
ok("organizatör üye çıkaramaz", await fails(`select remove_member($1)`, [p4]));
ok("organizatör mevki değiştiremez", await fails(`select set_player_position($1, 'GK')`, [p4]));
ok("organizatör davet kodunu yenileyemez", await fails(`select regenerate_invite($1)`, [G]));

// --- rol geri alınınca açık çağrısının yönetimi kalkar, maç yönetimi (sahibi olarak) kalır
await as(1);
await db.query(`select set_member_role($1, 'member')`, [p3]);
await as(3);
ok("rolü alınan organizatör yeni maç kuramaz", await fails(insMatch(3)));
ok("rolü alınan organizatör yeni maç ayarlayamaz", await fails(`select create_match_v2($1, current_date + 2, null, 5::smallint, 'internal') id`, [G]));

// --- kart paylaşımı: organizatör kendi maçını paylaşır, başkasınınkini paylaşamaz
await as(1);
await db.query(`select set_member_role($1, 'organizer')`, [p3]);
const M3b = (await (async () => { await as(3); return q(insMatch(3)); })())[0].id;
ok("organizatör kendi maçının kartını gönderir", !(await fails(`select share_match_card($1, 'match', $2)`, [U(4), M3b])));
await as(1);
const M1b = (await q(insMatch(1)))[0].id;
await as(3);
ok("organizatör başkasının maçının kartını gönderemez", await fails(`select share_match_card($1, 'match', $2)`, [U(4), M1b]));

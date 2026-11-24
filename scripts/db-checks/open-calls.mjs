// 0041: Maça Çağır (kişisel çağrı daveti) + herkese açık adam arama + ödünç oyuncunun sadece kendi maçını görmesi.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];
await db.exec(`reset role; update profiles set city = 'İzmir', district = 'Bornova' where id = '${U(1)}'`);

// Topluluk C (bölgesiz): u1 kurucu, u2, u3, u4 üye. u5, u6, u7 yabancı.
await as(1);
const C = (await one(`insert into groups (name, created_by) values ('Özel Grup','${U(1)}') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [C])).c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }

// --- Kişisel davet: toplama çağrısı
await as(1);
const P = (await one(`select create_gather_poll($1, current_date + 2) id`, [C])).id;
await as(5);
ok("yabancı çağrıyı göremez", (await q(`select id from match_polls where id=$1`, [P])).length === 0);
ok("yabancı yanıt veremez", await fails(`select respond_poll($1, 'yes')`, [P]));
await as(2);
ok("üye davet kartı gönderemez", await fails(`select share_match_card($1, 'poll', $2)`, [U(5), P]));
await as(1);
await db.query(`select share_match_card($1, 'poll', $2)`, [U(5), P]);
ok("kart gönderilince davet yazılır", (await q(`select 1 from poll_invites where poll_id=$1 and user_id=$2`, [P, U(5)])).length === 1);
ok("doğrudan davet yazılamaz", await fails(`insert into poll_invites (poll_id, user_id) values ($1, $2)`, [P, U(6)]));
await as(5);
ok("davetli çağrıyı görür", (await q(`select id from match_polls where id=$1`, [P])).length === 1);
ok("davetli kendi davetini görür", (await q(`select 1 from poll_invites where poll_id=$1`, [P])).length === 1);
await db.query(`select respond_poll($1, 'yes', 'MID')`, [P]);
ok("davetli yanıt verir", (await q(`select 1 from poll_responses where poll_id=$1 and user_id=$2`, [P, U(5)])).length === 1);
ok("davetli grubun sohbetini göremez", (await q(`select 1 from group_messages where group_id=$1`, [C])).length === 0);
ok("davetli grup oyuncularını göremez", (await q(`select 1 from group_players where group_id=$1`, [C])).length === 0);
ok("davetli sadece kendi yanıtını görür", (await q(`select user_id from poll_responders($1)`, [P])).length === 1);
ok("özet davetliye döner", (await one(`select group_name, is_member, my_answer from poll_overview(array[$1]::uuid[])`, [P]))?.my_answer === "yes");
await as(6);
ok("davetsiz yabancı özeti göremez", (await q(`select 1 from poll_overview(array[$1]::uuid[])`, [P])).length === 0);
await as(2);
await db.query(`select respond_poll($1, 'yes')`, [P]);
ok("üye tüm yanıtları görür", (await q(`select 1 from poll_responses where poll_id=$1`, [P])).length === 2);
for (const n of [3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P]); }

// Kesinleştirme: davetli topluluğa ödünç olarak kadroya girer
await as(1);
const when = `(current_date + 2 + time '21:00') at time zone 'Europe/Istanbul'`;
const roster = JSON.stringify([2, 3, 4, 5].map((n, i) => ({ user_id: U(n), team: i % 2 ? "B" : "A" })));
const M = (await one(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb) id`, [P, roster])).id;
ok("davetli ödünç olarak kadroya girer", (await one(`select is_loan from group_players where group_id=$1 and user_id=$2`, [C, U(5)])).is_loan === true);
// Grubun ikinci maçı: ödünç oyuncu bunu görmemeli
const M2 = (await one(`insert into matches (group_id, played_at, created_by, kind) values ($1, now() + interval '5 day', $2, 'internal') returning id`, [C, U(1)])).id;

await as(5);
ok("ödünç oynadığı maçı görür", (await q(`select 1 from matches where id=$1`, [M])).length === 1);
ok("ödünç grubun başka maçını göremez", (await q(`select 1 from matches where id=$1`, [M2])).length === 0);
ok("ödünç maçın kadrosunu görür", (await q(`select 1 from match_players where match_id=$1`, [M])).length === 4);
ok("ödünç maçtaki oyuncuları görür", (await q(`select 1 from group_players where group_id=$1`, [C])).length === 4);
ok("ödünç maç dışındaki üyeyi görmez (kurucu)", (await q(`select 1 from group_players where group_id=$1 and user_id=$2`, [C, U(1)])).length === 0);
ok("ödünç grubun adını görür", (await one(`select name from groups where id=$1`, [C]))?.name === "Özel Grup");
ok("ödünç üye sayılmaz (sohbet kapalı)", (await one(`select is_group_member($1) m`, [C])).m === false);
await as(6);
ok("yabancı maçı göremez", (await q(`select 1 from matches where id=$1`, [M])).length === 0);
ok("yabancı grubu göremez", (await q(`select 1 from groups where id=$1`, [C])).length === 0);

// --- Herkese açık adam arama
await as(1);
const F = (await one(`select create_fill_poll($1, 1::smallint, '{GK}', null, null) id`, [M])).id;
await as(6);
ok("kapalı adam arama yabancıya görünmez", (await q(`select 1 from match_polls where id=$1`, [F])).length === 0);
ok("kapalı adam aramaya yabancı başvuramaz", await fails(`select respond_poll($1, 'yes')`, [F]));
await as(2);
ok("üye adam aramayı herkese açamaz", await fails(`select set_poll_public($1, true)`, [F]));
await as(1);
ok("toplama çağrısı herkese açılamaz", await fails(`select set_poll_public($1, true)`, [P]));
await db.query(`select set_poll_public($1, true)`, [F]);
await as(6);
ok("herkese açık adam arama listede", (await q(`select * from open_fill_polls()`)).some((r) => r.open_fill_polls === F));
ok("bölge kurucunun profilinden gelir (il)", (await q(`select * from open_fill_polls('İzmir')`)).length === 1);
ok("bölge süzgeci (ilçe, harf duyarsız)", (await q(`select * from open_fill_polls('İzmir', 'bornova')`)).length === 1);
ok("başka il listede yok", (await q(`select * from open_fill_polls('Ankara')`)).length === 0);
const ov = await one(`select group_name, city, needed, taken, is_member from poll_overview(array[$1]::uuid[])`, [F]);
ok("özet güvenli alanları verir", ov.group_name === "Özel Grup" && ov.city === "İzmir" && ov.needed === 1 && ov.taken === 0 && ov.is_member === false);
await db.query(`select respond_poll($1, 'yes', 'GK')`, [F]);
ok("yabancı herkese açık aramaya başvurur", (await q(`select 1 from poll_responses where poll_id=$1 and user_id=$2`, [F, U(6)])).length === 1);
ok("yabancı yine grubu göremez", (await q(`select 1 from group_players where group_id=$1`, [C])).length === 0);
await as(7);
ok("başka yabancı başvuranı görmez", (await q(`select 1 from poll_responses where poll_id=$1`, [F])).length === 0);
await as(1);
await db.query(`select accept_responder($1, $2)`, [F, U(6)]);
ok("kabul edilen kadroya girer, arama dolar", (await one(`select status from match_polls where id=$1`, [F])).status === "filled");
await as(7);
ok("dolan arama listeden düşer", (await q(`select * from open_fill_polls()`)).length === 0);
await as(6);
ok("kabul edilen maçı görür", (await q(`select 1 from matches where id=$1`, [M])).length === 1);
ok("kabul edilen oy verebilir (kendi oyuncu kimliği)", (await one(`select my_player_id($1) id`, [C])).id !== null);

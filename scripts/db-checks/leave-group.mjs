import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// Grup G: u1 kurucu, u2 yetkili, u3 ve u4 üye. u5 yabancı.
await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Grup','${U(1)}') returning id`))[0].id;
const code = (await q(`select group_invite_code($1) c`, [G]))[0].c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where user_id=$1 and group_id=$2), 'admin')`, [U(2), G]);
const gp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), G]))[0].id;
const [p1, p2, p3, p4] = [await gp(1), await gp(2), await gp(3), await gp(4)];
await db.exec("reset role");

// Geçmiş (kapanmış) maç + gelecekteki planlanmış maç + açık çağrı
const past = (await q(`insert into matches (group_id, played_at, created_by, kind, status) values ($1, now() - interval '5 day', $2, 'internal', 'closed') returning id`, [G, U(1)]))[0].id;
const fut = (await q(`insert into matches (group_id, played_at, created_by, kind, status) values ($1, now() + interval '3 day', $2, 'internal', 'planned') returning id`, [G, U(1)]))[0].id;
for (const m of [past, fut]) await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A'),($1,$3,'B')`, [m, p3, p4]);
await db.query(`insert into match_results (match_id, player_id, performance, match_score, votes_received, weight, rating_before, rating_after) values ($1,$2,0.7,7,3,1,65,67)`, [past, p3]);
const poll = (await q(`insert into match_polls (group_id, created_by, starts_at, capacity, status) values ($1,$2, now() + interval '2 day', 10, 'open') returning id`, [G, U(1)]))[0].id;
await db.query(`insert into poll_responses (poll_id, player_id, answer) values ($1,$2,'yes')`, [poll, p3]);

// --- ayrılma kuralları
await as(1);
ok("kaptan devretmeden ayrılamaz", await fails(`select leave_group($1)`, [G]));
await as(5);
ok("üye olmayan ayrılamaz", await fails(`select leave_group($1)`, [G]));

await as(3);
await db.query(`select leave_group($1)`, [G]);
await db.exec("reset role");
const left = (await q(`select left_at, user_id from group_players where id=$1`, [p3]))[0];
ok("ayrılan satır silinmez, left_at dolar, hesap bağı kalır", !!left.left_at && left.user_id === U(3));
ok("geçmiş maç kadrosu ve sonuçları korunur", (await q(`select count(*)::int c from match_players where player_id=$1 and match_id=$2`, [p3, past]))[0].c === 1 && (await q(`select count(*)::int c from match_results where player_id=$1`, [p3]))[0].c === 1);
ok("gelecekteki planlanmış maç kadrosundan çıkar", (await q(`select count(*)::int c from match_players where player_id=$1 and match_id=$2`, [p3, fut]))[0].c === 0);
ok("açık çağrı yanıtı silinir", (await q(`select count(*)::int c from poll_responses where player_id=$1`, [p3]))[0].c === 0);
ok("diğer oyuncunun kadro satırı etkilenmez", (await q(`select count(*)::int c from match_players where player_id=$1 and match_id=$2`, [p4, fut]))[0].c === 1);

await as(3);
ok("ayrılan artık üye değil", (await q(`select is_group_member($1) m`, [G]))[0].m === false);
ok("ayrılan özel grubu göremez", (await q(`select count(*)::int c from groups where id=$1`, [G]))[0].c === 0);
ok("ayrılan sohbete yazamaz", await fails(`insert into group_messages (group_id, author_id, kind, body) values ($1,$2,'text','merhaba')`, [G, p3]));
ok("ayrılan tekrar ayrılamaz", await fails(`select leave_group($1)`, [G]));
ok("my_player_id boş döner", (await q(`select my_player_id($1) id`, [G]))[0].id === null);

// --- tekrar katılım
await db.query(`select join_group($1)`, [code]);
ok("aynı kodla tekrar katılınca satır yeniden açılır (yeni satır değil)", (await q(`select count(*)::int c from group_players where user_id=$1 and group_id=$2`, [U(3), G]))[0].c === 1 && (await q(`select left_at from group_players where id=$1`, [p3]))[0].left_at === null);
ok("tekrar katılan üye olur", (await q(`select is_group_member($1) m`, [G]))[0].m === true);
ok("geçmiş maçı hâlâ kayıtlı", (await q(`select count(*)::int c from match_results where player_id=$1`, [p3]))[0].c === 1);

// --- oylaması süren maçı olan ayrılamaz
await db.exec("reset role");
const vm = (await q(`insert into matches (group_id, played_at, created_by, kind, status, voting_deadline) values ($1, now() - interval '1 hour', $2, 'internal', 'voting', now() + interval '1 day') returning id`, [G, U(1)]))[0].id;
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [vm, p4]);
await as(4);
ok("oylaması süren maçı olan ayrılamaz", await fails(`select leave_group($1)`, [G]));
await db.exec("reset role");
await db.query(`update matches set status='closed' where id=$1`, [vm]);
await as(4);
await db.query(`select leave_group($1)`, [G]);
ok("oylama bitince ayrılabilir", (await q(`select is_group_member($1) m`, [G]))[0].m === false);

// --- yetkili çıkarma
await as(1);
await db.query(`select join_group($1)`, [code]).catch(() => {});
await as(4); await db.query(`select join_group($1)`, [code]);
await as(2);
await db.query(`select remove_member($1)`, [p4]);
await db.exec("reset role");
ok("yetkili üyeyi çıkarınca satır silinmez, ayrılmış sayılır", (await q(`select left_at from group_players where id=$1`, [p4]))[0].left_at !== null && (await q(`select count(*)::int c from match_players where player_id=$1`, [p4]))[0].c >= 1);
await as(2);
ok("yetkili kaptanı çıkaramaz", await fails(`select remove_member($1)`, [p1]));
ok("yetkili kendini çıkaramaz", await fails(`select remove_member($1)`, [p2]));
await as(3);
ok("sıradan üye çıkaramaz", await fails(`select remove_member($1)`, [p2]));
ok("sıradan üye doğrudan silemez", (await db.query(`delete from group_players where id=$1`, [p2])).affectedRows === 0);
await as(1);
await db.query(`select set_member_role($1,'admin')`, [p3]);
await as(2);
ok("yetkili, topluluktaki yetkiliyi çıkarabilir (eski kural)", await db.query(`select remove_member($1)`, [p3]).then(() => true, () => false));

// --- misafir silinir
await db.exec("reset role");
const guest = (await q(`insert into group_players (group_id, display_name) values ($1,'Misafir') returning id`, [G]))[0].id;
await as(1);
await db.query(`select remove_member($1)`, [guest]);
ok("misafir kaydı silinir", (await q(`select count(*)::int c from group_players where id=$1`, [guest]))[0].c === 0);

// --- takımda yetkiliyi sadece kaptan çıkarır
await as(1);
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Takım','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeT = (await q(`select group_invite_code($1) c`, [T]))[0].c;
for (const n of [2, 3]) { await as(n); await db.query(`select join_group($1)`, [codeT]); }
await as(1);
const tp = async (n) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), T]))[0].id;
await db.query(`select set_member_role($1,'admin')`, [await tp(2)]);
await db.query(`select set_member_role($1,'admin')`, [await tp(3)]);
await as(2);
ok("takımda yetkili başka yetkiliyi çıkaramaz", await fails(`select remove_member($1)`, [await tp(3)]));
await as(1);
await db.query(`select remove_member($1)`, [await tp(3)]);
ok("takımda kaptan yetkiliyi çıkarabilir", (await q(`select left_at from group_players where id=$1`, [await tp(3)]))[0]?.left_at !== undefined);

// --- grup silme
await as(1);
ok("başka üyeler varken grup silinemez", await fails(`select delete_group($1)`, [T]));
ok("doğrudan grup silme kapalı", (await db.query(`delete from groups where id=$1`, [T])).affectedRows === 0);
await as(2);
ok("kaptan olmayan grubu silemez", await fails(`select delete_group($1)`, [T]));
await db.query(`select leave_group($1)`, [T]);
await as(1);
await db.query(`select delete_group($1)`, [T]);
ok("tek başına kalan kaptan takımı siler", (await q(`select count(*)::int c from groups where id=$1`, [T]))[0].c === 0);
// Teklifli takım silinebilir mi (FK)? Kaptanın tek üyeli iki takımı arasında teklif
const A = (await q(`insert into groups (name, created_by, kind, city) values ('Takım A','${U(1)}','team','İstanbul') returning id`))[0].id;
await as(5);
const B = (await q(`insert into groups (name, created_by, kind, city) values ('Takım B','${U(5)}','team','İstanbul') returning id`))[0].id;
await as(1);
const ch = (await q(`select create_challenge($1,$2, now() + interval '3 day', null, null, null) id`, [A, B]))[0].id;
await as(5); await db.query(`select respond_challenge($1,true)`, [ch]);
await as(1);
await db.query(`select delete_group($1)`, [A]);
ok("teklif/ortak maçı olan takım da silinebilir", (await q(`select count(*)::int c from groups where id=$1`, [A]))[0].c === 0);

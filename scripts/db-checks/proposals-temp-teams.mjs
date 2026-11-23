// 0037: üye maç önerisi, geçici (hızlı) takım + arşiv/dağıt, sessize alma.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// Topluluk C (İstanbul/Kadıköy): u1 kurucu, u2 organizatör, u3, u4 üye. u5 yabancı. Takım R: u6 kaptan (teklif için).
await as(1);
const C = (await one(`insert into groups (name, created_by, city, district) values ('Topluluk','${U(1)}','İstanbul','Kadıköy') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [C])).c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where group_id=$1 and user_id=$2), 'organizer')`, [C, U(2)]);
await as(6);
const RR = (await one(`insert into groups (name, created_by, kind, city) values ('Rakip','${U(6)}','team','İstanbul') returning id`)).id;

// --- A) Öneri
const propose = (extra = "") => `select propose_match($1, current_date + 2${extra}) id`;
await as(2);
ok("organizatör öneri yapamaz (doğrudan çağrı açar)", await fails(propose(), [C]));
await as(5);
ok("yabancı öneri yapamaz", await fails(propose(), [C]));
await as(3);
const PR = (await one(`select propose_match($1, current_date + 2, null, 'Petroller', 'Cuma yapalım mı?') id`, [C])).id;
ok("üye öneri yapar", !!PR);
ok("bekleyen önerisi varken ikincisini yapamaz", await fails(propose(), [C]));
ok("geçmiş güne öneri yapılamaz", await fails(`select propose_match($1, current_date - 1)`, [C]));
await as(4);
ok("başka üye öneriyi göremez", (await q(`select * from match_proposals where id=$1`, [PR])).length === 0);
ok("başka üye öneriye karar veremez", await fails(`select decide_proposal($1, true)`, [PR]));
await as(3);
ok("öneren kendi önerisini görür", (await q(`select * from match_proposals where id=$1`, [PR])).length === 1);
await as(2);
ok("organizatör öneriyi görür", (await q(`select * from match_proposals where id=$1`, [PR])).length === 1);
const PP = (await one(`select decide_proposal($1, true) id`, [PR])).id;
const pp = await one(`select created_by, proposal_id, purpose, venue, note from match_polls where id=$1`, [PP]);
ok("onaylanınca öneren adına toplama çağrısı açılır", pp.created_by === U(3) && pp.proposal_id === PR && pp.purpose === "gather" && pp.venue === "Petroller");
ok("öneri 'kabul' ve çağrıya bağlı", (await one(`select status, poll_id from match_proposals where id=$1`, [PR])).poll_id === PP);
ok("sonuçlanmış öneriye tekrar karar verilemez", await fails(`select decide_proposal($1, false)`, [PR]));
await as(3);
ok("öneren (rolü olmadan) çağrısını yönetir", (await one(`select can_manage_poll($1) c`, [PP])).c === true);
ok("öneren çağrısını düzenler", !(await fails(`select update_gather_poll($1, null, 'Saha 2', null, null, null, null)`, [PP])));
ok("öneren yine de yeni çağrı açamaz", await fails(`select create_gather_poll($1, current_date + 3) id`, [C]));
for (const n of [1, 2, 3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [PP]); }
await as(3);
const roster = (ns, team = "A") => JSON.stringify(ns.map((n, i) => ({ user_id: U(n), team: team === "split" ? (i % 2 ? "B" : "A") : team })));
const when = `(current_date + 2 + time '21:00') at time zone 'Europe/Istanbul'`;
const M0 = (await one(`select finalize_poll($1, ${when}, null, 5::smallint, 'internal', null, null, $2::jsonb) id`, [PP, roster([1, 2, 3, 4], "split")])).id;
ok("öneren kadroyu kesinleştirir, maç onun adına kurulur", (await one(`select created_by from matches where id=$1`, [M0])).created_by === U(3));
ok("öneren kurduğu maçı yönetir", (await one(`select can_manage_match($1) c`, [M0])).c === true);
await as(4);
const PR2 = (await one(propose(), [C])).id;
await as(2);
await db.query(`select decide_proposal($1, false)`, [PR2]);
ok("reddedilen öneri 'reddedildi'", (await one(`select status from match_proposals where id=$1`, [PR2])).status === "declined");
await as(4);
const PR3 = (await one(propose(), [C])).id;
await db.query(`select cancel_proposal($1)`, [PR3]);
ok("öneren bekleyen önerisini geri çeker", (await one(`select status from match_proposals where id=$1`, [PR3])).status === "cancelled");
await as(3);
ok("başkasının önerisini geri çekemez", await fails(`select cancel_proposal($1)`, [PR2]));

// --- B) Hızlı (geçici) takım
await as(2);
const gather = async () => (await one(`select create_gather_poll($1, current_date + 2) id`, [C])).id;
const P1 = await gather();
for (const n of [3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P1]); }
await as(2);
ok("1 karakterlik hızlı takım adı reddedilir", await fails(`select finalize_poll($1, ${when}, null, null, 'external', null, 'Rakip FK', $2::jsonb, 'X')`, [P1, roster([3, 4])]));
const MX = (await one(`select finalize_poll($1, ${when}, null, null, 'external', null, 'Rakip FK', $2::jsonb, 'Hızlı FC') id`, [P1, roster([3, 4])])).id;
const T = (await one(`select group_id from matches where id=$1`, [MX])).group_id;
const t = await one(`select name, kind, is_temporary, city, district, archived_at from groups where id=$1`, [T]);
ok("hızlı takım geçici kurulur, il/ilçe topluluktan gelir", t.kind === "team" && t.is_temporary && t.city === "İstanbul" && t.district === "Kadıköy" && !t.archived_at);
ok("kuran hızlı takımın kaptanı", (await one(`select role from group_players where group_id=$1 and user_id=$2`, [T, U(2)])).role === "captain");
ok("seçilenler hızlı takıma ödünç yazılır", (await q(`select 1 from group_players where group_id=$1 and is_loan`, [T])).length === 2);
const Tcode = (await one(`select group_invite_code($1) c`, [T])).c;

await db.exec("reset role");
await db.query(`update matches set status='voting', score_a=3, score_b=1, voting_deadline=now() + interval '1 day' where id=$1`, [MX]);
ok("oylamadayken geçici takım arşivlenmez", (await one(`select archived_at from groups where id=$1`, [T])).archived_at === null);
await db.query(`update matches set status='closed' where id=$1`, [MX]);
ok("son maçı kapanınca geçici takım arşivlenir", !!(await one(`select archived_at from groups where id=$1`, [T])).archived_at);

await as(2);
ok("arşivli takımda maç açma yetkisi yok", (await one(`select can_create_match($1) c`, [T])).c === false);
ok("arşivli takıma maç yazılamaz", await fails(`insert into matches (group_id, played_at, created_by, kind, opponent_name) values ($1, now() + interval '2 day', $2, 'external', 'X')`, [T, U(2)]));
await as(5);
ok("arşivli takıma kodla katılınamaz", await fails(`select join_group($1)`, [Tcode]));
await as(6);
ok("arşivli takıma teklif gönderilemez", await fails(`insert into match_challenges (from_group_id, to_group_id, created_by, proposed_at) values ($1,$2,$3, now() + interval '3 day')`, [RR, T, U(6)]));

await as(2);
const P2 = await gather();
for (const n of [3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P2]); }
await as(2);
const MX2 = (await one(`select finalize_poll($1, ${when}, null, null, 'external', $2, 'Rakip FK', $3::jsonb) id`, [P2, T, roster([3, 4])])).id;
ok("arşivdeki geçici takım seçilince yeniden açılır (yeni takım kurulmaz)",
  (await one(`select group_id from matches where id=$1`, [MX2])).group_id === T && (await one(`select archived_at from groups where id=$1`, [T])).archived_at === null);
ok("planlı maçı varken takım dağıtılamaz", await fails(`select disband_team($1)`, [T]));
await db.query(`delete from matches where id=$1`, [MX2]);
ok("maç iptal olunca oynanmış maçı olan geçici takım arşivlenir", (await one(`select cleanup_temp_team($1) r`, [T])).r === "archived");
await as(3);
ok("ödünç oyuncu takımı yeniden açamaz", await fails(`select reopen_team($1)`, [T]));
await as(2);
await db.query(`select reopen_team($1)`, [T]);
ok("kaptan takımı yeniden açar", (await one(`select archived_at from groups where id=$1`, [T])).archived_at === null);
await db.query(`select make_team_permanent($1)`, [T]);
ok("kaptan geçici takımı kalıcı yapar", (await one(`select is_temporary from groups where id=$1`, [T])).is_temporary === false);
ok("kalıcı takımda temizlik silmez", (await one(`select cleanup_temp_team($1) r`, [T])).r === "kept");
await db.query(`select disband_team($1)`, [T]);
ok("oynanmış maçı olan takım dağıtılınca arşivlenir (geçmiş kalır)",
  !!(await one(`select archived_at from groups where id=$1`, [T])).archived_at && (await q(`select 1 from matches where id=$1`, [MX])).length === 1);

const P3 = await gather();
for (const n of [3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P3]); }
await as(2);
const MX3 = (await one(`select finalize_poll($1, ${when}, null, null, 'external', null, 'Rakip FK', $2::jsonb, 'Boş FC') id`, [P3, roster([3, 4])])).id;
const T3 = (await one(`select group_id from matches where id=$1`, [MX3])).group_id;
await as(3);
ok("üye olmayan (ödünç) temizliği tetikleyemez", (await one(`select cleanup_temp_team($1) r`, [T3])).r === "kept");
await as(2);
await db.query(`delete from matches where id=$1`, [MX3]);
ok("maçı iptal olan ve hiç maçı kalmayan geçici takım silinir",
  (await one(`select cleanup_temp_team($1) r`, [T3])).r === "deleted" && (await q(`select 1 from groups where id=$1`, [T3])).length === 0);

await as(6);
const E = (await one(`insert into groups (name, created_by, kind, city) values ('Boş Takım','${U(6)}','team','İstanbul') returning id`)).id;
await as(5);
ok("kaptan olmayan dağıtamaz", await fails(`select disband_team($1)`, [E]));
await as(6);
ok("hiç maçı olmayan takım dağıtılınca silinir", (await one(`select disband_team($1) r`, [E])).r === "deleted");
ok("topluluk dağıtılamaz (sadece takım)", await fails(`select disband_team($1)`, [C]));

// --- D) Sessize alma
await as(3);
await db.query(`select set_group_muted($1, true)`, [C]);
ok("üye grubu kendi için sessize alır", (await one(`select muted from group_players where group_id=$1 and user_id=$2`, [C, U(3)])).muted === true);
await as(5);
ok("üye olmayan sessize alamaz", await fails(`select set_group_muted($1, true)`, [C]));
await as(3);
await db.query(`select set_group_muted($1, false)`, [C]);
ok("sessizden çıkar", (await one(`select muted from group_players where group_id=$1 and user_id=$2`, [C, U(3)])).muted === false);

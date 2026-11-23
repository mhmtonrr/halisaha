// 0035: birleşik çağrı. Toplama (gün zorunlu, toplu kesinleştirme, yedek) ve adam ara (planlı maçın eksiği, tek tek kabul).
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// Topluluk C: u1 kurucu, u2 organizatör, u3-u6 ve u8 üye. u7 yabancı. Takım T: u2 kaptan. Takım T2: u1 kaptan.
await as(1);
const C = (await one(`insert into groups (name, created_by) values ('Topluluk','${U(1)}') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [C])).c;
for (const n of [2, 3, 4, 5, 6, 8]) { await as(n); await db.query(`select join_group($1)`, [code]); }
const gp = async (g, n) => (await one(`select id, is_loan from group_players where user_id=$1 and group_id=$2`, [U(n), g]));
await as(1);
await db.query(`select set_member_role($1, 'organizer')`, [(await gp(C, 2)).id]);
await as(2);
const T = (await one(`insert into groups (name, created_by, kind, city) values ('Takım','${U(2)}','team','İstanbul') returning id`)).id;
await as(1);
const T2 = (await one(`insert into groups (name, created_by, kind, city) values ('Takım 2','${U(1)}','team','İstanbul') returning id`)).id;

const gather = (extra = "") => `select create_gather_poll($1, current_date + 2${extra}) id`;
const status = async (poll, n) => (await one(`select answer, status from poll_responses where poll_id=$1 and user_id=$2`, [poll, U(n)]));

// --- toplama çağrısı açma
await as(3);
ok("üye çağrı açamaz", await fails(gather(), [C]));
await as(7);
ok("yabancı çağrı açamaz", await fails(gather(), [C]));
await as(2);
const P = (await one(gather(), [C])).id;
const pr = await one(`select purpose, status, starts_at, capacity from match_polls where id=$1`, [P]);
ok("organizatör sadece günle çağrı açar (saat, kontenjan boş)", pr.purpose === "gather" && pr.status === "open" && pr.starts_at === null && pr.capacity === null);
ok("sohbete 'saat belli değil' duyurusu düşer", (await one(`select body from group_messages where poll_id=$1`, [P])).body.includes("saat belli değil"));
ok("geçmiş gün reddedilir", await fails(`select create_gather_poll($1, current_date - 1)`, [C]));
ok("30 günden uzak reddedilir", await fails(`select create_gather_poll($1, current_date + 35)`, [C]));
ok("başka güne saat reddedilir", await fails(`select create_gather_poll($1, current_date + 2, now() + interval '5 day')`, [C]));
ok("4 kişilik reddedilir", await fails(`select create_gather_poll($1, current_date + 2, null, null, 4::smallint)`, [C]));
ok("maç gününden sonra karar zamanı reddedilir", await fails(`select create_gather_poll($1, current_date + 2, null, null, null, null, now() + interval '5 day')`, [C]));
const P7 = (await one(`select create_gather_poll($1, current_date + 3, null, 'Saha', 7::smallint) id`, [C])).id;
ok("7v7 seçilince kontenjan 14 olur", (await one(`select capacity from match_polls where id=$1`, [P7])).capacity === 14);
const P3rd = (await one(gather(), [C])).id;
ok("organizatör aynı grupta 4. açık çağrıyı açamaz", await fails(gather(), [C]));
await db.query(`select close_poll($1)`, [P3rd]);
ok("kapatınca yeniden açabilir", !(await fails(`select close_poll($1)`, [(await one(gather(), [C])).id])));
await as(1);
for (let i = 0; i < 4; i++) await db.query(gather(), [C]);
ok("kurucu için açık çağrı sınırı yok", (await one(`select count(*)::int c from match_polls where created_by=$1`, [U(1)])).c === 4);

// --- yanıt
await as(3); await db.query(`select respond_poll($1, 'yes', 'GK', 'Kaleye geçerim')`, [P]);
await as(4); await db.query(`select respond_poll($1, 'yes')`, [P]);
await as(5); await db.query(`select respond_poll($1, 'maybe')`, [P]);
await as(6); await db.query(`select respond_poll($1, 'no')`, [P]);
await as(1); await db.query(`select respond_poll($1, 'yes')`, [P]);
await as(7);
ok("yabancı yanıt veremez", await fails(`select respond_poll($1, 'yes')`, [P]));
await as(3);
ok("geçersiz yanıt reddedilir", await fails(`select respond_poll($1, 'evet')`, [P]));
const t0 = (await one(`select responded_at from poll_responses where poll_id=$1 and user_id=$2`, [P, U(3)])).responded_at;
await db.query(`select respond_poll($1, 'yes', 'DEF')`, [P]);
const r3 = await one(`select responded_at, position from poll_responses where poll_id=$1 and user_id=$2`, [P, U(3)]);
ok("geliyorum → geliyorum sırayı korur, mevki güncellenir", +r3.responded_at === +t0 && r3.position === "DEF");
await db.query(`select respond_poll($1, 'yes', 'GK', 'Kaleye geçerim')`, [P]);
await as(6);
const list6 = await q(`select user_id, played from poll_responders($1)`, [P]);
ok("üye yanıtlayanları görür ama güvenilirliği göremez", list6.length === 5 && list6.every((r) => r.played === null));
await as(2);
ok("organizatör yanıtlayanları güvenilirlikle görür", (await q(`select played from poll_responders($1)`, [P])).every((r) => r.played === 0));
await as(7);
ok("yabancı yanıtlayanları göremez", (await q(`select * from poll_responders($1)`, [P])).length === 0);

// --- düzenleme
await as(3);
ok("üye çağrıyı düzenleyemez", await fails(`select update_gather_poll($1, null, 'X', null, null, null, null)`, [P]));
await as(2);
await db.query(`select update_gather_poll($1, (current_date + 2 + time '19:00') at time zone 'Europe/Istanbul', 'Petroller', 5::smallint, null, null, 'Kişi başı 150')`, [P]);
ok("organizatör saat ve sahayı netleştirir", (await one(`select venue, capacity from match_polls where id=$1`, [P])).capacity === 10);
ok("çağrının günü dışında saat reddedilir", await fails(`select update_gather_poll($1, now() + interval '6 day', null, null, null, null, null)`, [P]));

// --- kesinleştirme (kendi aramızda)
const when = `(current_date + 2 + time '21:00') at time zone 'Europe/Istanbul'`;
const roster = (arr) => JSON.stringify(arr.map(([n, team, gk]) => ({ user_id: U(n), team, gk: !!gk })));
const fin = (poll, r, kind = "internal", team = null, opp = null) =>
  db.query(`select finalize_poll($1, ${when}, 'Petroller', 5::smallint, $2, $3, $4, $5::jsonb) id`, [poll, kind, team, opp, r]);
await as(3);
ok("üye kesinleştiremez", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "A"], [4, "B"], [5, "B"]])]));
await as(2);
ok("en az 4 oyuncu gerekir", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "B"]])]));
ok("yanıt vermeyen seçilemez", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "A"], [4, "B"], [8, "B"]])]));
ok("'gelemem' diyen seçilemez", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "A"], [4, "B"], [6, "B"]])]));
ok("geçmiş saatle kesinleştirilemez", await fails(`select finalize_poll($1, now() - interval '1 hour', null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "A"], [4, "B"], [5, "B"]])]));
await as(8); await db.query(`select respond_poll($1, 'yes')`, [P]);
await as(2);
const M = (await fin(P, roster([[1, "A"], [3, "A", true], [4, "B"], [5, "B"]]))).rows[0].id;
const mrow = await one(`select group_id, kind, created_by, team_size from matches where id=$1`, [M]);
ok("maç toplulukta, kendi aramızda, organizatör adına kurulur", mrow.group_id === C && mrow.kind === "internal" && mrow.created_by === U(2) && mrow.team_size === 5);
const mp = await q(`select gp.user_id, mp.team, mp.is_goalkeeper from match_players mp join group_players gp on gp.id=mp.player_id where mp.match_id=$1`, [M]);
ok("kadro ve taraflar seçildiği gibi", mp.length === 4 && mp.find((r) => r.user_id === U(4)).team === "B" && mp.find((r) => r.user_id === U(3)).is_goalkeeper);
const pc = await one(`select status, match_id, capacity from match_polls where id=$1`, [P]);
ok("çağrı maça dönüşür (kontenjan = seçilen sayı)", pc.status === "converted" && pc.match_id === M && pc.capacity === 4);
ok("'belki' seçilen kadroda, yanıtı 'geliyorum' olur", JSON.stringify(await status(P, 5)) === JSON.stringify({ answer: "yes", status: "selected" }));
ok("seçilmeyen 'geliyorum' yedek olur", (await status(P, 8)).status === "reserve");
ok("aynı çağrı ikinci kez kesinleştirilemez", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster([[1, "A"], [3, "A"], [4, "B"], [5, "B"]])]));

// --- kesinleşmiş çağrıda yanıt, yedek, ret
await as(6); await db.query(`select respond_poll($1, 'yes')`, [P]);
ok("geç gelen 'geliyorum' yedeğe yazılır", (await status(P, 6)).status === "reserve");
await as(3);
ok("kadrodaki 'gelemem' diyemez (çekilme ister)", await fails(`select respond_poll($1, 'no')`, [P]));
await as(4);
ok("üye yedeği kadroya alamaz", await fails(`select accept_responder($1, $2)`, [P, U(8)]));
await as(2);
await db.query(`select accept_responder($1, $2)`, [P, U(8)]);
ok("organizatör yedeği kadroya alır (dengeye göre A)", (await q(`select mp.team from match_players mp join group_players gp on gp.id=mp.player_id where mp.match_id=$1 and gp.user_id=$2`, [M, U(8)]))[0]?.team === "A");
ok("alınan yedek 'kadroda' olur", (await status(P, 8)).status === "selected");
ok("kadroya alınınca sohbete yazılır", (await q(`select 1 from group_messages where match_id=$1 and body like '%kadrosuna alındı%'`, [M])).length === 1);
await db.query(`select reject_responder($1, $2)`, [P, U(6)]);
await as(6);
ok("reddedilen tekrar 'geliyorum' diyemez", await fails(`select respond_poll($1, 'yes')`, [P]));
ok("reddedilen 'gelemem' diyebilir (durum korunur)", !(await fails(`select respond_poll($1, 'no')`, [P])) && (await status(P, 6)).status === "rejected");

// --- çekilme → yanıt 'withdrawn'
await as(4);
await db.query(`select request_withdrawal($1, null)`, [M]);
await as(2);
await db.query(`select decide_withdrawal((select id from match_withdrawals where match_id=$1), true)`, [M]);
ok("çekilmesi onaylanan oyuncunun yanıtı 'çekildi' olur", (await status(P, 4)).status === "withdrawn");

// --- kesinleştirme (rakibe karşı, takıma ödünç)
await as(2);
const PX = (await one(gather(), [C])).id;
await as(3); await db.query(`select respond_poll($1, 'yes')`, [PX]);
await as(4); await db.query(`select respond_poll($1, 'yes')`, [PX]);
await as(2);
ok("rakibe karşı maç takım ister", await fails(`select finalize_poll($1, ${when}, null, null, 'external', null, 'Rakip', $2::jsonb)`, [PX, roster([[3], [4]])]));
ok("yetkisi olmadığı takımda kurulamaz", await fails(`select finalize_poll($1, ${when}, null, null, 'external', $2, 'Rakip', $3::jsonb)`, [PX, T2, roster([[3], [4]])]));
ok("topluluk 'takım' olarak seçilemez", await fails(`select finalize_poll($1, ${when}, null, null, 'external', $2, 'Rakip', $3::jsonb)`, [PX, C, roster([[3], [4]])]));
ok("rakip adı gerekir", await fails(`select finalize_poll($1, ${when}, null, null, 'external', $2, 'R', $3::jsonb)`, [PX, T, roster([[3], [4]])]));
const MX = (await fin(PX, roster([[3, "B"], [4]]), "external", T, "Rakip FK")).rows[0].id;
const mx = await one(`select group_id, kind, opponent_name from matches where id=$1`, [MX]);
ok("maç takımda, rakibe karşı kurulur", mx.group_id === T && mx.kind === "external" && mx.opponent_name === "Rakip FK");
ok("takım üyesi olmayan seçilen takıma ödünç yazılır", (await gp(T, 3)).is_loan === true && (await gp(T, 4)).is_loan === true);
ok("rakip maçında herkes A tarafında", (await q(`select distinct team from match_players where match_id=$1`, [MX])).map((r) => r.team).join() === "A");
await as(3);
ok("ödünç oyuncu takım üyesi sayılmaz", (await one(`select is_group_member($1) m`, [T])).m === false);

// --- adam ara (topluluktan takım maçına)
await as(5);
ok("üye adam arayamaz", await fails(`select create_fill_poll($1, 2::smallint, '{DEF}', null, $2)`, [MX, C]));
await as(2);
ok("11 kişi aranamaz", await fails(`select create_fill_poll($1, 11::smallint, '{}', null, $2)`, [MX, C]));
ok("takım başka bir takımda adam arayamaz", await fails(`select create_fill_poll($1, 2::smallint, '{}', null, $2)`, [MX, T2]));
const F = (await one(`select create_fill_poll($1, 2::smallint, '{DEF}', 'Defans lazım', $2) id`, [MX, C])).id;
const fr = await one(`select purpose, group_id, match_id, capacity, positions from match_polls where id=$1`, [F]);
ok("adam arama toplulukta, takım maçına bağlı açılır", fr.purpose === "fill" && fr.group_id === C && fr.match_id === MX && fr.capacity === 2 && fr.positions.join() === "DEF");
await db.query(`select close_poll($1)`, [F]);
const F1 = (await one(`select create_fill_poll($1, 1::smallint, '{}', null, $2) id`, [MX, C])).id;
ok("1 kişilik adam arama açılır (0036)", !!F1);
await db.query(`select close_poll($1)`, [F1]);
await db.exec("reset role");
await db.query(`update match_polls set status='open' where id=$1`, [F]);
await as(2);
ok("aynı yerde ikinci adam arama açılamaz", await fails(`select create_fill_poll($1, 1::smallint, '{}', null, $2)`, [MX, C]));
ok("sohbete 'adam aranıyor' düşer", (await one(`select body from group_messages where poll_id=$1`, [F])).body.startsWith("🔎 Adam aranıyor: 2 kişi"));
await as(3);
ok("maçın kadrosundaki tekrar başvuramaz", await fails(`select respond_poll($1, 'yes')`, [F]));
await as(5); await db.query(`select respond_poll($1, 'yes', 'DEF')`, [F]);
await as(6); await db.query(`select respond_poll($1, 'yes')`, [F]);
await as(8); await db.query(`select respond_poll($1, 'yes')`, [F]);
await as(2);
await db.query(`select accept_responder($1, $2)`, [F, U(5)]);
ok("kabul edilen takıma ödünç yazılır ve maç kadrosuna girer", (await gp(T, 5)).is_loan === true && (await q(`select 1 from match_players where match_id=$1 and player_id=$2`, [MX, (await gp(T, 5)).id])).length === 1);
await db.query(`select accept_responder($1, $2)`, [F, U(6)]);
ok("sayı dolunca adam arama 'doldu' olur", (await one(`select status from match_polls where id=$1`, [F])).status === "filled");
ok("doluyken başka kabul edilemez", await fails(`select accept_responder($1, $2)`, [F, U(8)]));
await db.query(`delete from match_players where match_id=$1 and player_id=$2`, [MX, (await gp(T, 6)).id]);
ok("kadrodan çıkan kabulün yanıtı 'çekildi', arama yeniden açılır",
  (await status(F, 6)).status === "withdrawn" && (await one(`select status from match_polls where id=$1`, [F])).status === "open");
await db.exec("reset role");
await db.query(`update matches set status='voting', score_a=2, score_b=1, voting_deadline=now() + interval '1 day' where id=$1`, [MX]);
ok("maç planlıdan çıkınca adam arama kapanır", (await one(`select status from match_polls where id=$1`, [F])).status === "closed");
await as(8);
ok("kapalı çağrıya yanıt verilemez", await fails(`select respond_poll($1, 'yes')`, [F]));

// --- kapatma ve günü geçenler
await as(2);
const PC = (await one(gather(), [C])).id;
await as(3);
ok("üye çağrıyı kapatamaz", await fails(`select close_poll($1)`, [PC]));
await as(1);
await db.query(`select close_poll($1)`, [PC]);
ok("kurucu organizatörün çağrısını kapatır", (await one(`select status from match_polls where id=$1`, [PC])).status === "closed");
ok("maça dönüşmüş çağrı kapatılamaz", await fails(`select close_poll($1)`, [P]));
await db.exec("reset role");
await db.query(`update match_polls set play_on = current_date - 1 where id=$1`, [P7]);
await as(3);
ok("günü geçen açık çağrı sayfa açılışında kapanır", (await one(`select close_stale_polls($1) n`, [C])).n >= 1 && (await one(`select status from match_polls where id=$1`, [P7])).status === "closed");
await as(7);
ok("üye olmayan kapatma tetikleyemez", (await one(`select close_stale_polls($1) n`, [C])).n === 0);

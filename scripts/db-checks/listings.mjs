import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const future = "now() + interval '3 day'";

// Takım T: u1 kaptan, u2 oyuncu. Rakip takım O: u7 kaptan. u3, u4 başvuran. u5 yabancı. u6: topluluk C'de rating'i 80.
await as(1);
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Takım T','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeT = (await q(`select group_invite_code($1) c`, [T]))[0].c;
await as(7);
const O = (await q(`insert into groups (name, created_by, kind, city) values ('Takım O','${U(7)}','team','İstanbul') returning id`))[0].id;
await as(2); await db.query(`select join_group($1)`, [codeT]);
const gp = async (n, g) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), g]))[0]?.id;

// Teklif → bağlı iki maç (T'nin maçı mT, O'nun maçı mO)
await as(1);
const ch = (await q(`select create_challenge($1,$2,${future},'Saha','', '', 7::smallint) id`, [T, O]))[0].id;
await as(7); await db.query(`select respond_challenge($1,true)`, [ch]);
await db.exec("reset role");
const ms = await q(`select id, group_id from matches where challenge_id=$1`, [ch]);
const mT = ms.find((m) => m.group_id === T).id, mO = ms.find((m) => m.group_id === O).id;
await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [mO, await gp(7, O)]); // rakip kadroda u7

// --- ilan açma
await as(2);
ok("normal oyuncu ilan açamaz", await fails(`select create_listing($1, 2::smallint, array['DEF'], null::smallint, 'Not')`, [mT]));
await as(5);
ok("yabancı ilan açamaz", await fails(`select create_listing($1, 2::smallint, array['DEF'], null::smallint, null)`, [mT]));
await as(1);
ok("0 oyuncu aranamaz", await fails(`select create_listing($1, 0::smallint, '{}', null::smallint, null)`, [mT]));
ok("11 oyuncu aranamaz", await fails(`select create_listing($1, 11::smallint, '{}', null::smallint, null)`, [mT]));
ok("geçersiz mevki reddedilir", await fails(`select create_listing($1, 2::smallint, array['XXX'], null::smallint, null)`, [mT]));
const L = (await q(`select create_listing($1, 2::smallint, array['GK','DEF'], 70::smallint, 'Kaleci ve defans lazım') id`, [mT]))[0].id;
ok("kaptan ilan açtı", !!L);
ok("aynı maça ikinci açık ilan açılamaz", await fails(`select create_listing($1, 1::smallint, '{}', null::smallint, null)`, [mT]));
ok("rakip takımın maçı için ilan açamaz (başka takımın kaptanı)", await fails(`select create_listing($1, 1::smallint, '{}', null::smallint, null)`, [mO]));
ok("ilan tablosuna doğrudan yazılamaz", await fails(`insert into player_listings (group_id, match_id, created_by, needed) values ($1,$2,$3,1)`, [T, mT, U(1)]));

// --- ilan herkese açık
await as(5);
ok("yabancı ilanı görür (herkese açık)", (await q(`select count(*)::int c from player_listings`))[0].c === 1);

// --- başvuru
await as(2);
ok("takımın oyuncusu başvuramaz", await fails(`select apply_listing($1, 'DEF', null)`, [L]));
await as(7);
ok("rakip kadrodaki oyuncu başvuramaz", await fails(`select apply_listing($1, 'DEF', null)`, [L]));
await as(3);
ok("minimum rating (70) altı (varsayılan 65) başvuramaz", await fails(`select apply_listing($1, 'DEF', null)`, [L]));
await db.exec("reset role");
const C = (await q(`insert into groups (name, created_by) values ('Topluluk C','${U(3)}') returning id`))[0].id;
await db.query(`insert into player_ratings (player_id, overall, raw, confidence, matches_played) select id, 80, 1.2, 0.9, 5 from group_players where group_id=$1 and user_id=$2`, [C, U(3)]);
await db.exec("reset role"); await as(3);
await db.query(`select apply_listing($1, 'DEF', 'Müsaitim')`, [L]);
ok("rating'i yeterli (80) oyuncu başvurdu (topluluktaki rating geçerli)", (await q(`select count(*)::int c from listing_applications where listing_id=$1`, [L]))[0].c === 1);
await db.query(`select apply_listing($1, 'MID', 'Mevki değiştirdim')`, [L]);
ok("tekrar başvuru aynı kaydı günceller", (await q(`select position from listing_applications where listing_id=$1 and user_id=$2`, [L, U(3)]))[0].position === "MID");
await as(4); // u4: rating'i 80 yap
await db.exec("reset role");
const C4 = (await q(`insert into groups (name, created_by) values ('Topluluk D','${U(4)}') returning id`))[0].id;
await db.query(`insert into player_ratings (player_id, overall, raw, confidence, matches_played) select id, 75, 1, 0.8, 4 from group_players where group_id=$1 and user_id=$2`, [C4, U(4)]);
await as(4);
await db.query(`select apply_listing($1, 'GK', null)`, [L]);

// --- başvuru gizliliği
ok("başvuran sadece kendi başvurusunu görür", (await q(`select count(*)::int c from listing_applications`))[0].c === 1);
await as(5);
ok("yabancı başvuruları göremez", (await q(`select count(*)::int c from listing_applications`))[0].c === 0);
await as(2);
ok("normal oyuncu başvuruları göremez", (await q(`select count(*)::int c from listing_applications`))[0].c === 0);
await as(1);
ok("kaptan tüm başvuruları görür", (await q(`select count(*)::int c from listing_applications where listing_id=$1`, [L]))[0].c === 2);

// --- başvuranlar (rating + güvenilirlik) yalnızca takımın yetkilisine
await as(1);
const apps = await q(`select * from listing_applicants($1)`, [L]);
ok("kaptan başvuranları rating ve güvenilirlikle görür (özel gruptaki rating dahil)", apps.length === 2 && apps.find((a) => a.user_id === U(3)).overall === 80 && apps.find((a) => a.user_id === U(4)).overall === 75);
ok("başvuranın seçtiği mevki ve notu gelir", apps.find((a) => a.user_id === U(3)).chosen_position === "MID" && apps.find((a) => a.user_id === U(3)).note === "Mevki değiştirdim");
await as(2);
ok("normal oyuncu başvuranları göremez", (await q(`select * from listing_applicants($1)`, [L])).length === 0);
await as(5);
ok("yabancı başvuranları göremez", (await q(`select * from listing_applicants($1)`, [L])).length === 0);
await as(3);
ok("my_rating: kendi genel ratingim (80)", (await q(`select my_rating() r`))[0].r === 80);

// --- karar
await as(2);
ok("normal oyuncu başvuruyu kabul edemez", await fails(`select decide_application($1,$2,true)`, [L, U(3)]));
await as(3);
ok("başvuran kendini kabul edemez", await fails(`select decide_application($1,$2,true)`, [L, U(3)]));
await as(1);
await db.query(`select decide_application($1,$2,true)`, [L, U(3)]);
const loan = (await q(`select id, is_loan, role from group_players where group_id=$1 and user_id=$2`, [T, U(3)]))[0];
ok("kabul edilen oyuncu 'ödünç' olarak takıma yazıldı", loan.is_loan === true && loan.role === "member");
ok("ödünç oyuncu maç kadrosuna girdi (başvurduğu mevkiyle)", (await q(`select position from match_players where match_id=$1 and player_id=$2`, [mT, loan.id]))[0]?.position === "MID");
ok("ilan hâlâ açık (1/2)", (await q(`select status from player_listings where id=$1`, [L]))[0].status === "open");
await db.query(`select decide_application($1,$2,false)`, [L, U(4)]);
ok("diğer başvuru reddedildi", (await q(`select status from listing_applications where listing_id=$1 and user_id=$2`, [L, U(4)]))[0].status === "rejected");

// --- ödünç oyuncu sızıntıları
await as(3);
ok("ödünç oyuncu takımın üyesi sayılmaz (is_group_member)", (await q(`select is_group_member($1) m`, [T]))[0].m === false);
ok("ödünç oyuncu takım sohbetini okuyamaz", (await q(`select count(*)::int c from group_messages where group_id=$1`, [T]))[0].c === 0);
ok("ödünç oyuncu takım sohbetine yazamaz", await fails(`insert into group_messages (group_id, author_id, kind, body) values ($1, $2, 'text', 'merhaba')`, [T, loan.id]));
ok("ödünç oyuncunun takım için okunmamış sohbet sayacı yok", (await q(`select group_id from unread_counts() where group_id=$1`, [T])).length === 0);
await as(1);
const poll = (await q(`insert into match_polls (group_id, created_by, starts_at, capacity) values ($1,$2, ${future}, 10) returning id`, [T, U(1)]))[0].id;
await as(3);
ok("ödünç oyuncu takım çağrısına yanıt veremez", await fails(`select respond_poll($1,'yes')`, [poll]));
ok("ödünç oyuncu takım çağrısını göremez", (await q(`select count(*)::int c from match_polls where group_id=$1`, [T]))[0].c === 0);
ok("ödünç oyuncu takım teklifini göremez", (await q(`select count(*)::int c from match_challenges`))[0].c === 0);
await as(2);
ok("normal üye sohbeti görür (karşılaştırma)", (await q(`select count(*)::int c from group_messages where group_id=$1`, [T]))[0].c >= 1);
await as(1);
ok("yetkili ödünç oyuncuya yetki veremez (set_member_role)", await fails(`select set_member_role($1,'admin')`, [loan.id]));
await db.exec("reset role");
ok("tetikleyici: ödünç oyuncuya doğrudan da yetki verilemez", await fails(`update group_players set role='admin' where id=$1`, [loan.id]));
ok("ödünç oyuncu hesapsız olamaz (kısıt)", await fails(`insert into group_players (group_id, display_name, is_loan) values ($1,'X',true)`, [T]));
await as(1);
await as(3);
ok("ödünç oyuncu maç kadrosunu görür (takım herkese açık)", (await q(`select count(*)::int c from match_players where match_id=$1`, [mT]))[0].c >= 1);

// --- ilan dolunca / sınır
await as(4);
ok("reddedilen başvuran tekrar başvuramaz", await fails(`select apply_listing($1,'GK',null)`, [L]));
await db.exec("reset role"); await as(5);
await db.exec("reset role");
const C5 = (await q(`insert into groups (name, created_by) values ('Topluluk E','${U(5)}') returning id`))[0].id;
await db.query(`insert into player_ratings (player_id, overall, raw, confidence, matches_played) select id, 90, 2, 0.9, 6 from group_players where group_id=$1 and user_id=$2`, [C5, U(5)]);
await as(5);
await db.query(`select apply_listing($1,'GK','Kaleciyim')`, [L]);
await as(5);
await db.query(`select withdraw_application($1)`, [L]);
ok("başvuran başvurusunu geri çekebilir", (await q(`select status from listing_applications where listing_id=$1 and user_id=$2`, [L, U(5)]))[0].status === "withdrawn");
await db.query(`select apply_listing($1,'GK','Kaleciyim')`, [L]);
ok("geri çeken tekrar başvurabilir", (await q(`select status from listing_applications where listing_id=$1 and user_id=$2`, [L, U(5)]))[0].status === "pending");
await as(1);
await db.query(`select decide_application($1,$2,true)`, [L, U(5)]);
ok("gereken sayıya ulaşınca ilan 'filled' oldu (2/2)", (await q(`select status from player_listings where id=$1`, [L]))[0].status === "filled");
await as(2);
ok("dolmuş ilana başvurulamaz", await fails(`select apply_listing($1,'DEF',null)`, [L]));

// --- ödünç oyuncu davet koduyla katılırsa kalıcı üye olur
await as(3);
await db.query(`select join_group($1)`, [codeT]);
const up = (await q(`select is_loan from group_players where id=$1`, [loan.id]))[0];
ok("davet koduyla katılan ödünç oyuncu kalıcı üye oldu", up.is_loan === false && (await q(`select is_group_member($1) m`, [T]))[0].m === true);

// --- gelmedi / güvenilirlik
await as(1);
const u5gp = await gp(5, T);
await as(2);
ok("normal oyuncu 'gelmedi' işaretleyemez", await fails(`select mark_no_shows($1, array[$2]::uuid[])`, [mT, u5gp]));
await as(1);
await db.query(`select mark_no_shows($1, array[$2]::uuid[])`, [mT, u5gp]);
ok("gelmeyen kadrodan çıkarıldı ve kaydedildi", (await q(`select count(*)::int c from match_players where match_id=$1 and player_id=$2`, [mT, u5gp]))[0].c === 0
  && (await q(`select count(*)::int c from match_no_shows where match_id=$1 and user_id=$2`, [mT, U(5)]))[0].c === 1);
ok("kaptan gelmeyeni görür; yabancı göremez", (await q(`select count(*)::int c from match_no_shows`))[0].c === 1);
await as(4);
ok("başkasının 'gelmedi' kaydı görünmez", (await q(`select count(*)::int c from match_no_shows`))[0].c === 0);
await as(1);
const rel = (await q(`select * from player_reliability($1)`, [U(5)]))[0];
ok("güvenilirlik: 1 gelmedi", rel.no_shows === 1 && rel.played === 0);
await db.exec("reset role");
await db.query(`update matches set status='closed', score_a=1, score_b=0 where id=$1`, [mT]);
await as(1);
const rel3 = (await q(`select * from player_reliability($1)`, [U(3)]))[0];
ok("kapanmış maçta oynayan oyuncunun 'oynadı' sayısı artar (u3: 1 maç, 0 gelmedi)", rel3.played === 1 && rel3.no_shows === 0);
await db.query(`update matches set status='planned' where id=$1`, [mT]).catch(() => {});

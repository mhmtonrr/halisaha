// 0043: maç görünürlüğü, sayaç, ilan (Keşfet/grup, onay), kişiye özel davet, bağlantı kodu, başvuru onayı.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// Topluluk K (özel, maçın sahibi): u1 kurucu, u2 organizatör, u3 üye
// Topluluk L (ilanın paylaşıldığı): u4 kurucu, u2 organizatör, u3 sıradan üye, u5 üye
// u6, u7, u8 yabancı
await as(1);
const K = (await one(`insert into groups (name, created_by, city) values ('Lüleburgaz HS','${U(1)}','Kırklareli') returning id`)).id;
const kc = (await one(`select group_invite_code($1) c`, [K])).c;
for (const n of [2, 3]) { await as(n); await db.query(`select join_group($1)`, [kc]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where group_id=$1 and user_id=$2), 'organizer')`, [K, U(2)]);
await as(4);
const L = (await one(`insert into groups (name, created_by, city) values ('Pazar Grubu','${U(4)}','Kırklareli') returning id`)).id;
const lc = (await one(`select group_invite_code($1) c`, [L])).c;
for (const n of [2, 3, 5]) { await as(n); await db.query(`select join_group($1)`, [lc]); }
await as(4);
await db.query(`select set_member_role((select id from group_players where group_id=$1 and user_id=$2), 'organizer')`, [L, U(2)]);

// u1 maç ayarlar: 5v5 kendi aramızda, kapasite 4, kendisi + u3 → 2/4
await as(1);
const M = (await one(`select create_match_v2($1, current_date + 3, null, 5::smallint, 'internal', null, null, null, 4::smallint, true, $2::uuid[]) id`, [K, [U(3)]])).id;
const M2 = (await one(`select create_match_v2($1, current_date + 4, null, 5::smallint, 'internal') id`, [K])).id;
const sees = async (n, m = M) => { await as(n); return (await q(`select 1 from matches where id=$1`, [m])).length === 1; };
const counts = async () => { await db.exec("reset role"); return one(`select roster_count, reserve_count from matches where id=$1`, [M]); };

ok("sayaç: kadro 2", (await counts()).roster_count === 2);
ok("yabancı özel grubun maçını görmez", !(await sees(6)));
ok("başka grubun üyesi de görmez", !(await sees(5)));

// --- İlan
await as(3);
ok("sıradan üye ilan açamaz", await fails(`select create_listing($1)`, [M]));
await as(2);
ok("ilan maçın kendi grubuna açılmaz", await fails(`select create_listing($1, $2)`, [M, K]));
await as(8);
const N = (await one(`insert into groups (name, created_by) values ('Başka','${U(8)}') returning id`)).id;
await as(2);
ok("üyesi olmadığı gruba ilan açılmaz", await fails(`select create_listing($1, $2)`, [M, N]));
const LL = (await one(`select create_listing($1, $2, '{FWD}', 'Forvet lazım') id`, [M, L])).id;
ok("hedef grupta organizatör → ilan direkt aktif", (await one(`select status from match_listings where id=$1`, [LL])).status === "active");
ok("aynı yere ikinci ilan açılmaz", await fails(`select create_listing($1, $2)`, [M, L]));
ok("grup ilanıyla o grubun üyesi maçı görür", await sees(5));
ok("grup ilanıyla dışarıdaki yabancı görmez", !(await sees(6)));
await as(5);
ok("ilanı gören kadroyu görür", (await q(`select 1 from match_players where match_id=$1`, [M])).length === 2);
ok("ilanı gören kadrodakilerin oyuncu satırını görür", (await q(`select display_name from group_players where group_id=$1`, [K])).length === 2);
ok("ilanı gören grubun adını görür", (await q(`select name from groups where id=$1`, [K])).length === 1);
ok("ilanı gören grubun diğer maçını görmez", !(await sees(5, M2)));
await as(5);
ok("özet: ilanı gören sayaç ve mevkiyi alır", (await one(`select roster_count, capacity, positions from match_overview($1)`, [[M]])).positions.join() === "FWD");

// Sıradan üyenin başka gruba ilanı onaya düşer: u1 L'ye üye olur (sıradan)
await as(1);
await db.query(`select join_group($1)`, [lc]);
await db.query(`select close_listing($1)`, [LL]);
ok("ilan kapanınca grup üyesi artık görmez", !(await sees(5)));
await as(1);
const LP = (await one(`select create_listing($1, $2) id`, [M, L])).id;
ok("hedef grupta sıradan üye → ilan onay bekler", (await one(`select status from match_listings where id=$1`, [LP])).status === "pending");
ok("onay bekleyen ilanla grup üyesi maçı görmez", !(await sees(5)));
await as(5);
ok("üye ilanı onaylayamaz", await fails(`select decide_listing($1, true)`, [LP]));
await as(2);
ok("organizatör (yetkili değil) ilanı onaylayamaz", await fails(`select decide_listing($1, true)`, [LP]));
await as(4);
ok("grubun kurucusu bekleyen ilanı görür", (await q(`select 1 from match_listings where id=$1`, [LP])).length === 1);
await db.query(`select decide_listing($1, true)`, [LP]);
ok("onaylanınca grup üyesi görür", await sees(5));

// Keşfet ilanı
await as(1);
const LK = (await one(`select create_listing($1) id`, [M])).id;
ok("Keşfet ilanı direkt aktif ve herkes görür", (await one(`select status from match_listings where id=$1`, [LK])).status === "active" && (await sees(6)));
await as(6);
ok("Keşfet listesinde maç var", (await q(`select * from open_listings('Kırklareli')`)).some((r) => r.match_id === M));
ok("başka il süzgecinde yok", (await q(`select * from open_listings('İstanbul')`)).length === 0);
ok("yabancı yedek/başvuru kayıtlarını görmez, kadro kayıtlarını görür", (await q(`select status from match_entries where match_id=$1`, [M])).every((r) => r.status === "in"));

// --- Başvuru (ilandan)
await as(6);
ok("yabancı doğrudan 'geliyorum' diyemez", await fails(`select respond_match($1, 'yes')`, [M]));
ok("ilansız/kodsuz başvuru reddedilir", await fails(`select apply_match($1)`, [M]));
ok("ilandan başvuru → onay bekler", (await one(`select apply_match($1, $2, null, 'FWD', 'Gelirim') r`, [M, LK])).r === "pending");
ok("bekleyen başvuru tekrar edilemez", await fails(`select apply_match($1, $2)`, [M, LK]));
ok("bekleyen başvurucu 'geliyorum' diyemez", await fails(`select respond_match($1, 'yes')`, [M]));
await as(3);
ok("kadrodaki üye başvuruya karar veremez", await fails(`select decide_application($1, $2, true)`, [M, U(6)]));
await as(1);
ok("kabul → kadro (ödünç)", (await one(`select decide_application($1, $2, true) r`, [M, U(6)])).r === "in");
ok("ödünç satır açıldı", (await one(`select is_loan from group_players where group_id=$1 and user_id=$2`, [K, U(6)])).is_loan === true);
ok("sayaç 3", (await counts()).roster_count === 3);
await as(6);
ok("kadroya giren yabancı ilan kapansa da maçı görür", (await db.exec(`reset role; update match_listings set status='closed' where match_id='${M}'`), await sees(6)));

// --- Kişiye özel davet
await as(3);
ok("kadrodaki oyuncu arkadaşını çağırır → onaya düşer", (await one(`select invite_to_match($1, $2) r`, [M, U(7)])).r === "pending");
ok("çağrılan maçı görür", await sees(7));
await as(7);
ok("onay bekleyen çağrılan 'geliyorum' diyemez", await fails(`select respond_match($1, 'yes')`, [M]));
await as(1);
ok("yöneten aynı kişiyi çağırınca davet onaysız olur", (await one(`select invite_to_match($1, $2) r`, [M, U(7)])).r === "invited");
await as(7);
ok("davetli 'geliyorum' → son yer kadro", (await one(`select respond_match($1, 'yes') r`, [M])).r === "in");
ok("sayaç 4/4", (await counts()).roster_count === 4);
await as(5);
ok("kadroda olmayan, yöneten olmayan çağıramaz", await fails(`select invite_to_match($1, $2)`, [M, U(8)]));

// --- Bağlantı kodu
await as(3);
ok("üye kodu alamaz", await fails(`select match_invite_code($1)`, [M]));
await as(1);
const code = (await one(`select match_invite_code($1) c`, [M])).c;
ok("yöneten kodu alır (aynı kod tekrar döner)", code.length === 8 && (await one(`select match_invite_code($1) c`, [M])).c === code);
await as(8);
ok("kod sütunu doğrudan okunamaz", (await q(`select * from match_codes`)).length === 0);
ok("kodsuz yabancı maçı görmez", !(await sees(8)));
const byCode = (await one(`select match_by_code($1) j`, [code.toLowerCase()])).j;
ok("kodla maç özeti + kadro gelir (küçük harf de olur)", byCode.match_id === M && byCode.roster.length === 4 && byCode.capacity === 4);
ok("yanlış kod boş döner", (await one(`select match_by_code('YANLIS00') j`)).j === null);
ok("kodla başvuru → onay bekler", (await one(`select apply_match($1, null, $2) r`, [M, code])).r === "pending");
await as(1);
ok("dolu kadroda kabul → yedek", (await one(`select decide_application($1, $2, true) r`, [M, U(8)])).r === "reserve");
ok("sayaç: yedek 1", (await counts()).reserve_count === 1);
await as(1);
const code2 = (await one(`select match_invite_code($1, true) c`, [M])).c;
await as(5);
ok("yenilenen koddan sonra eski kod geçersiz", code2 !== code && (await one(`select match_by_code($1) j`, [code])).j === null);

// --- Ret ve geri çekme
await as(5);
const L2 = (await (async () => { await as(1); return (await one(`select create_listing($1) id`, [M])).id; })());
await as(5);
await db.query(`select apply_match($1, $2)`, [M, L2]);
await db.query(`select cancel_application($1)`, [M]);
ok("başvuru geri çekilir", (await q(`select 1 from match_entries where match_id=$1 and user_id=$2`, [M, U(5)])).length === 0);
await db.query(`select apply_match($1, $2)`, [M, L2]);
await as(1);
ok("ret → rejected", (await one(`select decide_application($1, $2, false) r`, [M, U(5)])).r === "rejected");
await as(5);
ok("reddedilen tekrar başvuramaz", await fails(`select apply_match($1, $2)`, [M, L2]));

// --- Maç bitince ilanlar kapanır
await as(1);
await db.query(`select cancel_match($1)`, [M]);
await db.exec("reset role");
ok("iptalde ilanlar kapanır", (await q(`select 1 from match_listings where match_id=$1 and status in ('pending','active')`, [M])).length === 0);
await as(2);
ok("ilana doğrudan yazma yok", await fails(`insert into match_listings (match_id, status) values ($1, 'active')`, [M2]));

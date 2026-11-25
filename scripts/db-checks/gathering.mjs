// 0042: tek maç kaydı — toplanma, kapasite/yedek, misafir, kesinleştir, ertele, iptal.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// Takım T: u1 kaptan, u2 organizatör, u3-u6 üye; u7 yabancı
await as(1);
const T = (await one(`insert into groups (name, created_by, kind, city) values ('Kartallar','${U(1)}','team','Kırklareli') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [T])).c;
for (const n of [2, 3, 4, 5, 6]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where group_id=$1 and user_id=$2), 'organizer')`, [T, U(2)]);

const day = `current_date + 3`;
const status = async (m) => (await one(`select status::text s from matches where id=$1`, [m])).s;
const roster = async (m) => (await one(`select count(*)::int c from match_players where match_id=$1`, [m])).c;
const entry = async (m, n) => (await one(`select status from match_entries where match_id=$1 and user_id=$2`, [m, U(n)]))?.status;
const create = (args) => `select create_match_v2($1, ${day}, ${args}) id`;

// --- Açma
await as(3);
ok("üye maç ayarlayamaz", await fails(create(`time '21:00', 5::smallint, 'external'`), [T]));
await as(2);
ok("takım kendi aramızda oynayamaz", await fails(create(`time '21:00', 5::smallint, 'internal'`), [T]));
ok("organizatör misafir ekleyemez", await fails(`select create_match_v2($1, ${day}, null, 5::smallint, 'external', null, null, null, null, true, '{}', '[{"name":"Ali"}]')`, [T]));
// Onur senaryosu: kaptan, 3 kişilik kadro (5'lik), saat belli değil; kendisi + kesin gelen u3 + misafir
await as(1);
const M = (await one(`select create_match_v2($1, ${day}, null, 5::smallint, 'external', null, 'Saha', 'not', 4::smallint, true, $2::uuid[], '[{"name":"Çağatay arkadaşı","position":"FWD"}]') id`, [T, [U(3)]])).id;
ok("eksik kadro ile maç toplanıyor açılır", (await status(M)) === "gathering");
ok("kurucu, kesin gelen ve misafir kadroda (3/4)", (await roster(M)) === 3);
ok("kesin gelen 'organizer' kaynağıyla kayıtlı", (await one(`select source from match_entries where match_id=$1 and user_id=$2`, [M, U(3)])).source === "organizer");
ok("misafir kayıtta 'guest'", (await q(`select 1 from match_entries where match_id=$1 and source='guest' and status='in'`, [M])).length === 1);
ok("rakip belli değilken maç açılabilir", (await one(`select opponent_name from matches where id=$1`, [M])).opponent_name === null);

const D = (await one(`select create_match_v2($1, ${day}, time '20:00', 5::smallint, 'external', 'Aslanlar', null, null, 2::smallint, true, $2::uuid[], '[]', false) id`, [T, [U(4)]])).id;
ok("kadro dolu + saat belli → maç direkt kesin", (await status(D)) === "planned");

// --- Yanıt / kapasite / yedek
await as(4);
ok("son yer: üye 'geliyorum' → kadro", (await one(`select respond_match($1, 'yes', 'MID') r`, [M])).r === "in");
await as(5);
ok("kadro dolu: sonraki 'geliyorum' → yedek", (await one(`select respond_match($1, 'yes') r`, [M])).r === "reserve");
await as(6);
await db.query(`select respond_match($1, 'yes')`, [M]);
ok("yedek sırası tutulur", (await q(`select user_id from match_entries where match_id=$1 and status='reserve' order by queued_at`, [M])).map((r) => r.user_id).join() === [U(5), U(6)].join());
ok("kapasite aşılmaz (4/4)", (await roster(M)) === 4);
await as(7);
ok("yabancı yanıt veremez", await fails(`select respond_match($1, 'yes')`, [M]));

// Duyuru kapalı maçta üye yanıt veremez
await as(5);
ok("duyurusuz maçta üye yanıt veremez", await fails(`select respond_match($1, 'yes')`, [D]));

// Toplanırken çıkmak serbest
await as(3);
ok("kesin gelen 'gelemem' diyebilir (toplanırken serbest)", (await one(`select respond_match($1, 'no') r`, [M])).r === "declined");
ok("çıkan kadrodan düşer, kayıt 'declined'", (await roster(M)) === 3 && (await entry(M, 3)) === "declined");
ok("yedek otomatik girmez", (await entry(M, 5)) === "reserve");

// Yönetim
await as(3);
ok("üye yedekten alamaz", await fails(`select manage_entry($1, $2, 'promote')`, [M, U(5)]));
await as(1);
await db.query(`select manage_entry($1, $2, 'promote')`, [M, U(5)]);
ok("kaptan yedekten kadroya alır", (await entry(M, 5)) === "in" && (await roster(M)) === 4);
ok("kadro doluyken yedekten alınamaz", await fails(`select manage_entry($1, $2, 'promote')`, [M, U(6)]));
ok("kadro doluyken misafir eklenemez", await fails(`select add_match_guest($1, 'Veli')`, [M]));
await db.query(`select manage_entry($1, $2, 'remove')`, [M, U(4)]);
ok("kaptan kadrodan çıkarır → 'left'", (await entry(M, 4)) === "left" && (await roster(M)) === 3);
await as(2);
ok("organizatör misafir ekleyemez", await fails(`select add_match_guest($1, 'Veli')`, [M]));
await as(1);
const G2 = (await one(`select add_match_guest($1, 'Veli', 'GK') id`, [M])).id;
ok("kaptan misafir ekler", (await roster(M)) === 4);
await db.query(`select remove_match_guest($1, $2)`, [M, G2]);
ok("misafir çıkarılınca satırı da silinir", (await roster(M)) === 3 && (await q(`select 1 from group_players where id=$1`, [G2])).length === 0);
await db.exec("reset role");
await db.query(`delete from match_players where match_id=$1 and player_id=(select id from group_players where group_id=$2 and user_id=$3)`, [M, T, U(5)]);
ok("eski yoldan kadrodan çıkan 'left' olur (tetikleyici)", (await entry(M, 5)) === "left");
await db.query(`insert into match_players (match_id, player_id, team) values ($1, (select id from group_players where group_id=$2 and user_id=$3), 'A')`, [M, T, U(5)]);
ok("eski yoldan kadroya giren 'in' olur (tetikleyici)", (await entry(M, 5)) === "in");

// Kesinleştir
await as(1);
const at = `(${day} + time '21:00') at time zone 'Europe/Istanbul'`;
ok("rakipsiz kesinleşmez", await fails(`select confirm_match($1, ${at})`, [M]));
await as(3);
ok("üye rakip belirleyemez", await fails(`select set_match_opponent($1, 'Aslanlar')`, [M]));
await as(1);
await db.query(`select set_match_opponent($1, 'Aslanlar')`, [M]);
ok("geçmiş saatle kesinleşmez", await fails(`select confirm_match($1, now() - interval '1 hour')`, [M]));
await db.query(`select confirm_match($1, ${at})`, [M]);
ok("eksik kadroyla da kesinleşir, saat yazılır", (await status(M)) === "planned" && (await one(`select time_tbd from matches where id=$1`, [M])).time_tbd === false);
ok("kesin maç tekrar kesinleştirilemez", await fails(`select confirm_match($1, ${at})`, [M]));

// Kesin maçta çıkış onaylı; ertelemeden sonra 24 saat serbest
await as(5);
ok("kesin maçta 'gelemem' ile çıkılamaz", await fails(`select respond_match($1, 'no')`, [M]));
ok("kesin maçta çekilme isteği bekler", (await one(`select request_withdrawal($1) r`, [M])).r === "pending");
await db.exec(`reset role; update match_withdrawals set status='cancelled' where match_id='${M}'`);
await as(1);
ok("kesin maç saatsiz ertelenemez", await fails(`select reschedule_match($1, ${day} + 1, null)`, [M]));
await db.query(`select reschedule_match($1, ${day} + 1, time '22:00')`, [M]);
await as(5);
ok("ertelemeden sonra 'gelemem' serbest", (await one(`select respond_match($1, 'no') r`, [M])).r === "declined");
await as(4);
ok("yer açılınca kesin maça 'geliyorum' → kadro", (await one(`select respond_match($1, 'yes') r`, [M])).r === "in");

// İptal
await as(3);
ok("üye iptal edemez", await fails(`select cancel_match($1)`, [M]));
await as(1);
await db.query(`select cancel_match($1, 'Saha kapalı')`, [M]);
ok("iptal silmez, durum 'cancelled'", (await status(M)) === "cancelled" && (await one(`select cancel_reason from matches where id=$1`, [M])).cancel_reason === "Saha kapalı");
await as(6);
ok("iptal edilmiş maça yanıt verilemez", await fails(`select respond_match($1, 'yes')`, [M]));
await as(1);
ok("iptal edilmiş maç tekrar iptal edilemez", await fails(`select cancel_match($1)`, [M]));

// Doğrudan yazma yok
ok("match_entries'e doğrudan yazılamaz", await fails(`insert into match_entries (match_id, user_id, status, source) values ($1, $2, 'in', 'member')`, [D, U(1)]));

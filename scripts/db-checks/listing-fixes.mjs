import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (let n = 1; n <= 4; n++) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const future = (h = 72) => `now() + interval '${h} hours'`;

await as(1);
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Takım T','${U(1)}','team','İstanbul') returning id`))[0].id;
await db.exec("reset role");
const mkMatch = async (hours = 72) => (await q(`insert into matches (group_id, played_at, created_by, kind, opponent_name, team_size) values ($1, ${future(hours)}, $2, 'external', 'Rakip', 7) returning id`, [T, U(1)]))[0].id;
const gpOf = async (n) => (await q(`select id from group_players where group_id=$1 and user_id=$2`, [T, U(n)]))[0]?.id;

// --- 1) Mevkisiz başvuran kabul edilir (is_goalkeeper null olmamalı)
const m1 = await mkMatch();
await as(1);
const L1 = (await q(`select create_listing($1, 1::smallint, '{}', null::smallint, null) id`, [m1]))[0].id;
await as(2);
await db.query(`select apply_listing($1, null, null)`, [L1]); // profilinde de mevki yok
await as(1);
await db.query(`select decide_application($1,$2,true)`, [L1, U(2)]);
const row = (await q(`select position, is_goalkeeper from match_players where match_id=$1 and player_id=$2`, [m1, await gpOf(2)]))[0];
ok("mevkisiz başvuran kabul edildi: kaleci değil, mevki boş", row && row.is_goalkeeper === false && row.position === null);
ok("1/1 alınınca ilan doldu", (await q(`select status from player_listings where id=$1`, [L1]))[0].status === "filled");

// --- 7) Ödünç oyuncu kadrodan çıkarılırsa başvuru geri çekilir, dolu ilan yeniden açılır
await db.query(`delete from match_players where match_id=$1 and player_id=$2`, [m1, await gpOf(2)]);
ok("ödünç oyuncu kadrodan çıkarılınca başvurusu 'withdrawn' oldu", (await q(`select status from listing_applications where listing_id=$1 and user_id=$2`, [L1, U(2)]))[0].status === "withdrawn");
ok("dolmuş ilan yeniden açıldı", (await q(`select status from player_listings where id=$1`, [L1]))[0].status === "open");
await as(2);
await db.query(`select apply_listing($1, 'DEF', 'Tekrar')`, [L1]);
ok("çıkarılan oyuncu tekrar başvurabilir", (await q(`select status from listing_applications where listing_id=$1 and user_id=$2`, [L1, U(2)]))[0].status === "pending");

// --- 2) Maç planlanmış olmaktan çıkınca açık ilan kapanır
await db.exec("reset role");
await db.query(`update matches set status='voting', score_a=1, score_b=0 where id=$1`, [m1]);
ok("maç oylamaya geçince açık ilan kapandı", (await q(`select status from player_listings where id=$1`, [L1]))[0].status === "closed");

// --- 2) 5 ilan sınırı sadece planlanmış ve gelecekteki maçları sayar
const ms = [];
for (let i = 0; i < 5; i++) ms.push(await mkMatch(72 + i));
await as(1);
for (const m of ms) await db.query(`select create_listing($1, 1::smallint, '{}', null::smallint, null)`, [m]);
const m6 = await (async () => { await db.exec("reset role"); return mkMatch(200); })();
await as(1);
ok("6. açık ilan reddedilir (5 sınırı)", await fails(`select create_listing($1, 1::smallint, '{}', null::smallint, null)`, [m6]));
await db.exec("reset role");
await db.query(`update matches set status='closed', score_a=1, score_b=0 where id=$1`, [ms[0]]); // oynandı
await as(1);
ok("oynanan maçın ilanı sınırı doldurmaz: yeni ilan açılabilir", (await q(`select create_listing($1, 1::smallint, '{}', null::smallint, null) id`, [m6]))[0].id !== undefined);
await db.exec("reset role");
await db.query(`update matches set played_at = now() - interval '1 day' where id=$1`, [ms[1]]); // tarihi geçti, hâlâ 'planned'
const m7 = await mkMatch(300);
await as(1);
ok("tarihi geçmiş ilan da sınırı doldurmaz", (await q(`select create_listing($1, 1::smallint, '{}', null::smallint, null) id`, [m7]))[0].id !== undefined);
ok("kapanmış ilanlar sayılmadığı için 5 sınırı hâlâ işler (planlı+gelecek: 5)", await fails(`select create_listing($1, 1::smallint, '{}', null::smallint, null)`, [await (async () => { await db.exec("reset role"); const id = await mkMatch(400); await as(1); return id; })()]));

// --- 2) Maç silinince ilan ve başvurular temizlenir (tetikleyici döngü yapmaz)
await db.exec("reset role");
await db.query(`delete from matches where id=$1`, [ms[2]]);
ok("maç silinince ilanı da gider", (await q(`select count(*)::int c from player_listings where match_id=$1`, [ms[2]]))[0].c === 0);

// --- 6) 10 bekleyen başvuru sınırı yeniden başvuruda da geçerli
const listings = [];
for (let i = 0; i < 11; i++) {
  await db.exec("reset role");
  const m = await mkMatch(24 * 5 + i);
  const l = (await q(`insert into player_listings (group_id, match_id, created_by, needed) values ($1,$2,$3,1) returning id`, [T, m, U(1)]))[0].id;
  listings.push(l);
}
await as(3);
for (const l of listings.slice(0, 10)) await db.query(`select apply_listing($1, 'MID', null)`, [l]);
ok("10 bekleyen başvuruya ulaşıldı", (await q(`select count(*)::int c from listing_applications where user_id=$1 and status='pending'`, [U(3)]))[0].c === 10);
ok("11. başvuru reddedilir", await fails(`select apply_listing($1, 'MID', null)`, [listings[10]]));
await db.query(`select withdraw_application($1)`, [listings[0]]);
await db.query(`select apply_listing($1, 'MID', null)`, [listings[10]]);
ok("bir başvuru geri çekilince yenisi alınır (yine 10 bekleyen)", (await q(`select count(*)::int c from listing_applications where user_id=$1 and status='pending'`, [U(3)]))[0].c === 10);
ok("geri çekilen başvurunun yeniden başvurusu sınırı atlayamaz", await fails(`select apply_listing($1, 'DEF', null)`, [listings[0]]));
await db.query(`select apply_listing($1, 'GK', 'güncelledim')`, [listings[1]]);
ok("zaten bekleyen başvuruyu güncellemek sınıra takılmaz", (await q(`select position from listing_applications where listing_id=$1 and user_id=$2`, [listings[1], U(3)]))[0].position === "GK");

// --- 8) player_reliability kaldırıldı
ok("player_reliability fonksiyonu yok", await fails(`select * from player_reliability($1)`, [U(3)]));

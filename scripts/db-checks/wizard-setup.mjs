// 0049: saha ücreti, takım dışı arkadaşı kadroya yazma, bekleyen rakibin görünmesi.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// u1 kaptan, u2 üye, u3 arkadaş (üye değil), u4 yabancı, u5 rakip takımın kaptanı
await as(1);
const T = (await one(`insert into groups (name, created_by, kind, city) values ('Kartallar','${U(1)}','team','Kırklareli') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [T])).c;
await as(2); await db.query(`select join_group($1)`, [code]);
await as(5);
const R = (await one(`insert into groups (name, created_by, kind, city) values ('Aslanlar','${U(5)}','team','Edirne') returning id`)).id;
await as(1); await db.query(`select send_friend_request($1)`, [U(3)]);

const make = (ids, fee = null) =>
  `select create_match_v2($1, current_date + 3, time '21:00', 7::smallint, 'external', p_with_me => true, p_confirmed => '{${ids.map(U).join(",")}}'::uuid[], p_fee => ${fee}) id`;
ok("bekleyen arkadaşlık isteği yetmez", await fails(make([3]), [T]));
await as(3); await db.query(`select send_friend_request($1)`, [U(1)]);
await as(1);
ok("yabancı doğrudan kadroya yazılamaz", await fails(make([4]), [T]));
ok("geçersiz saha ücreti reddedilir", await fails(make([], 0), [T]));
const M = (await one(make([2, 3], 150), [T])).id;
const m = await one(`select fee_per_person, capacity, roster_count from matches where id=$1`, [M]);
ok("saha ücreti kaydedilir", m.fee_per_person === 150);
ok("kadro sayısı formattan gelir (7v7 → 7)", m.capacity === 7);
ok("üye ve arkadaş kadroda (3/7)", m.roster_count === 3);
await as(3);
ok("takım dışı arkadaş maçı görür ve 'gelemem' diyebilir", (await one(`select respond_match($1, 'no') r`, [M])).r === "declined");

await as(1);
await db.query(`select create_challenge_v2($1, $2)`, [M, R]);
await as(3);
const p = await q(`select name from match_pending_rivals($1::uuid[])`, [[M]]);
ok("maçı gören bekleyen rakibin adını görür", p.length === 1 && p[0].name === "Aslanlar");
await as(4);
ok("herkese açık takımın maçında yabancı da rakip adını görür", (await q(`select name from match_pending_rivals($1::uuid[])`, [[M]])).length === 1);

// 0050: ücreti sonradan değiştirme ve davet bağlantısı
await as(2);
ok("üye saha ücretini değiştiremez", await fails(`select set_match_fee($1, 200)`, [M]));
await as(1);
ok("geçersiz ücrete güncellenemez", await fails(`select set_match_fee($1, 0)`, [M]));
await db.query(`select set_match_fee($1, 200)`, [M]);
ok("yöneten ücreti değiştirir, bekleyen teklif notu da güncellenir", (await one(`select fee_per_person f from matches where id=$1`, [M])).f === 200 && (await one(`select fee_note n from match_challenges where from_match_id=$1`, [M])).n === "Kişi başı 200 TL");
const link = (await one(`select match_invite_code($1) c`, [M])).c;
await as(4);
const bc = (await one(`select match_by_code($1) j`, [link])).j;
ok("bağlantıyı açan ücreti ve bekleyen rakibi görür", bc.fee_per_person === 200 && bc.pending_rival === "Aslanlar");
await as(1);
await db.query(`select set_match_fee($1, null)`, [M]);
ok("ücret kaldırılabilir", (await one(`select fee_per_person f from matches where id=$1`, [M])).f === null);

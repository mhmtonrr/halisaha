// 0056/0057: kişiye özel davet ve maça erişim — çıkarma, davet iptali, yeniden davet, reddedilen davet/başvuru.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];
const root = async (sql, args) => { await db.exec("reset role"); return q(sql, args); };
const entry = async (m, n) => (await root(`select status from match_entries where match_id=$1 and user_id=$2`, [m, U(n)]))[0]?.status;
/** Alıcıya giden maç kartları: iptal edilmiş mi (eskiden yeniye) */
const cards = async (m, n) =>
  (await root(`select d.revoked_at is not null r from dm_messages d join dm_threads t on t.id=d.thread_id
                where d.kind='match' and d.match_id=$1 and $2::uuid in (t.user_a, t.user_b) and d.author_id <> $2 order by d.id`, [m, U(n)])).map((x) => x.r);
const sees = async (n, m) => {
  await as(n);
  const a = (await q(`select 1 from matches where id=$1`, [m])).length;
  const b = (await q(`select 1 from match_players where match_id=$1`, [m])).length;
  const c = (await q(`select 1 from match_overview($1)`, [[m]])).length;
  return a === 1 && b > 0 && c === 1;
};
const blind = async (n, m) => {
  await as(n);
  const a = (await q(`select 1 from matches where id=$1`, [m])).length;
  const b = (await q(`select 1 from match_players where match_id=$1`, [m])).length;
  const c = (await q(`select 1 from match_overview($1)`, [[m]])).length;
  return a === 0 && b === 0 && c === 0;
};
const share = (n, m) => db.query(`select share_match_card($1,'match',$2)`, [U(n), m]);
const respond = async (n, m, a) => { await as(n); return (await one(`select respond_match($1,$2) r`, [m, a])).r; };
const move = (m, n, to) => db.query(`select move_roster($1,$2,null,$3)`, [m, U(n), to]);

// Herkese açık takım T: u1 kaptan, u2 üye (kadroda). Dışarıdan: u3-u8
await as(1);
const T = (await one(`insert into groups (name, created_by, kind, city) values ('Takım','${U(1)}','team','Edirne') returning id`)).id;
const tc = (await one(`select group_invite_code($1) c`, [T])).c;
await as(2);
await db.query(`select join_group($1)`, [tc]);
await as(1);
const M = (await one(`select create_match_v2($1, current_date + 3, null, 8::smallint, 'external', null, null, null, null, true, $2::uuid[]) id`, [T, [U(2)]])).id;
const code = (await one(`select match_invite_code($1) c`, [M])).c;
const listing = (await one(`select create_listing($1) id`, [M])).id;

// --- Davet → kabul → çıkarma
await as(1);
await share(3, M);
ok("davetli maçı, kadroyu ve özeti görür", await sees(3, M));
ok("davet kartı geçerli", (await cards(M, 3)).join() === "false");
ok("davetli karttan kabul eder → kadro", (await respond(3, M, "yes")) === "in");
await as(4);
ok("başkası daveti geri çekemez", await fails(`select cancel_match_invite($1,$2)`, [M, U(3)]));
await as(1);
await move(M, 3, "out");
ok("takım dışından çıkarılan 'removed' olur", (await entry(M, 3)) === "removed");
ok("çıkarılan herkese açık takımda bile maçı göremez", await blind(3, M));
ok("çıkarılanın kartı iptal olur", (await cards(M, 3)).join() === "true");
await as(3);
ok("bağlantıdan yalnızca 'blocked' döner", (await one(`select match_by_code($1) j`, [code])).j.blocked === true);
ok("bağlantıyla başvuramaz", await fails(`select apply_match($1, null, $2)`, [M, code]));
ok("ilanla başvuramaz", await fails(`select apply_match($1, $2)`, [M, listing]));
ok("Keşfet listesinde bu maç ona çıkmaz", !(await q(`select * from open_listings()`)).some((r) => r.match_id === M));
ok("'geliyorum' diyemez", await fails(`select respond_match($1,'yes')`, [M]));
await as(8);
ok("ilgisiz kişi Keşfet'te görmeye devam eder", (await q(`select * from open_listings()`)).some((r) => r.match_id === M));
await as(2);
ok("kadrodaki oyuncu çıkarılanı yeniden çağıramaz", await fails(`select invite_to_match($1,$2)`, [M, U(3)]));
await as(1);
ok("yöneten elle kadroya geri yazamaz", await fails(`select move_roster($1,$2,null,'in')`, [M, U(3)]));

// --- Yeniden davet
await as(1);
await share(3, M);
ok("yeniden davet engeli kaldırır", (await entry(M, 3)) === "invited" && (await sees(3, M)));
ok("yeni kart gider, eskisi iptal kalır", (await cards(M, 3)).join() === "true,false");

// --- Gelemem → davet geçerli → geri çekme
ok("davetli 'gelemem' → declined", (await respond(3, M, "no")) === "declined" && (await entry(M, 3)) === "declined");
ok("gelemem diyen görmeye devam eder, kart geçerli", (await sees(3, M)) && (await cards(M, 3)).at(-1) === false);
ok("fikrini değiştirip gelebilir", (await respond(3, M, "yes")) === "in");
ok("kadrodan kendisi çıkarsa 'left'", (await respond(3, M, "no")) === "declined" && (await entry(M, 3)) === "left");
ok("kendisi çıkanın kartı iptal olur", (await cards(M, 3)).at(-1) === true);
await as(3);
ok("kendisi çıkan 'geliyorum' ile geri dönemez", await fails(`select respond_match($1,'yes')`, [M]));
ok("kendisi çıkan yeniden başvurabilir", (await one(`select apply_match($1, null, $2) r`, [M, code])).r === "pending");

await as(1);
await share(4, M);
await respond(4, M, "no");
await as(4);
ok("davetli kendi davetini 'geri çek' ile silemez", await fails(`select cancel_match_invite($1,$2)`, [M, U(4)]));
await as(2);
ok("sıradan üye yönetenin davetini geri çekemez", await fails(`select cancel_match_invite($1,$2)`, [M, U(4)]));
await as(1);
ok("yöneten 'gelemem' diyenin davetini geri çeker → removed", (await one(`select cancel_match_invite($1,$2) r`, [M, U(4)])).r === "removed");
ok("daveti iptal edilen göremez, kartı iptal", (await blind(4, M)) && (await cards(M, 4)).join() === "true");
await as(1);
ok("geri çekilecek davet kalmadı", await fails(`select cancel_match_invite($1,$2)`, [M, U(4)]));

// --- Kadrodaki oyuncunun daveti
await as(2);
await share(5, M);
ok("kadrodaki oyuncunun daveti onaya düşer", (await entry(M, 5)) === "pending" && (await sees(5, M)));
await as(1);
await db.query(`select decide_application($1,$2,false)`, [M, U(5)]);
ok("onaylanmayan davet düşer, kişi engellenmez (0057)", (await entry(M, 5)) === undefined && (await cards(M, 5)).join() === "true");
await as(5);
ok("daveti onaylanmayan kendisi başvurabilir", (await one(`select apply_match($1, null, $2) r`, [M, code])).r === "pending");
await as(1);
await db.query(`select decide_application($1,$2,false)`, [M, U(5)]);
ok("kendi başvurusu reddedilen engellenir", (await entry(M, 5)) === "rejected" && (await blind(5, M)));
await as(5);
ok("reddedilen bağlantıdan da göremez", (await one(`select match_by_code($1) j`, [code])).j.blocked === true);

await as(2);
await share(6, M);
await as(2);
ok("gönderen onay bekleyen davetini geri çeker → silinir", (await one(`select cancel_match_invite($1,$2) r`, [M, U(6)])).r === "deleted");
ok("geri çekilen davetin kartı iptal", (await cards(M, 6)).join() === "true");

// --- Yedekten çıkarma
await as(1);
const R = (await one(`select create_match_v2($1, current_date + 4, null, 5::smallint, 'external', null, null, null, 2::smallint, true, $2::uuid[]) id`, [T, [U(2)]])).id;
await share(7, R);
ok("dolu kadroda kabul → yedek", (await respond(7, R, "yes")) === "reserve");
await as(1);
await move(R, 7, "out");
ok("yedekten çıkarılan dış oyuncu 'removed'", (await entry(R, 7)) === "removed" && (await blind(7, R)));

// --- 0058: takımın açık maçı (ilansız) yalnızca ilgililere
ok("davetsiz yabancı takımın açık maçını göremez", await blind(8, R));
await as(1);
await share(6, R);
ok("ilansız takım maçında davetli görür", await sees(6, R));
ok("yedekten kendisi çıkan dış oyuncu 'left'", (await respond(6, R, "yes")) === "reserve" && (await respond(6, R, "no")) === "declined" && (await entry(R, 6)) === "left");
ok("kendisi çıkan takım maçını artık göremez", await blind(6, R));

// --- Üye etkilenmez
await as(1);
await move(M, 2, "out");
ok("üye çıkarılınca 'left', maçı görür", (await entry(M, 2)) === "left" && (await sees(2, M)));
ok("üye yeniden gelebilir", (await respond(2, M, "yes")) === "in");

// --- Misafir tamamen silinir
await as(1);
const G = (await one(`select add_match_guest($1,'Misafir Ali') id`, [M])).id;
await db.query(`select move_roster($1,null,$2,'out')`, [M, G]);
ok("misafir kadro dışına alınınca maçtan silinir", (await root(`select 1 from match_entries where player_id=$1`, [G])).length === 0 && (await root(`select 1 from group_players where id=$1`, [G])).length === 0);

// --- Kesin maçta davet; özel grupta erişim
await as(8);
const K = (await one(`insert into groups (name, created_by) values ('Özel','${U(8)}') returning id`)).id;
const P = (await one(`select create_match_v2($1, current_date + 3, time '21:00', 5::smallint, 'internal') id`, [K])).id;
await db.exec(`reset role; update matches set status='planned', time_tbd=false where id='${P}'`);
ok("maç kesin", (await root(`select status::text s from matches where id=$1`, [P]))[0].s === "planned");
ok("davetsiz yabancı özel grubun maçını göremez", await blind(3, P));
await as(8);
await share(3, P);
ok("kesin maçta davetli görür", await sees(3, P));
ok("kesin maçta davetli 'gelemem' diyebilir", (await respond(3, P, "no")) === "declined");
ok("sonra kabul eder → kadro", (await respond(3, P, "yes")) === "in");
await as(3);
ok("kadrodaki dış oyuncu çekilme isteği gönderir", (await one(`select request_withdrawal($1,'Hastayım') r`, [P])).r === "pending");
await as(8);
await db.query(`select decide_withdrawal(id, true) from match_withdrawals where match_id=$1`, [P]);
ok("onaylı çekilmede erişim biter, kart iptal", (await entry(P, 3)) === "left" && (await blind(3, P)) && (await cards(P, 3)).at(-1) === true);

// --- Maç silinirken tetikleyici sorun çıkarmaz
await db.exec("reset role");
ok("davet kartlı maç silinebilir", await db.query(`delete from matches where id=$1`, [R]).then(() => true, (e) => (console.log(e.message), false)));

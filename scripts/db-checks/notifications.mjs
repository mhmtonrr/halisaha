import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

// Sunucu (servis anahtarı = rol sıfırlanmış) iki kullanıcıya bildirim yazar
await db.exec("reset role");
const ins = (u, type, tag = null) => db.query(`insert into notifications (user_id, type, title, body, url, tag) values ($1,$2,'Başlık','Gövde','/g/x',$3)`, [U(u), type, tag]);
await ins(1, "vote"); await ins(1, "chat", "chat:g1"); await ins(2, "offer");

await as(1);
ok("kullanıcı sadece kendi bildirimlerini görür", (await q(`select count(*)::int c from notifications`))[0].c === 2);
ok("kullanıcı bildirim yazamaz (RLS: yazma politikası yok)", await fails(`insert into notifications (user_id, type, title, url) values ($1,'vote','X','/a')`, [U(1)]));
ok("kullanıcı başkasına bildirim yazamaz", await fails(`insert into notifications (user_id, type, title, url) values ($1,'vote','X','/a')`, [U(2)]));
ok("doğrudan güncelleme/silme etkisiz (okundu RPC ile)", (await db.query(`update notifications set read_at=now()`)).affectedRows === 0 && (await db.query(`delete from notifications`)).affectedRows === 0);
await db.query(`select mark_notifications_read()`);
ok("hepsini okundu işaretle: sadece kendi 2 bildirimi", (await q(`select count(*)::int c from notifications where read_at is not null`))[0].c === 2);
await as(2);
ok("başkasının bildirimi okundu olmadı", (await q(`select count(*)::int c from notifications where read_at is not null`))[0].c === 0);
const mine = (await q(`select id from notifications`))[0].id;
await as(1);
await db.query(`select mark_notifications_read(array[$1]::uuid[])`, [mine]);
await as(2);
ok("başkası benim bildirimimi okundu yapamaz (id verilse de)", (await q(`select count(*)::int c from notifications where read_at is not null`))[0].c === 0);
await db.exec("reset role");
ok("url sadece uygulama içi yol olabilir (// ve dış adres reddedilir)", await fails(`insert into notifications (user_id, type, title, url) values ($1,'vote','X','//evil.com')`, [U(1)])
  && await fails(`insert into notifications (user_id, type, title, url) values ($1,'vote','X','https://evil.com')`, [U(1)]));
ok("geçersiz tür reddedilir", await fails(`insert into notifications (user_id, type, title, url) values ($1,'spam','X','/a')`, [U(1)]));

// --- abonelikler
await as(1);
await db.query(`select save_push_subscription('https://push.example/abc', 'p256', 'authkey', 'UA')`);
ok("kullanıcı cihazını abone eder", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 1);
ok("http (güvensiz) endpoint reddedilir", await fails(`select save_push_subscription('http://push.example/x', 'a', 'b', null)`));
ok("tabloya doğrudan yazılamaz", await fails(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,'https://x/y','a','b')`, [U(1)]));
await as(2);
ok("başkasının aboneliği görünmez", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 0);
await db.query(`select save_push_subscription('https://push.example/abc', 'p256b', 'authb', 'UA2')`);
ok("aynı cihaza başka kullanıcı girince abonelik ona geçer (çift teslim olmaz)", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 1);
await as(1);
ok("eski kullanıcı artık bu cihazın aboneliğini görmez", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 0);
await as(2);
await db.query(`select remove_push_subscription('https://push.example/abc')`);
ok("abonelik kaldırılır", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 0);
for (let i = 0; i < 12; i++) { await db.query(`select save_push_subscription($1, 'p', 'a', null)`, [`https://push.example/d${i}`]); await db.exec("select pg_sleep(0.01)"); }
ok("kullanıcı başına en fazla 10 cihaz tutulur", (await q(`select count(*)::int c from push_subscriptions`))[0].c === 10);
await as(1);
await db.query(`select remove_push_subscription('https://push.example/d11')`);
await as(2);
ok("başkası başkasının aboneliğini silemez", (await q(`select count(*)::int c from push_subscriptions where endpoint='https://push.example/d11'`))[0].c === 1);

// --- tercihler
await as(1);
ok("tercih satırı yoksa (varsayılan) okunamaz; uygulama hepsi açık sayar", (await q(`select count(*)::int c from notification_prefs`))[0].c === 0);
await db.query(`insert into notification_prefs (user_id, chat) values ($1, false)`, [U(1)]);
const p = (await q(`select votes, matches, offers, chat from notification_prefs`))[0];
ok("tercih eklenir: sohbet kapalı, diğerleri varsayılan açık", p.chat === false && p.votes && p.matches && p.offers);
ok("başkası adına tercih yazılamaz", await fails(`insert into notification_prefs (user_id, chat) values ($1, false)`, [U(2)]));
await db.query(`update notification_prefs set chat = true where user_id = $1`, [U(1)]);
ok("kendi tercihini günceller", (await q(`select chat from notification_prefs`))[0].chat === true);
await as(2);
ok("başkasının tercihi görünmez ve güncellenemez", (await q(`select count(*)::int c from notification_prefs`))[0].c === 0
  && (await db.query(`update notification_prefs set chat = false`)).affectedRows === 0);

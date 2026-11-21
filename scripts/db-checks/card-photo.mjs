import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const url = (n, f = "kart.webp?v=1") => `https://abc123.supabase.co/storage/v1/object/public/avatars/${U(n)}/${f}`;

const b = (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='avatars'`))[0];
ok("avatars deposu herkese açık, 512 KB, webp/png", b.public && Number(b.file_size_limit) === 524288 && b.allowed_mime_types.join() === "image/webp,image/png");

// Depo: sadece kendi klasörüne yazar/siler
await as(1);
ok("kendi klasörüne yükler", !(await fails(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U(1)}/kart.webp`])));
ok("başkasının klasörüne yükleyemez", await fails(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U(2)}/kart.webp`]));
ok("kök dizine yükleyemez", await fails(`insert into storage.objects (bucket_id, name) values ('avatars', 'kart.webp')`));
await as(2);
await db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${U(2)}/kart.webp`]);
await as(1);
ok("başkasının dosyasını silemez", (await db.query(`delete from storage.objects where name=$1`, [`${U(2)}/kart.webp`])).affectedRows === 0);
ok("başkasının dosyasını değiştiremez", (await db.query(`update storage.objects set name=$2 where name=$1`, [`${U(2)}/kart.webp`, `${U(1)}/x.webp`])).affectedRows === 0);
ok("kendi dosyasını siler", (await db.query(`delete from storage.objects where name=$1`, [`${U(1)}/kart.webp`])).affectedRows === 1);

// profiles.photo_url: sadece kendi klasöründeki depo adresi
const set = (v) => db.query(`update profiles set photo_url=$2 where id=$1`, [U(1), v]);
await set(url(1));
ok("geçerli adres kaydedilir", (await q(`select photo_url p from profiles where id=$1`, [U(1)]))[0].p === url(1));
for (const v of [url(2), "https://kotu.site/a.webp", url(1, "../x.webp"), url(1).replace("https", "http"), url(1, "a.webp?x=1")])
  ok(`geçersiz adres reddedilir: ${v.slice(-40)}`, await fails(`update profiles set photo_url=$2 where id=$1`, [U(1), v]));
ok("başkasının fotoğrafını değiştiremez", (await db.query(`update profiles set photo_url=null where id=$1`, [U(2)])).affectedRows === 0);

// group_players kopyası
const g = (await q(`insert into groups (name, created_by) values ('Grup A', $1) returning id`, [U(1)]))[0].id;
const gp = async () => (await q(`select photo_url p from group_players where group_id=$1 and user_id=$2`, [g, U(1)]))[0].p;
ok("grup satırına fotoğraf kopyalanır", (await gp()) === url(1));
await set(url(1, "kart.webp?v=2"));
ok("profil değişince group_players eşitlenir", (await gp()) === url(1, "kart.webp?v=2"));
await db.query(`update group_players set photo_url='https://kotu.site/a.webp' where group_id=$1 and user_id=$2`, [g, U(1)]);
ok("group_players.photo_url elle değiştirilemez (profilden gelir)", (await gp()) === url(1, "kart.webp?v=2"));
await set(null);
ok("fotoğraf silinince group_players da boşalır", (await gp()) === null);

import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;

await as(1);
const G = (await q(`insert into groups (name, created_by) values ('Mahalle Grubu','${U(1)}') returning id`))[0].id;
const T = (await q(`insert into groups (name, created_by, kind, city) values ('Kartal Takım','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeG = (await q(`select group_invite_code($1) c`, [G]))[0].c;
const codeT = (await q(`select group_invite_code($1) c`, [T]))[0].c;
ok("yeni gruba okunaklı 10 karakterlik kod verilir (O/0/I/1/L yok)", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/.test(codeG));
ok("takımın kodu da aynı biçimde ve farklı", /^[A-Z2-9]{10}$/.test(codeT) && codeT !== codeG);

await as(2);
ok("küçük harf ve tireyle yazılan kodla katılınır", await db.query(`select join_group($1)`, [codeG.slice(0, 5).toLowerCase() + "-" + codeG.slice(5).toLowerCase()]).then(() => true, () => false));
ok("katılan üye olur", (await q(`select is_group_member($1) m`, [G]))[0].m === true);
await as(3);
ok("boşluklu kodla katılınır", await db.query(`select join_group($1)`, [" " + codeT.slice(0, 5) + " " + codeT.slice(5) + " "]).then(() => true, () => false));
ok("yanlış kod reddedilir", await fails(`select join_group($1)`, ["YANLISKOD1"]));
ok("boş kod reddedilir", await fails(`select join_group($1)`, [""]));

// --- önizleme
await as(3);
const pv = await q(`select * from invite_preview($1)`, [codeG.toLowerCase()]);
ok("önizleme adı, türü ve üye sayısını verir", pv.length === 1 && pv[0].name === "Mahalle Grubu" && pv[0].kind === "community" && pv[0].members === 2 && pv[0].already_member === false);
const pvT = await q(`select * from invite_preview($1)`, [codeT]);
ok("takım önizlemesi ve 'zaten üye' bayrağı", pvT[0].kind === "team" && pvT[0].already_member === true && pvT[0].city === "İstanbul");
ok("yanlış kodun önizlemesi boş", (await q(`select * from invite_preview($1)`, ["NOPENOPE12"])).length === 0);
ok("kod bilgisi önizlemede dönmez (sadece ad/tür/bölge/sayı)", !("invite_code" in pv[0]));

// --- yenileme
await as(1);
const fresh = (await q(`select regenerate_invite($1) c`, [G]))[0].c;
ok("yenilenen kod yeni biçimde ve farklı", /^[A-Z2-9]{10}$/.test(fresh) && fresh !== codeG);
await as(3);
ok("eski kod artık çalışmaz", await fails(`select join_group($1)`, [codeG]));
await as(2);
ok("sıradan üye kodu yenileyemez", await fails(`select regenerate_invite($1)`, [G]));

// --- eski (12 hex) kodlar çalışmaya devam eder
await db.exec("reset role");
await db.query(`update groups set invite_code='a1b2c3d4e5f6' where id=$1`, [T]);
await as(2);
ok("eski 12 karakterli kod hâlâ geçerli (büyük/küçük harf fark etmez)", await db.query(`select join_group($1)`, ["A1B2C3D4E5F6"]).then(() => true, () => false));

// --- ayrılıp koda geri dönüş
await as(2);
await db.query(`select leave_group($1)`, [G]).catch(() => {});
await as(1);
const g2 = (await q(`select group_invite_code($1) c`, [G]))[0].c;
await as(2);
await db.query(`select join_group($1)`, [g2]);
ok("ayrılan üye yeni kodla geri döner", (await q(`select is_group_member($1) m`, [G]))[0].m === true);

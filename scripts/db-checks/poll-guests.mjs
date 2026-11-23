// 0038: maç çağrısına dışarıdan misafir; kesinleştirmede misafir oyuncu olarak kadroya.
import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args))[0];

// Topluluk C: u1 kurucu, u2 organizatör, u3, u4 üye; u5 yabancı
await as(1);
const C = (await one(`insert into groups (name, created_by, city) values ('Topluluk','${U(1)}','İstanbul') returning id`)).id;
const code = (await one(`select group_invite_code($1) c`, [C])).c;
for (const n of [2, 3, 4]) { await as(n); await db.query(`select join_group($1)`, [code]); }
await as(1);
await db.query(`select set_member_role((select id from group_players where group_id=$1 and user_id=$2), 'organizer')`, [C, U(2)]);

await as(2);
const P = (await one(`select create_gather_poll($1, current_date + 2) id`, [C])).id;
const G1 = (await one(`select add_poll_guest($1, ' Ali Dayı ', 'FWD') id`, [P])).id;
ok("organizatör çağrıya misafir ekler (isim kırpılır)", (await one(`select name, position from poll_guests where id=$1`, [G1])).name === "Ali Dayı");
const G2 = (await one(`select add_poll_guest($1, 'Veli') id`, [P])).id;
const G3 = (await one(`select add_poll_guest($1, 'Silinecek') id`, [P])).id;
ok("1 karakterlik isim reddedilir", await fails(`select add_poll_guest($1, 'X')`, [P]));
ok("geçersiz mevki reddedilir", await fails(`select add_poll_guest($1, 'Ahmet', 'XX')`, [P]));
await as(3);
ok("üye misafir ekleyemez", await fails(`select add_poll_guest($1, 'Ahmet')`, [P]));
ok("üye misafiri çıkaramaz", await fails(`select remove_poll_guest($1)`, [G3]));
ok("üye misafirleri görür", (await q(`select * from poll_guests where poll_id=$1`, [P])).length === 3);
ok("doğrudan ekleme yok", await fails(`insert into poll_guests (poll_id, name) values ($1, 'Hile')`, [P]));
await as(5);
ok("yabancı misafirleri göremez", (await q(`select * from poll_guests where poll_id=$1`, [P])).length === 0);
ok("yabancı misafir ekleyemez", await fails(`select add_poll_guest($1, 'Ahmet')`, [P]));
await as(2);
await db.query(`select remove_poll_guest($1)`, [G3]);
ok("organizatör misafiri çıkarır", (await q(`select * from poll_guests where id=$1`, [G3])).length === 0);

// Kesinleştirme: 2 üye + 2 misafir = 4 (kendi aramızda en az 4)
for (const n of [3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P]); }
await as(2);
const when = `(current_date + 2 + time '21:00') at time zone 'Europe/Istanbul'`;
const roster = JSON.stringify([{ user_id: U(3), team: "A" }, { user_id: U(4), team: "B" }]);
const guests = (ids) => JSON.stringify(ids.map(([id, team, gk]) => ({ id, team, gk: !!gk })));
ok("misafirsiz 2 kişiyle kendi aramızda maç kurulamaz", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P, roster]));
ok("aynı misafir iki kez seçilemez", await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb, null, $3::jsonb)`, [P, roster, guests([[G1, "A"], [G1, "B"]])]));
const M = (await one(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb, null, $3::jsonb) id`, [P, roster, guests([[G1, "A"], [G2, "B", true]])])).id;
const mp = await q(`select gp.display_name, gp.user_id, mp.team, mp.is_goalkeeper from match_players mp join group_players gp on gp.id = mp.player_id where mp.match_id=$1 and gp.user_id is null order by gp.display_name`, [M]);
ok("misafirler maça misafir oyuncu olarak yazılır", mp.length === 2 && mp[0].display_name === "Ali Dayı" && mp[0].team === "A" && mp[1].team === "B");
ok("misafire kaleci işareti geçer", mp[1].is_goalkeeper === true);
ok("misafirler topluluğa misafir olarak girer", (await q(`select 1 from group_players where group_id=$1 and user_id is null`, [C])).length === 2);
ok("çağrı misafiri kadroya bağlanır", (await q(`select 1 from poll_guests where poll_id=$1 and player_id is not null`, [P])).length === 2);
ok("kontenjan misafirleri sayar", (await one(`select capacity from match_polls where id=$1`, [P])).capacity === 4);
ok("kesinleşmiş çağrıya misafir eklenemez", await fails(`select add_poll_guest($1, 'Geç Kalan')`, [P]));
ok("kesinleşmiş çağrıdan misafir çıkarılamaz", await fails(`select remove_poll_guest($1)`, [G1]));

// Eski kod (p_guests olmadan) çalışmaya devam eder
const P2 = (await one(`select create_gather_poll($1, current_date + 3) id`, [C])).id;
for (const n of [1, 2, 3, 4]) { await as(n); await db.query(`select respond_poll($1, 'yes')`, [P2]); }
await as(2);
const r4 = JSON.stringify([1, 2, 3, 4].map((n, i) => ({ user_id: U(n), team: i % 2 ? "B" : "A" })));
ok("misafir parametresi olmadan kesinleştirme çalışır", !(await fails(`select finalize_poll($1, ${when}, null, null, 'internal', null, null, $2::jsonb)`, [P2, r4])));

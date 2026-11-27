import { setupDb } from "./migrations.mjs";
const db = await setupDb();
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
for (const n of [1, 2, 3, 4, 5, 6]) await db.exec(`insert into auth.users values ('${U(n)}','u${n}@x','{"full_name":"U${n}"}')`);
const as = async (n) => { await db.exec(`reset role; delete from auth.current; insert into auth.current values ('${U(n)}'); set role authenticated`); };
const ok = (l, c) => console.log((c ? "✓ " : "✗ HATA: ") + l);
const fails = async (sql, args) => { try { await db.query(sql, args); return false; } catch { return true; } };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const future = "now() + interval '3 day'";

// A takımı: kaptan u1, oyuncu u2. B takımı: kaptan u3, yetkili u4, oyuncu u5. u6 yabancı.
await as(1);
const A = (await q(`insert into groups (name, created_by, kind, city) values ('Kartallar','${U(1)}','team','İstanbul') returning id`))[0].id;
const codeA = (await q(`select group_invite_code($1) c`, [A]))[0].c;
await as(3);
const B = (await q(`insert into groups (name, created_by, kind, city) values ('Aslanlar','${U(3)}','team','İstanbul') returning id`))[0].id;
const codeB = (await q(`select group_invite_code($1) c`, [B]))[0].c;
await as(2); await db.query(`select join_group($1)`, [codeA]);
await as(4); await db.query(`select join_group($1)`, [codeB]);
await as(5); await db.query(`select join_group($1)`, [codeB]);
await as(3);
await db.query(`select set_member_role((select id from group_players where user_id=$1), 'admin')`, [U(4)]);
await as(1);
const C = (await q(`insert into groups (name, created_by) values ('Mahalle Grubu','${U(1)}') returning id`))[0].id;

// --- teklif gönderme
await as(2);
ok("normal oyuncu teklif gönderemez", await fails(`select create_challenge($1,$2,${future},'Saha',null,null)`, [A, B]));
await as(6);
ok("yabancı teklif gönderemez", await fails(`select create_challenge($1,$2,${future},'Saha',null,null)`, [A, B]));
await as(1);
ok("kendi takımına teklif gönderemez", await fails(`select create_challenge($1,$1,${future},null,null,null)`, [A]));
ok("topluluk gruba teklif gönderilemez", await fails(`select create_challenge($1,$2,${future},null,null,null)`, [A, C]));
ok("topluluk grubundan teklif gönderilemez", await fails(`select create_challenge($1,$2,${future},null,null,null)`, [C, B]));
ok("geçmiş zamanlı teklif reddedilir", await fails(`select create_challenge($1,$2, now() - interval '1 hour',null,null,null)`, [A, B]));
const ch = (await q(`select create_challenge($1,$2,${future},'Petroller','Yarı yarıya','Maç yapalım mı?') id`, [A, B]))[0].id;
ok("kaptan teklif gönderdi", !!ch);
ok("doğrudan teklif tablosuna yazılamaz", await fails(`insert into match_challenges (from_group_id,to_group_id,created_by,proposed_at) values ($1,$2,$3,${future})`, [A, B, U(1)]));
await db.exec("reset role");
ok("teklif gönderilince karşı takım sohbetine kart düştü", (await q(`select count(*)::int c from group_messages where group_id=$1 and body like '🤝%'`, [B]))[0].c === 1);

// --- görünürlük
await as(6);
ok("yabancı teklifi göremez", (await q(`select count(*)::int c from match_challenges`))[0].c === 0);
await as(5);
ok("karşı takımın oyuncusu teklifi görür", (await q(`select count(*)::int c from match_challenges`))[0].c === 1);
ok("normal oyuncu teklifi yanıtlayamaz", await fails(`select respond_challenge($1,true)`, [ch]));
await as(1);
ok("gönderen takım kendi teklifini kabul edemez", await fails(`select respond_challenge($1,true)`, [ch]));

// --- kabul
await as(4);
const myMatch = (await q(`select respond_challenge($1,true) m`, [ch]))[0].m;
ok("karşı takımın yetkilisi kabul etti", !!myMatch);
ok("iki takımda da birer maç oluştu", (await q(`select count(*)::int c from matches where challenge_id=$1`, [ch]))[0].c === 2);
const ms = await q(`select id, group_id, opponent_name, opponent_group_id, kind, status from matches where challenge_id=$1 order by opponent_name`, [ch]);
ok("maçlar external, rakip adı/takımı doğru", ms.every((m) => m.kind === "external" && m.status === "gathering")
  && ms.find((m) => m.group_id === A).opponent_name === "Aslanlar" && ms.find((m) => m.group_id === B).opponent_group_id === A);
ok("kabul edilmiş teklif tekrar yanıtlanamaz", await fails(`select respond_challenge($1,false)`, [ch]));
await db.exec("reset role");
ok("kabul kartı gönderen takımın sohbetinde, maç kartları ikisinde", (await q(`select count(*)::int c from group_messages where group_id=$1 and body like '✅%'`, [A]))[0].c === 1
  && (await q(`select count(*)::int c from group_messages where body like '📣%' and group_id in ($1,$2)`, [A, B]))[0].c === 2);
await as(4);

// --- eşleşmiş rakip karşı maçı görür; davetsiz yabancı açık maçı görmez (0058)
await as(6);
ok("yabancı eşleşmiş açık maçları göremez (0058)", (await q(`select count(*)::int c from matches where challenge_id=$1`, [ch]))[0].c === 0);
ok("yabancı teklifi yine göremez", (await q(`select count(*)::int c from match_challenges`))[0].c === 0);

// --- kadro: her takım kendi maçına oyuncu ekler
const mA = ms.find((m) => m.group_id === A).id;
const mB = ms.find((m) => m.group_id === B).id;
const gp = async (n, g) => (await q(`select id from group_players where user_id=$1 and group_id=$2`, [U(n), g]))[0].id;
await as(1);
for (const n of [1, 2]) await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [mA, await gp(n, A)]);
ok("A kaptanı rakibin maçına oyuncu ekleyemez", await fails(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [mB, await gp(3, B)]));
await as(3);
for (const n of [3, 4, 5]) await db.query(`insert into match_players (match_id, player_id, team) values ($1,$2,'A')`, [mB, await gp(n, B)]);
await as(1);
ok("A kaptanı rakip kadroyu görür", (await q(`select count(*)::int c from match_players where match_id=$1`, [mB]))[0].c === 3);

// --- iki taraflı onay (0060)
ok("onaysız bağlı maça doğrudan skor/durum yazılamaz (0061)", await fails(`update matches set score_a=5, score_b=3, status='played' where id=$1`, [mA])
  && await fails(`update matches set status='planned' where id=$1`, [mA])
  && await fails(`update matches set confirmed_at=now() where id=$1`, [mA])
  && await fails(`update matches set challenge_id=null where id=$1`, [mA]));
const kickoff = (await q(`select played_at from matches where id=$1`, [mA]))[0].played_at;
const planned = async () => (await q(`select count(*)::int c from matches where challenge_id=$1 and status='planned'`, [ch]))[0].c;
await db.query(`select confirm_match($1, $2)`, [mA, kickoff]);
ok("tek onayla maç kesinleşmez", (await planned()) === 0);
await as(3);
await db.query(`select confirm_match($1, $2)`, [mB, kickoff]);
ok("ikinci onayla iki maç birden kesinleşir", (await planned()) === 2);
await as(1);

// --- skor eşleşmesi
ok("planlanmış maçta eşleştirme yapılamaz", await fails(`select settle_linked_match($1)`, [mA]));
await db.query(`update matches set score_a=5, score_b=3, status='played' where id=$1`, [mA]);
ok("rakip skor girmediyse 'waiting'", (await q(`select settle_linked_match($1) r`, [mA]))[0].r === "waiting");
await as(3);
await db.query(`update matches set score_a=3, score_b=4, status='played' where id=$1`, [mB]);
ok("uyuşmayan skor 'mismatch', oylama açılmadı", (await q(`select settle_linked_match($1) r`, [mB]))[0].r === "mismatch"
  && (await q(`select count(*)::int c from matches where challenge_id=$1 and status='voting'`, [ch]))[0].c === 0);
await as(5);
ok("normal oyuncu eşleştirme tetikleyemez", await fails(`select settle_linked_match($1)`, [mB]));
await as(3);
await db.query(`update matches set score_a=3, score_b=5 where id=$1`, [mB]);
ok("skorlar eşleşince 'settled'", (await q(`select settle_linked_match($1) r`, [mB]))[0].r === "settled");
const st = await q(`select status, voting_deadline from matches where challenge_id=$1`, [ch]);
ok("iki maç da oylamada ve süre konmuş", st.every((m) => m.status === "voting" && m.voting_deadline));
ok("oylamadaki maç iptal edilemez", await fails(`select cancel_challenge($1)`, [ch]));

// --- ret + iptal akışı
await as(1);
const ch2 = (await q(`select create_challenge($1,$2,${future},null,null,null) id`, [A, B]))[0].id;
await as(3);
ok("reddetme", (await q(`select respond_challenge($1,false) m`, [ch2]))[0].m === null
  && (await q(`select status from match_challenges where id=$1`, [ch2]))[0].status === "declined");
await as(1);
const ch3 = (await q(`select create_challenge($1,$2,${future},null,null,null) id`, [A, B]))[0].id;
await as(3);
ok("karşı takım bekleyen teklifi 'geri çekemez' (reddeder)", await fails(`select cancel_challenge($1)`, [ch3]));
await as(1);
await db.query(`select cancel_challenge($1)`, [ch3]);
ok("gönderen bekleyen teklifi geri çekti", (await q(`select status from match_challenges where id=$1`, [ch3]))[0].status === "cancelled");
const ch4 = (await q(`select create_challenge($1,$2,${future},null,null,null) id`, [A, B]))[0].id;
await as(4); await db.query(`select respond_challenge($1,true)`, [ch4]);
await as(1); await db.query(`select cancel_challenge($1)`, [ch4]);
ok("kabul edilmiş teklif iptali iki maçı da silmeden iptal eder (0059)", (await q(`select count(*)::int c from matches where challenge_id=$1 and status='cancelled'`, [ch4]))[0].c === 2
  && (await q(`select status from match_challenges where id=$1`, [ch4]))[0].status === "cancelled");

// --- spam sınırı
for (let i = 0; i < 3; i++) await db.query(`select create_challenge($1,$2,${future},null,null,null)`, [A, B]);
ok("aynı takıma 3'ten fazla bekleyen teklif gönderilemez", await fails(`select create_challenge($1,$2,${future},null,null,null)`, [A, B]));

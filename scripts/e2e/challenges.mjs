// Takımlar arası maç teklifi: teklif → kabul → kadro → skor eşleşmesi → oylama → sonuç → istatistik.
// Canlı Supabase'e karşı çalışır; test kullanıcıları ve takımlarını sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const log = (...a) => console.log("•", ...a);
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

const names = ["Ali Kaptan", "Ayşe Oyuncu", "Berk Kaptan", "Buse Oyuncu", "Can Yabancı"];
const users = []; const groupIds = [];
let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-challenge-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: i % 2 ? "DEF" : "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  // Takımları servis anahtarıyla kur (kurucu tetikleyiciyle kaptan olur), oyuncuları ekle
  const mkTeam = async (name, color, captain, member) => {
    const { data: t, error } = await admin.from("groups").insert({ name, kind: "team", city: "İstanbul", district: "Kadıköy", color, created_by: captain.id }).select("id").single();
    if (error) throw error;
    groupIds.push(t.id);
    await admin.from("group_players").insert({ group_id: t.id, user_id: member.id, display_name: member.name, position: "DEF" });
    return t.id;
  };
  const teamA = await mkTeam("E2E Kartallar", "#e11d48", users[0], users[1]);
  const teamB = await mkTeam("E2E Aslanlar", "#0ea5e9", users[2], users[3]);
  log("iki takım kuruldu:", teamA.slice(0, 8), teamB.slice(0, 8));
  // Ayşe ayrıca bir toplulukta da: rating'i tüm gruplarında aynı olmalı
  const { data: comm } = await admin.from("groups").insert({ name: "E2E Mahalle", kind: "community", created_by: users[0].id }).select("id").single();
  groupIds.push(comm.id);
  await admin.from("group_players").insert({ group_id: comm.id, user_id: users[1].id, display_name: users[1].name });

  browser = await chromium.launch();
  const open = async (u, scale = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const [A1, A2, B1, B2, X] = [await open(users[0], 2), await open(users[1]), await open(users[2], 2), await open(users[3]), await open(users[4])];

  // 1) Yabancı: takım sayfasında "Maç teklif et" görür ama gönderemez (takımı yok)
  await X.goto(`${BASE}/g/${teamB}`);
  check("takımı olmayan ziyaretçi 'Maç teklif et' görür", (await X.locator("text=Maç teklif et").count()) > 0);
  await X.goto(`${BASE}/g/${teamB}/teklif`);
  check("takımı olmayan için form yerine 'takım kur' çağrısı", (await X.locator("text=Takım kur").count()) > 0 && (await X.locator('button:has-text("Teklifi gönder")').count()) === 0);
  await X.goto(`${BASE}/g/${teamB}/teklifler`); await X.waitForURL(new RegExp(`/g/${teamB}$`));
  check("üye olmayan teklif kutusuna giremez", true);

  // 2) Kartal kaptanı teklif gönderir
  await A1.goto(`${BASE}/g/${teamB}/teklif`); await shot(A1, "30-teklif-formu");
  await A1.selectOption('select[name="size"]', "5");
  await A1.fill('input[name="venue"]', "Petroller Halısaha"); await A1.fill('input[name="fee"]', "Saha yarı yarıya");
  await A1.fill('textarea[name="message"]', "Cuma akşamı 7'ye 7 yapalım mı?");
  await A1.click('button:has-text("Teklifi gönder")'); await A1.waitForURL(/teklifler\?sent=1/);
  check("teklif gönderildi, onay mesajı var", (await A1.locator("text=Teklif gönderildi").count()) > 0);
  check("gönderilen listede 'Yanıt bekliyor'", (await A1.locator("text=Yanıt bekliyor").count()) > 0);
  await shot(A1, "31-gonderilen");
  // aynı takıma 4. teklif
  const { data: ch } = await admin.from("match_challenges").select("id, status").eq("from_group_id", teamA);
  check("tek teklif kaydı, pending", ch.length === 1 && ch[0].status === "pending");

  // 3) Aslan oyuncusu teklifi görür ama yanıtlayamaz; kaptan ana sayfada kart görür
  await B2.goto(`${BASE}/g/${teamB}/teklifler`);
  check("oyuncu gelen teklifi görür", (await B2.locator("text=E2E Kartallar").count()) > 0);
  check("oyuncuda Kabul/Reddet düğmesi yok", (await B2.locator('button:has-text("Kabul et")').count()) === 0);
  await B1.goto(BASE + "/");
  check("kaptanın ana sayfasında teklif kartı", (await B1.locator("text=maç teklifi yanıtını bekliyor").count()) > 0);
  await shot(B1, "32-anasayfa-teklif");
  await B1.goto(`${BASE}/g/${teamB}`);
  check("takım sayfasında 'yeni' rozeti", (await B1.locator("text=1 yeni").count()) > 0);

  // 4) Kabul
  await B1.goto(`${BASE}/g/${teamB}/teklifler`); await shot(B1, "33-gelen-teklif");
  await B1.click('button:has-text("Kabul et")'); await B1.waitForURL(/\/m\/[0-9a-f-]+\?kabul=1/);
  const mB = B1.url().match(/\/m\/([0-9a-f-]+)/)[1];
  check("kabulde maç ekranına yönlendi, kadro boş uyarısı", (await B1.locator("text=Kadro boş").count()) > 0);
  const { data: ms } = await admin.from("matches").select("id, group_id, kind, status, opponent_name, opponent_group_id, challenge_id, team_size").eq("challenge_id", ch[0].id);
  check("kişi sayısı (5) iki maça da yazıldı", ms.length === 2 && ms.every((m) => m.team_size === 5));
  check("iki takımda da external maç oluştu", ms.length === 2 && ms.every((m) => m.kind === "external" && m.status === "planned"));
  const mA = ms.find((m) => m.group_id === teamA).id;
  await shot(B1, "34-mac-bos-kadro");
  await B1.goto(`${BASE}/`);
  check("ana sayfada yaklaşan maç kartı (rakibe karşı, kadro 0/5)", (await B1.locator("body").innerText()).includes("0/5"));
  await shot(B1, "34b-ana-sayfa-yaklasan");

  // 5) Kadrolar (her takım kendininkini seçer)
  for (const [page, gid, mid] of [[B1, teamB, mB], [A1, teamA, mA]]) {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`);
    const boxes = page.locator('input[name="playerId"]');
    // Kadro boşken bölüm zaten açık gelir; doluysa özete tıklayıp aç
    if (!(await boxes.first().isVisible())) await page.locator("summary:has-text('Kadroya oyuncu ekle')").click();
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).check({ force: true });
    await page.click('button:has-text("Seçilenleri ekle")'); await page.waitForLoadState("networkidle");
  }
  const { data: rosters } = await admin.from("match_players").select("match_id").in("match_id", [mA, mB]);
  check("her maçta 2 oyuncu (toplu ekleme çalıştı)", rosters.filter((r) => r.match_id === mA).length === 2 && rosters.filter((r) => r.match_id === mB).length === 2);

  const gp = async (uid, gid) => (await admin.from("group_players").select("id").eq("user_id", uid).eq("group_id", gid).single()).data.id;
  // 5b) Diziliş: A1 fareyle sürükle-bırak, B1 dokunarak (seç + yerleştir)
  const openEditor = async (page, gid, mid) => {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`);
    await page.locator("summary:has-text('Diziliş (sürükle-bırak)')").click();
  };
  const lineupJson = async (page) => JSON.parse(await page.locator('input[name="lineup"]').inputValue());
  const box = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const [idAli, idAyse, idBerk] = [await gp(users[0].id, teamA), await gp(users[1].id, teamA), await gp(users[2].id, teamB)];

  await openEditor(A1, teamA, mA);
  check("editörde 5 kişilik dizilişler (2-2, 1-2-1…)", (await A1.locator('[role="radio"]').count()) === 4 && (await A1.locator('[role="radio"]:has-text("2-2")').count()) === 1);
  await A1.locator('[role="radio"]:has-text("1-2-1")').click();
  let lu = await lineupJson(A1);
  check("diziliş seçilince otomatik yerleşti (ikisi de sahada)", Object.values(lu).filter((v) => v !== null).length === 2);
  await shot(A1, "40a-dizilis-editoru");
  // Saha ekranın tamamen görünür olsun (fare koordinatları görünür alanda kalmalı)
  const centerPitch = (page) => page.locator('[data-drop="slot:0"]').evaluate((el) => el.closest(".overflow-hidden").scrollIntoView({ block: "center" }));
  await centerPitch(A1);
  // Ali'nin kartını boş forvet slotuna (slot:4) sürükle
  const aliToken = A1.locator('[data-drop^="slot:"] .cursor-grab:has-text("Ali Kaptan")');
  const target = await box(A1.locator('[data-drop="slot:4"]'));
  const from = await box(aliToken);
  await A1.mouse.move(from.x, from.y); await A1.mouse.down();
  await A1.mouse.move(from.x + 15, from.y - 15, { steps: 4 }); await A1.mouse.move(target.x, target.y, { steps: 10 }); await A1.mouse.up();
  lu = await lineupJson(A1);
  check("sürükle-bırak: Ali forvet slotuna (4) geçti", lu[idAli] === 4);
  // Ayşe'yi Ali'nin üzerine bırak → yer değiştirirler (takas)
  const ayseToken = A1.locator('[data-drop^="slot:"] .cursor-grab:has-text("Ayşe Oyuncu")');
  const f2 = await box(ayseToken), t2 = await box(A1.locator('[data-drop="slot:4"]'));
  await A1.mouse.move(f2.x, f2.y); await A1.mouse.down(); await A1.mouse.move(f2.x + 12, f2.y + 12, { steps: 3 }); await A1.mouse.move(t2.x, t2.y, { steps: 8 }); await A1.mouse.up();
  lu = await lineupJson(A1);
  check("dolu slota bırakınca takas: Ayşe 4'e, Ali Ayşe'nin eski yerine", lu[idAyse] === 4 && lu[idAli] !== null && lu[idAli] !== 4);
  await A1.click('button:has-text("Dizilişi kaydet")'); await A1.waitForURL(/dizilis=1/);
  const { data: lA } = await admin.from("match_players").select("player_id, slot, position, is_goalkeeper").eq("match_id", mA);
  const { data: mrow } = await admin.from("matches").select("formation_a").eq("id", mA).single();
  check("kayıt: formasyon 1-2-1, iki oyuncunun slotu yazıldı", mrow.formation_a === "1-2-1" && lA.every((r) => r.slot !== null) && lA.find((r) => r.player_id === idAyse).slot === 4);
  check("sahaya dizilen oyuncunun mevkisi slot rolü oldu (slot 4 = FWD)", lA.find((r) => r.player_id === idAyse).position === "FWD");
  check("kaleye dizilen oyuncu kaleci işaretlendi", lA.filter((r) => r.slot === 0).every((r) => r.is_goalkeeper && r.position === "GK"));

  await openEditor(B1, teamB, mB);
  await B1.locator('[role="radio"]:has-text("2-2")').click();
  // dokunarak: kartı seç, sonra boş slota dokun
  const berkToken = B1.locator('[data-drop^="slot:"] .cursor-grab:has-text("Berk Kaptan")');
  await berkToken.click();
  await B1.locator('[data-drop="slot:3"]').click();
  lu = await lineupJson(B1);
  check("dokunarak yerleştirme: Berk 3. slota geçti", lu[idBerk] === 3);
  await B1.click('button:has-text("Dizilişi kaydet")'); await B1.waitForURL(/dizilis=1/);
  const { data: mB2 } = await admin.from("matches").select("formation_a").eq("id", mB).single();
  check("B takımı diziliş kaydetti (2-2)", mB2.formation_a === "2-2");

  // Normal oyuncu editörü görmez, herkes iki sahayı görür
  await A2.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("oyuncuda diziliş editörü yok", (await A2.locator("summary:has-text('Diziliş (sürükle-bırak)')").count()) === 0);
  check("oyuncu iki takımın dizilişini görür", (await A2.locator("text=Dizilişler").count()) > 0 && (await A2.locator("text=1-2-1").count()) > 0 && (await A2.locator("text=2-2").count()) > 0);
  await X.goto(`${BASE}/g/${teamB}/m/${mB}`);
  check("yabancı da dizilişleri görür (takımlar herkese açık)", (await X.locator("text=Dizilişler").count()) > 0);
  await shot(X, "40b-dizilisler-gorunum");

  // 6) Ortak ekran: rakip kadro görünür
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("Kartal kaptanı rakip kadroyu karşılaşma kartında görür", (await A1.locator("text=Berk K.").count()) > 0 && (await A1.locator("text=Rakip kadro").count()) === 0);
  check("karşılaşma kartında iki takım", (await A1.locator("text=VS").count()) > 0);
  check("planlanmış maçta sonuç formunda 'gelmedi' kutusu var", (await A1.locator('input[name="noshow"]').count()) > 0);
  await shot(A1, "35-ortak-mac-planli");
  await A2.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("oyuncu rakip kadroyu görür", (await A2.locator("text=Buse O.").count()) > 0);
  check("oyuncuda skor formu yok", (await A2.locator('button:has-text("Skoru kaydet")').count()) === 0);

  // 6b) Geri oku geldiği sayfaya döner (sabit üst sayfaya değil)
  await A1.goto(BASE + "/"); await A1.goto(`${BASE}/g/${teamA}/teklifler`); await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  await A1.click('a[aria-label="Geri"]'); await A1.waitForURL(`${BASE}/g/${teamA}/teklifler`);
  check("geri oku maç ekranından teklifler sayfasına döndü (geldiği yer)", true);
  await A1.click('a[aria-label="Geri"]'); await A1.waitForURL(BASE + "/");
  check("bir sonraki geri ana sayfaya döndü", true);

  // 7) Skor: uyuşmazlık → düzeltme → eşleşme
  const submitScore = async (page, gid, mid, a, b) => {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`);
    const form = page.locator('form:has(input[name="scoreA"])').first();
    if (!(await form.locator('input[name="scoreA"]').isVisible())) await page.locator("summary:has-text('Skoru ve istatistikleri')").click();
    await page.fill('input[name="scoreA"]', String(a)); await page.fill('input[name="scoreB"]', String(b));
    await page.locator('button:has-text("Skoru kaydet")').click(); await page.waitForURL(/skor=/);
    return new URL(page.url()).searchParams.get("skor");
  };
  check("ilk skor: rakip bekleniyor", (await submitScore(A1, teamA, mA, 4, 2)) === "waiting");
  check("bekleme bilgisi görünüyor", (await A1.locator("text=Rakibin skor girmesi bekleniyor").count()) > 0);
  check("skor düzeltme ekranında 'gelmedi' kutusu yok (sadece planlanmış maçta)", (await A1.locator('input[name="noshow"]').count()) === 0);
  await shot(A1, "36-skor-bekleniyor");
  check("uyuşmayan skor: mismatch", (await submitScore(B1, teamB, mB, 2, 3)) === "mismatch");
  check("uyuşmazlık metni iki skoru gösterir", (await B1.locator("text=Skorlar uyuşmuyor").count()) > 0);
  await shot(B1, "37-skor-uyusmuyor");
  const { data: mid1 } = await admin.from("matches").select("status").in("id", [mA, mB]);
  check("uyuşmazken oylama açılmadı", mid1.every((m) => m.status === "played"));
  check("düzeltilmiş skor: settled", (await submitScore(B1, teamB, mB, 2, 4)) === "settled");
  const { data: mid2 } = await admin.from("matches").select("status, voting_deadline").in("id", [mA, mB]);
  check("iki maç da oylamada, süre var", mid2.every((m) => m.status === "voting" && m.voting_deadline));

  // 8) Çapraz oylama: sahadaki herkes kendi dışındaki herkese oy verir (iki takım tek havuz)
  const [a1, a2, b1, b2] = [await gp(users[0].id, teamA), await gp(users[1].id, teamA), await gp(users[2].id, teamB), await gp(users[3].id, teamB)];
  const vote = (m, v, t, s) => ({ match_id: m, voter_id: v, target_id: t, score: s });
  // a2 arayüzden oy verir, diğer üçü servis anahtarıyla
  await admin.from("votes").insert([
    vote(mA, a1, a2, 8), vote(mA, a1, b1, 6), vote(mA, a1, b2, 7),
    vote(mB, b1, b2, 6), vote(mB, b1, a1, 8), vote(mB, b1, a2, 5),
    vote(mB, b2, b1, 9), vote(mB, b2, a1, 6), vote(mB, b2, a2, 7),
  ]);
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("bağlı maçta elle 'oylamayı kapat' düğmesi yok", (await A1.locator('button:has-text("Oylamayı şimdi kapat")').count()) === 0);
  check("oy oranı açıklaması görünür (%60 / %40)", (await A1.locator("text=%60").count()) > 0 && (await A1.locator("text=%40").count()) > 0);
  await A2.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("oy formunda rakip takım oyuncuları da var", (await A2.locator("text=Rakip takım · E2E Aslanlar").count()) > 0 && (await A2.locator('input[type="range"]').count()) === 3);
  await shot(A2, "36b-capraz-oy-formu");
  await A2.click('button:has-text("Oylarımı gönder")'); await A2.waitForURL(/voted=1/);
  const { data: a2votes } = await admin.from("votes").select("target_id").eq("voter_id", a2).eq("match_id", mA);
  check("a2'nin 3 oyu (takım arkadaşı + 2 rakip) kendi maçına yazıldı", a2votes.length === 3 && a2votes.some((v) => v.target_id === b1) && a2votes.some((v) => v.target_id === b2));
  // Herkes oy verdi → iki maç birlikte kapanır
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  const { data: closed } = await admin.from("matches").select("status").in("id", [mA, mB]);
  check("herkes oy verince iki maç birlikte kapandı", closed.every((m) => m.status === "closed"));
  const { data: res } = await admin.from("match_results").select("match_id, is_mvp").in("match_id", [mA, mB]);
  check("iki takımın oyuncuları puanlandı (4 sonuç)", res.length === 4 && res.filter((r) => r.match_id === mA).length === 2);
  check("tek maçın adamı (iki takım arasından)", res.filter((r) => r.is_mvp).length <= 1);

  // 9) Sonuç: iki takımın puanları, rakip puanlar kendi kartlarını etkilemez
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("sonuç ekranında rakip takımın oyuncu puanları", (await A1.locator("text=Rakip takım sonuçları · E2E Aslanlar").count()) > 0 && (await A1.locator("text=Berk Kaptan").count()) > 0);
  await shot(A1, "38-ortak-mac-sonuc");
  const { data: ratedA } = await admin.from("user_ratings").select("user_id").in("user_id", users.slice(0, 4).map((u) => u.id));
  check("4 oyuncunun da rating'i yazıldı", ratedA.length === 4);
  const { data: mine } = await admin.from("user_ratings").select("overall, matches_played").eq("user_id", users[1].id);
  check("oyuncunun tek genel rating satırı var (grup başına kopya yok)", mine.length === 1 && mine[0].matches_played === 1);

  // 10) İstatistik: Kartallar 4-2 kazandı
  await X.goto(`${BASE}/g/${teamA}/istatistik`);
  check("istatistik herkese açık: 1 maç, 1 galibiyet", (await X.locator("text=Takım istatistikleri").count()) > 0 && (await X.locator("text=Galibiyet %").count()) > 0 && (await X.locator("text=%100").count()) > 0);
  check("rakipler listesinde Aslanlar", (await X.locator("text=E2E Aslanlar").count()) > 0);
  await shot(X, "39-istatistik-kartallar");
  await X.goto(`${BASE}/g/${teamB}/istatistik`);
  check("Aslanlar: 1 mağlubiyet, rakip Kartallar", (await X.locator("text=E2E Kartallar").count()) > 0 && (await X.locator("text=%0").count()) > 0);
  await shot(X, "40-istatistik-aslanlar");

  // 11) Kapanmış maç iptal edilemez
  const { error: cancelErr } = await admin.rpc("cancel_challenge", { p_challenge_id: ch[0].id });
  log("(servis anahtarıyla iptal, yetki kontrolü auth.uid yok → bekleneni:)", cancelErr?.message ?? "hata yok");
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  await removeTestUsers(admin, users.map((u) => u.id));
  const { count } = await admin.from("groups").select("id", { count: "exact", head: true }).in("id", groupIds);
  log(`temizlik: ${users.length} kullanıcı, ${groupIds.length} takım silindi (kalan takım: ${count})`);
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

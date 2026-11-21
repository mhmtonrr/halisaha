// Oyuncu arama ilanı: kaptan ilan açar → herkese açık görünür (Keşfet, takım sayfası, ilan sayfası) → oyuncu başvurur →
// kaptan canlı görür ve kabul eder → oyuncu ödünç olarak maç kadrosuna girer (takım üyesi olmaz) → "gelmedi" işaretleme.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const appears = (page, text, timeout = 12000) => page.locator(`text=${text}`).first().waitFor({ timeout }).then(() => true, () => false);

const names = ["Kaan Kaptan", "Mert Oyuncu", "Gökhan Başvuran", "Deniz Düşük", "Yusuf Yabancı"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-listing-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: i === 2 ? "GK" : "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [cap, mem, app, low, out] = users;
  // Takım T: kaptan + bir oyuncu; planlanmış rakip maçı (7 kişilik)
  const T = (await admin.from("groups").insert({ name: "E2E İlan Takımı", kind: "team", city: "İstanbul", district: "Kadıköy", color: "#e11d48", created_by: cap.id }).select("id").single()).data.id;
  groupIds.push(T);
  await admin.from("group_players").insert({ group_id: T, user_id: mem.id, display_name: mem.name, position: "DEF" });
  const gpT = async (u) => (await admin.from("group_players").select("id").eq("group_id", T).eq("user_id", u.id).single()).data.id;
  const mid = (await admin.from("matches").insert({ group_id: T, played_at: new Date(Date.now() + 3 * 864e5).toISOString(), venue: "İlan Sahası", created_by: cap.id, kind: "external", opponent_name: "Rakip FK", team_size: 7 }).select("id").single()).data.id;
  await admin.from("match_players").insert([await gpT(cap), await gpT(mem)].map((id) => ({ match_id: mid, player_id: id, team: "A" })));
  // Başvuranların genel ratingi: app 72, low 60 (kendi özel topluluklarındaki satırlarda)
  for (const [u, overall] of [[app, 72], [low, 60]]) {
    const gid = (await admin.from("groups").insert({ name: `Özel ${u.name}`, created_by: u.id }).select("id").single()).data.id;
    groupIds.push(gid);
    const pid = (await admin.from("group_players").select("id").eq("group_id", gid).eq("user_id", u.id).single()).data.id;
    await admin.from("player_ratings").upsert({ player_id: pid, overall, raw: 0.5, confidence: 0.8, matches_played: 4 });
  }

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [capP, appP, lowP, outP] = [await open(cap), await open(app), await open(low), await open(out)];
  const mark = (p) => p.evaluate(() => { window.__live = 1; });
  const marked = (p) => p.evaluate(() => window.__live === 1);

  // 1) Kaptan ilan açar
  await capP.goto(`${BASE}/g/${T}/m/${mid}`);
  await capP.locator("summary:has-text('Oyuncu arıyoruz')").click();
  await capP.selectOption('select[name="needed"]', "2");
  await capP.fill('input[name="minOverall"]', "65");
  await capP.locator('input[name="positions"][value="GK"]').check();
  await capP.locator('input[name="positions"][value="DEF"]').check();
  await capP.fill('textarea[name="note"]', "Cuma akşamı, kaleci acil lazım!");
  await capP.screenshot({ path: `${SHOTS}/80-ilan-formu.png`, fullPage: true });
  await capP.click('button:has-text("İlanı yayınla")');
  await capP.locator("text=oyuncu aranıyor").first().waitFor({ timeout: 12000 });
  const { data: L } = await admin.from("player_listings").select("id, needed, min_overall, positions, status").eq("match_id", mid).single();
  check("ilan açıldı: 2 oyuncu, min 65, GK+DEF", L.needed === 2 && L.min_overall === 65 && L.positions.sort().join() === "DEF,GK" && L.status === "open");
  check("maç ekranında herkese açık 'oyuncu aranıyor' şeridi", (await capP.locator("a[href^='/ilan/']").count()) > 0);
  await capP.screenshot({ path: `${SHOTS}/81-ilan-acik-kaptan.png`, fullPage: true });

  // 2) Herkese açık: Keşfet, takım sayfası, ilan sayfası (hesabı olan herkes)
  await outP.goto(`${BASE}/kesfet`);
  check("Keşfet'te 'Oyuncu arayan takımlar' bölümünde ilan var", (await outP.locator("text=Oyuncu arayan takımlar").count()) > 0 && (await outP.locator("text=E2E İlan Takımı · 2 oyuncu").count()) > 0);
  await outP.screenshot({ path: `${SHOTS}/82-kesfet-ilan.png`, fullPage: true });
  await outP.goto(`${BASE}/g/${T}`);
  check("takım sayfasında ilan kartı ve 'başvur' çağrısı", (await outP.locator("text=2 oyuncu aranıyor").count()) > 0);
  await outP.goto(`${BASE}/ilan/${L.id}`);
  check("ilan sayfası: kaleci/defans, min rating, not", (await outP.locator("text=Cuma akşamı, kaleci acil lazım!").count()) > 0 && (await outP.locator("text=Min. rating").count()) > 0);
  await outP.screenshot({ path: `${SHOTS}/83-ilan-sayfasi.png`, fullPage: true });

  // 3) Rating'i yetersiz oyuncu başvuramaz
  await lowP.goto(`${BASE}/ilan/${L.id}`);
  check("rating'i düşük oyuncuya uyarı gösterilir, Başvur kapalı", (await lowP.locator("text=en az 65 rating gerekiyor").count()) > 0 && (await lowP.locator('button:has-text("Başvur")').isDisabled()));

  // 4) Kaptan başvuru bekler (açık sayfa), oyuncu başvurur → kaptanın sayfasına canlı düşer
  await capP.goto(`${BASE}/g/${T}/m/${mid}`);
  await capP.locator("summary:has-text('Oyuncu arıyoruz')").click(); // kaptan bölümü açık tutar, başvuru canlı gelir
  await mark(capP);
  await appP.goto(BASE + "/"); await mark(appP);
  await appP.goto(`${BASE}/ilan/${L.id}`);
  await appP.selectOption('select[name="position"]', "GK");
  await appP.fill('textarea[name="note"]', "Müsaitim, kaleciyim.");
  await appP.click('button:has-text("Başvur")');
  await appP.locator("text=Yanıt bekliyor").first().waitFor({ timeout: 12000 });
  check("başvuran durumu 'Yanıt bekliyor' görür", true);
  check("kaptanın açık maç ekranına başvuru canlı düştü (rating + güvenilirlik)", await appears(capP, "Gökhan Başvuran"));
  check("başvuru kartında rating 72 ve 'Yeni' güvenilirlik", (await capP.locator("text=72").count()) > 0 && (await capP.locator("text=Yeni").count()) > 0);
  check("kaptan sayfası tam yenilenmedi", await marked(capP));
  await capP.screenshot({ path: `${SHOTS}/84-basvuru-kaptan.png`, fullPage: true });

  // 5) Kaptan kabul eder → oyuncu ödünç olarak kadroya girer
  await mark(appP);
  await appP.goto(BASE + "/");
  await mark(appP);
  await capP.locator('button:has-text("Kadroya al")').click();
  await capP.locator("text=Kabul edildi").first().waitFor({ timeout: 12000 });
  const loan = (await admin.from("group_players").select("id, is_loan, role, position").eq("group_id", T).eq("user_id", app.id).single()).data;
  check("kabul edilen oyuncu takıma 'ödünç' yazıldı (üye değil)", loan.is_loan === true && loan.role === "member");
  const mp = (await admin.from("match_players").select("position, is_goalkeeper").eq("match_id", mid).eq("player_id", loan.id).single()).data;
  check("maç kadrosuna girdi, başvurduğu mevki (kaleci)", mp.position === "GK" && mp.is_goalkeeper);
  check("1/2 alındı, ilan hâlâ açık", (await admin.from("player_listings").select("status").eq("id", L.id).single()).data.status === "open");
  check("başvuranın ana sayfasına 'seni maça aldı' canlı düştü", await appears(appP, "seni maça aldı"));
  check("ana sayfa tam yenilenmedi", await marked(appP));

  // 6) Ödünç oyuncu takımın üyesi gibi davranmaz
  await appP.goto(`${BASE}/g/${T}`);
  check("ödünç oyuncu takım sohbeti düğmesini görmez", (await appP.locator("text=Takım sohbeti").count()) === 0);
  await appP.goto(`${BASE}/g/${T}/sohbet`);
  check("takım sohbetine girilemez (yönlendirilir)", !appP.url().includes("/sohbet"));
  await appP.goto(`${BASE}/g/${T}/teklifler`);
  check("teklifler sayfasına girilemez", !appP.url().includes("/teklifler"));
  await appP.goto(BASE + "/");
  // Bölge sıralaması herkese açık takımları gösterir; asıl ölçüt: "Takımlarım" bölümü boş (ödünç oyuncu üye sayılmaz)
  check("'Takımlarım' bölümünde bu takım yok (ödünç oyuncu üye sayılmaz)", (await appP.locator("text=Henüz bir takımda değilsin").count()) > 0);

  // 7) Takım sayfasında asıl kadro ile misafir/ödünç ayrı
  await capP.goto(`${BASE}/g/${T}`);
  check("takım başlığı: 2 oyuncu (ödünç saymaz)", (await capP.locator("text=İstanbul · 2 oyuncu").count()) > 0);
  await capP.click('[role="tab"]:has-text("Misafirler")'); await capP.waitForURL(/sekme=misafir/);
  check("Misafirler sekmesinde ödünç oyuncu 'ödünç' etiketiyle", (await capP.locator("text=Gökhan Başvuran").count()) > 0 && (await capP.locator("text=ödünç").count()) > 0);
  await capP.screenshot({ path: `${SHOTS}/85-odunc-misafirler.png`, fullPage: true });

  // 7b) Başvurunun tam akışı: aynı kişi ikinci kez başvuramaz; ilan dolunca kapanır (ikinci oyuncuyu admin ile ekle)
  await admin.from("listing_applications").insert({ listing_id: L.id, user_id: low.id, position: "DEF", status: "pending" });
  await capP.goto(`${BASE}/g/${T}/m/${mid}`);
  const accept = capP.locator('button:has-text("Kadroya al")');
  // Bekleyen başvuru varsa bölüm ilk yüklemede kendiliğinden açılır
  await accept.first().waitFor({ timeout: 6000 }).catch(async () => { await capP.locator("summary:has-text('Oyuncu arıyoruz')").click(); });
  await accept.first().waitFor({ timeout: 12000 });
  await accept.first().click();
  await capP.locator("text=Doldu").first().waitFor({ timeout: 12000 });
  check("2/2 alınınca ilan 'Doldu' oldu", (await admin.from("player_listings").select("status").eq("id", L.id).single()).data.status === "filled");
  await outP.goto(`${BASE}/kesfet`);
  check("dolan ilan Keşfet'ten kalktı", (await outP.locator("text=E2E İlan Takımı · 2 oyuncu").count()) === 0);

  // 8a) Atomiklik: kadroyu 2'nin altına düşürecek "gelmedi" hata verir ve HİÇBİR şeyi değiştirmez
  await capP.goto(`${BASE}/g/${T}/m/${mid}`);
  await capP.fill('input[name="scoreA"]', "3"); await capP.fill('input[name="scoreB"]', "1");
  const nsBoxes = capP.locator('input[name="noshow"]');
  const rosterSize = await nsBoxes.count();
  for (let i = 0; i < rosterSize - 1; i++) await nsBoxes.nth(i).check(); // geriye 1 kişi kalır
  await capP.click('button:has-text("oylamayı başlat")');
  await capP.waitForURL(/error=/);
  check("kalan 2'den azsa hata mesajı", (await capP.locator("main").innerText()).includes("en az 2 oyuncu kalmalı"));
  check("hata durumunda kadro ve 'gelmedi' kayıtları değişmedi (atomik)",
    (await admin.from("match_players").select("player_id").eq("match_id", mid)).data.length === rosterSize
    && (await admin.from("match_no_shows").select("user_id").eq("match_id", mid)).data.length === 0
    && (await admin.from("matches").select("status").eq("id", mid).single()).data.status === "planned");

  // 8) Sonuç girerken "gelmedi": Mert gelmedi → kadrodan çıkar, kayıt tutulur
  await capP.goto(`${BASE}/g/${T}/m/${mid}`);
  await capP.fill('input[name="scoreA"]', "3"); await capP.fill('input[name="scoreB"]', "1");
  await capP.locator(`input[name="noshow"][value="${await gpT(mem)}"]`).check();
  await capP.screenshot({ path: `${SHOTS}/86-sonuc-gelmedi.png`, fullPage: true });
  await capP.click('button:has-text("oylamayı başlat")');
  await capP.locator("text=kişi oy verdi").waitFor({ timeout: 15000 });
  const { data: ns } = await admin.from("match_no_shows").select("user_id").eq("match_id", mid);
  check("gelmeyen oyuncu 'gelmedi' olarak kaydedildi", ns.length === 1 && ns[0].user_id === mem.id);
  check("gelmeyen kadrodan çıkarıldı (oylanmaz)", (await admin.from("match_players").select("player_id").eq("match_id", mid).eq("player_id", await gpT(mem))).data.length === 0);
  check("maç oylamaya geçti", (await admin.from("matches").select("status").eq("id", mid).single()).data.status === "voting");
  check("açık ilan, maç oylamaya geçince kapandı (kısa süre doldu ilanı zaten dolu: durum filled/closed)", ["filled", "closed"].includes((await admin.from("player_listings").select("status").eq("id", L.id).single()).data.status));
  // Ödünç oyuncunun (takım üyesi olmasa da) oy kartı ana sayfasında çıkar
  await appP.goto(BASE + "/");
  check("ödünç oyuncunun ana sayfasında 'oyunu bekliyorlar' (ödünç) kartı var", (await appP.locator("text=Oyunu bekliyorlar").count()) > 0 && (await appP.locator("text=(ödünç)").count()) > 0);
  await appP.locator("text=Oyunu bekliyorlar").first().click();
  await appP.waitForURL(/\/m\//);
  check("karta tıklayınca maç ekranında oy formu açılır", (await appP.locator('input[type="range"]').count()) > 0);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

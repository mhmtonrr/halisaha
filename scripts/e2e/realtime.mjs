// Canlı güncelleme: bir kullanıcının işlemi, başka kullanıcının AÇIK sayfasına yenilenmeden yansır.
// Her sayfaya window.__live işareti konur; işaret duruyorsa sayfa tam yenilenmemiş (sadece sunucu verisi tazelenmiş) demektir.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const WAIT = 12000;
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

const names = ["Ali Kaptan", "Ayşe Oyuncu", "Berk Kaptan", "Buse Oyuncu"];
const users = []; const groupIds = []; let browser;
/** Metin görünene kadar bekler (sayfa yenilenmeden gelmeli) */
const appears = async (page, text, timeout = WAIT) => page.locator(`text=${text}`).first().waitFor({ timeout }).then(() => true, () => false);
const marked = (page) => page.evaluate(() => window.__live === 1);
const mark = (page) => page.evaluate(() => { window.__live = 1; });
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-live-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: i % 2 ? "DEF" : "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  const mkTeam = async (name, captain, member) => {
    const { data: t, error } = await admin.from("groups").insert({ name, kind: "team", city: "İstanbul", district: "Kadıköy", color: "#0ea5e9", created_by: captain.id }).select("id").single();
    if (error) throw error;
    groupIds.push(t.id);
    await admin.from("group_players").insert({ group_id: t.id, user_id: member.id, display_name: member.display ?? "Üye", position: "DEF" });
    return t.id;
  };
  users[1].display = names[1]; users[3].display = names[3];
  const teamA = await mkTeam("Canlı Kartallar", users[0], users[1]);
  const teamB = await mkTeam("Canlı Aslanlar", users[2], users[3]);

  browser = await chromium.launch();
  const open = async (u, w = 390) => {
    const page = await (await browser.newContext({ viewport: { width: w, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [A1, B1, B1home] = [await open(users[0]), await open(users[2]), null];
  const homeB = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await homeB.goto(BASE + "/login"); await homeB.fill('input[type="email"]', users[2].email); await homeB.fill('input[type="password"]', users[2].password);
  await homeB.click('form button:has-text("Giriş yap")'); await homeB.waitForURL(BASE + "/");
  void B1home;

  // B kaptanı iki sayfayı açık bırakır: teklifler ve ana sayfa
  await B1.goto(`${BASE}/g/${teamB}/teklifler`); await mark(B1);
  await mark(homeB);
  check("başlangıçta B'nin teklif kutusu boş", (await B1.locator("text=Canlı Kartallar").count()) === 0);

  // 1) A kaptanı teklif gönderir → B'nin sayfaları yenilenmeden güncellenir
  await A1.goto(`${BASE}/g/${teamB}/teklif`);
  await A1.fill('input[name="venue"]', "Canlı Saha");
  await A1.click('button:has-text("Teklifi gönder")'); await A1.waitForURL(/teklifler\?sent=1/);
  check("gönderen anında kendi teklifler sayfasına düştü", (await A1.locator("text=Teklif gönderildi").count()) > 0);
  check("B'nin açık teklifler sayfasına teklif yenilenmeden düştü", await appears(B1, "Canlı Kartallar"));
  check("sayfa tam yenilenmedi (işaret duruyor)", await marked(B1));
  check("B'nin açık ana sayfasında teklif kartı belirdi", await appears(homeB, "maç teklifi yanıtını bekliyor"));
  check("ana sayfa da tam yenilenmedi", await marked(homeB));
  await B1.screenshot({ path: `${SHOTS}/60-canli-teklif.png`, fullPage: true });

  // 2) B kabul eder → A'nın açık teklifler sayfası güncellenir
  await mark(A1);
  await B1.click('button:has-text("Kabul et")'); await B1.waitForURL(/\/m\/[0-9a-f-]+\?kabul=1/);
  check("A'nın açık sayfasında 'Kabul edildi' yenilenmeden geldi", await appears(A1, "Kabul edildi"));
  check("A sayfası tam yenilenmedi", await marked(A1));
  const { data: ms } = await admin.from("matches").select("id, group_id").in("group_id", [teamA, teamB]);
  const mA = ms.find((m) => m.group_id === teamA).id, mB = ms.find((m) => m.group_id === teamB).id;

  // 3) A maç ekranını açık tutar; B kadro ekleyince A'nın ekranında rakip kadro belirir
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`); await mark(A1);
  check("A'nın maç ekranında rakip kadro henüz boş", (await A1.locator("text=Buse O.").count()) === 0);
  await B1.goto(`${BASE}/g/${teamB}/m/${mB}`);
  const boxes = B1.locator('input[name="playerId"]');
  if (!(await boxes.first().isVisible())) await B1.locator("summary:has-text('Kadroya oyuncu ekle')").click();
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  await B1.click('button:has-text("Seçilenleri ekle")');
  check("A'nın açık maç ekranında rakip oyuncu yenilenmeden göründü", await appears(A1, "Buse O."));
  check("maç ekranı tam yenilenmedi", await marked(A1));
  await A1.screenshot({ path: `${SHOTS}/61-canli-mac.png`, fullPage: true });

  // 4) B maçı iptal eder → A'nın açık maç ekranı kendiliğinden kapanır (maç silindi)
  await B1.goto(`${BASE}/g/${teamB}/teklifler`);
  await B1.click('button:has-text("Maçı iptal et")'); await B1.waitForLoadState("networkidle");
  check("iptalden sonra A'nın açık maç ekranı 'bulunamadı'ya düştü", await appears(A1, "could not be found"));
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

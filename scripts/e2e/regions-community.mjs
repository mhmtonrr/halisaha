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
const users = []; const groupIds = [];
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Ahmet Yılmaz", "Burak Demir", "Can Er", "Doğa Ak", "Ece Su", "Fırat Ay"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error; users.push({ id: data.user.id, email, password });
  }
  const browser = await chromium.launch();
  const login = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  // Dev sunucusunda kendisi yönlendiren sayfaya istemci geçişi takılabiliyor (docs/test.md) → bir kez yenile
  const settle = async (page, re) => { try { await page.waitForURL(re, { timeout: 15000 }); } catch { await page.reload(); await page.waitForURL(re, { timeout: 15000 }); } };
  const P = await login(users[0]); await settle(P, /hosgeldin/);

  // Karşılama: il seçilmeden ilçe kapalı; il değişince ilçe listesi değişir
  const district = P.locator('select[name="district"]');
  log("il seçilmeden ilçe kapalı:", await district.isDisabled() ? "✓" : "HATA");
  await P.selectOption('select[name="city"]', "Ankara");
  const ankara = await district.locator("option").count() - 1;
  await P.selectOption('select[name="city"]', "İstanbul");
  const ist = await district.locator("option").allTextContents();
  log(`Ankara ${ankara} ilçe, İstanbul ${ist.length - 1} ilçe; İstanbul listesinde Çankaya yok:`, !ist.includes("Çankaya") ? "✓" : "HATA");
  await P.selectOption('select[name="district"]', "Kadıköy");
  await P.locator('input[name="position"][value="MID"]').check({ force: true });
  await shot(P, "30-hosgeldin-ilce");
  // Dev sunucusunda karşılamadan sonraki istemci geçişi boş sayfada kalabiliyor (docs/test.md) → bir kez yenile
  await P.click('button:has-text("Devam et")');
  await settle(P, BASE + "/");

  // Sunucu doğrulaması: tarayıcı atlatılıp İstanbul'a Çankaya gönderilirse kabul edilmemeli (il/ilçe Ayarlar > Kişisel bilgiler'de, 0028)
  await P.goto(BASE + "/profil/ayarlar/kisisel");
  await P.evaluate(() => { const s = document.querySelector('select[name="district"]'); const o = document.createElement("option"); o.value = "Çankaya"; s.appendChild(o); s.value = "Çankaya"; });
  await P.click('button:has-text("Kaydet")'); await P.waitForURL(/saved=1/);
  const { data: prof } = await admin.from("profiles").select("city, district").eq("id", users[0].id).single();
  log("sahte ilçe (İstanbul/Çankaya) reddedildi:", prof.district === null ? "✓ ilçe boş kaydedildi" : `HATA (${prof.district})`);

  // Takım ve grup kurma ayrı sayfalar
  await P.goto(BASE + "/takim-kur");
  log("takım kur sayfasında grup seçeneği yok:", (await P.locator("text=Grubu kur").count()) === 0 ? "✓" : "HATA");
  await P.fill('input[name="name"]', "Moda Yıldızları"); await P.selectOption('select[name="city"]', "İstanbul"); await P.selectOption('select[name="district"]', "Kadıköy");
  await shot(P, "31-takim-kur");
  await P.click('button:has-text("Takımı kur")'); await P.waitForURL(/\/g\//); groupIds.push(P.url().split("/g/")[1]);
  await P.goto(BASE + "/grup-kur");
  await P.fill('input[name="name"]', "Moda Futbol Severler"); await P.fill('textarea[name="description"]', "Kadıköy'de hafta içi akşamları top oynamak isteyenlerin topluluğu.");
  await P.selectOption('select[name="city"]', "İstanbul"); await P.selectOption('select[name="district"]', "Kadıköy");
  await shot(P, "32-grup-kur");
  await P.click('button:has-text("Grubu kur")'); await P.waitForURL(/\/g\//); const gid = P.url().split("/g/")[1]; groupIds.push(gid);
  const { data: g } = await admin.from("groups").select("kind, city, district, invite_code").eq("id", gid).single();
  log("grup kaydı:", g.kind, g.city, g.district);
  const B = await login(users[1]); await settle(B, /hosgeldin/);
  await B.selectOption('select[name="city"]', "İstanbul"); await B.locator('input[name="position"][value="GK"]').check({ force: true });
  await B.click('button:has-text("Devam et")'); await settle(B, BASE + "/");
  await B.goto(`${BASE}/join/${g.invite_code}`); await B.waitForURL(/\/g\//);
  await P.goto(`${BASE}/g/${gid}`); await shot(P, "33-topluluk-sayfasi");
  log("topluluk sayfası:", (await P.locator("text=👥 Topluluk").count()) ? "✓ Topluluk etiketi" : "HATA", "|", (await P.locator("text=2 üye").count()) ? "✓ üye şeridi" : "HATA");

  // Keşfet: il/ilçe filtresi. Keşfet en az 5 hesaplı asıl üyesi olan takımı listeler (MIN_LISTED_MEMBERS, 0037) → 4 üye eklenir
  await admin.from("group_players").insert(users.slice(2).map((u, i) => ({ group_id: groupIds[0], user_id: u.id, display_name: "Üye " + i, position: "MID" })));
  await P.goto(BASE + "/kesfet"); await P.selectOption('select[name="ilce"]', "Kadıköy"); await P.waitForURL(/ilce=/);
  log("keşfet Kadıköy filtresi:", (await P.locator("text=Moda Yıldızları").count()) ? "✓ takım listede" : "HATA");
  await P.selectOption('select[name="ilce"]', "Beşiktaş"); await P.waitForURL(/Be%C5%9Fikta%C5%9F|Beşiktaş/);
  log("keşfet Beşiktaş filtresi:", (await P.locator("text=Moda Yıldızları").count()) === 0 ? "✓ takım listede değil" : "HATA");
  await shot(P, "34-kesfet");
  await browser.close();
} finally {
  for (const id of groupIds) await admin.from("groups").delete().eq("id", id);
  await removeTestUsers(admin, users.map((u) => u.id));
  const { data: left } = await admin.from("profiles").select("id").in("id", users.map((u) => u.id));
  log(`temizlendi (kalan test profili: ${left?.length ?? 0})`);
}

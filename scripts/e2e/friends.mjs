// Arkadaşlık: profilden istek, Sosyal sayfasında kabul, arkadaşlar arası istek beklemeden sohbet, bildirimler.
import { createRequire } from "module";
import fs from "fs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const users = []; let browser;
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Ali Arkadaş", "Berk Arkadaş"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  browser = await chromium.launch();
  const login = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/"); return page;
  };
  const [A, B] = [await login(users[0]), await login(users[1])];

  await A.goto(`${BASE}/oyuncu/${users[1].id}`);
  await A.click('button:has-text("Arkadaş ekle")');
  await A.waitForSelector("text=Arkadaşlık isteği gönderildi");
  log("profilden istek gitti ✓");
  await new Promise((r) => setTimeout(r, 1500));

  await B.goto(`${BASE}/sosyal`);
  await B.waitForSelector("text=Arkadaşlık istekleri");
  await B.screenshot({ path: `${SHOTS}/social-request.png` });
  log("B Sosyal sayfasında isteği gördü ✓");
  await B.click('button:has-text("Kabul")');
  await B.waitForSelector("text=Arkadaşlarım (1)");
  log("kabul edince arkadaş listesinde ✓");
  await B.screenshot({ path: `${SHOTS}/social-friends.png` });

  await B.click('button:has-text("Mesaj")');
  await B.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  await B.waitForSelector("text=canlı", { timeout: 15000 });
  await B.fill('textarea[aria-label="Mesaj"]', "Selam arkadaşım"); await B.keyboard.press("Enter");
  await B.waitForSelector("text=Selam arkadaşım");
  log("arkadaşa istek beklemeden yazıldı:", (await B.locator("text=Kabul bekleniyor").count()) === 0 ? "✓" : "HATA");
  await A.goto(`${BASE}/sohbet`);
  log("A'da 'Mesaj istekleri' bölümü yok:", (await A.locator("text=Mesaj istekleri").count()) === 0 ? "✓" : "HATA");

  await A.goto(`${BASE}/oyuncu/${users[1].id}`);
  log("profilde 'Arkadaşsınız' görünüyor:", (await A.locator("text=Arkadaşsınız").count()) === 1 ? "✓" : "HATA");
  const { data: n1 } = await admin.from("notifications").select("type, title").eq("user_id", users[1].id).eq("type", "friend");
  const { data: n2 } = await admin.from("notifications").select("type, title").eq("user_id", users[0].id).eq("type", "friend");
  log("bildirimler (B, A):", JSON.stringify(n1), JSON.stringify(n2));

  await A.click('button:has-text("Arkadaşlıktan çıkar")');
  await A.waitForSelector('button:has-text("Arkadaş ekle")');
  log("arkadaşlıktan çıkılabiliyor ✓");
} finally {
  await browser?.close();
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  log("test kullanıcıları silindi");
}

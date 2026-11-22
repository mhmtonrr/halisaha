// Birebir sohbet: istek akışı, gerçek zamanlı mesajlaşma, gelen kutusu. Test kullanıcılarını sonunda siler.
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
const users = [];
const log = (...a) => console.log("•", ...a);
let browser;
try {
  for (const [i, n] of ["Ali Test", "Berk Test"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  browser = await chromium.launch();
  const login = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/"); return page;
  };
  const [A, B] = [await login(users[0]), await login(users[1])];
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png` });

  await A.goto(`${BASE}/oyuncu/${users[1].id}`);
  await A.click('button:has-text("Mesaj gönder")');
  await A.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  await A.waitForSelector("text=canlı", { timeout: 15000 });
  log("profilden 'Mesaj gönder' konuşmayı açtı ✓");
  await A.fill('textarea[aria-label="Mesaj"]', "Selam, cuma maçına gelir misin?"); await A.keyboard.press("Enter");
  await A.waitForSelector("text=İsteğin gönderildi", { timeout: 10000 });
  log("istek gitti, ikinci mesaj kilitli ✓", (await A.locator('textarea[aria-label="Mesaj"]').isDisabled()) ? "" : "HATA: kilitli değil");

  await B.goto(`${BASE}/sohbet`);
  await B.waitForSelector("text=Mesaj istekleri", { timeout: 10000 });
  log("B gelen kutusunda isteği gördü ✓");
  await shot(B, "dm-inbox-request");
  await B.click("text=Ali Test");
  await B.waitForSelector("text=Kabul et");
  await shot(B, "dm-request");
  await B.click('button:has-text("Kabul et")');
  await B.waitForSelector("text=cuma maçına gelir misin", { timeout: 10000 });
  await B.fill('textarea[aria-label="Mesaj"]', "Gelirim! 👍"); await B.keyboard.press("Enter");
  await A.waitForSelector("text=Gelirim!", { timeout: 10000 });
  log("kabul sonrası A cevabı anında gördü ✓");
  await A.fill('textarea[aria-label="Mesaj"]', "Süper, saat 21:00"); await A.keyboard.press("Enter");
  await B.waitForSelector("text=saat 21:00", { timeout: 10000 });
  log("serbest yazışma ✓");
  await shot(A, "dm-room");
  await A.goto(`${BASE}/sohbet`); await A.waitForSelector("text=Berk Test");
  await shot(A, "dm-inbox");
  const { data: notifs } = await admin.from("notifications").select("type, title").eq("user_id", users[1].id);
  log("B'ye bildirim:", JSON.stringify(notifs));
} finally {
  await browser?.close();
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  log("test kullanıcıları silindi");
}

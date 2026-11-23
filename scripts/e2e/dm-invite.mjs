// Takıma davet: yetkili profilden davet eder, davet edilen sohbette kabul eder; üye olmayan takım sayfasından kaptana yazar.
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
const users = []; let gid, browser;
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Kaptan Test", "Davetli Test", "Yabancı Test"].entries()) {
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
  const [K, D, Y] = [await login(users[0]), await login(users[1]), await login(users[2])];
  await K.goto(BASE + "/grup-kur"); await K.fill('input[name="name"]', "E2E Davet Grubu"); await K.click('button:has-text("Grubu kur")');
  await K.waitForURL(/\/g\//); gid = K.url().split("/g/")[1];

  // Üye olmayan sıradan oyuncu davet kutusu görmez
  await Y.goto(`${BASE}/oyuncu/${users[1].id}`);
  log("yetkisiz kişide davet kutusu yok:", (await Y.locator("text=Takıma / gruba davet et").count()) === 0 ? "✓" : "HATA");

  await K.goto(`${BASE}/oyuncu/${users[1].id}`);
  await K.waitForSelector("text=Takıma / gruba davet et");
  await K.selectOption("#invite-group", { label: "Grup · E2E Davet Grubu" });
  await K.click('button:has-text("Davet gönder")');
  await K.waitForSelector("text=Davet gönderildi");
  log("kaptan profilden davet gönderdi ✓");
  await K.goto(`${BASE}/oyuncu/${users[1].id}`);
  log("bekleyen davet varken aynı gruba tekrar davet kutusu çıkmıyor:", (await K.locator("text=Takıma / gruba davet et").count()) === 0 ? "✓" : "HATA");

  await D.goto(`${BASE}/sohbet`);
  await D.waitForSelector("text=Mesaj istekleri", { timeout: 10000 });
  await D.click("text=Kaptan Test");
  await D.waitForSelector('button:has-text("Katıl")');
  await D.screenshot({ path: `${SHOTS}/invite-card.png` });
  await D.click('button:has-text("Katıl")');
  await D.waitForURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const { data: gp } = await admin.from("group_players").select("id").eq("group_id", gid).eq("user_id", users[1].id).is("left_at", null);
  log("kabul edince gruba üye oldu:", gp?.length === 1 ? "✓" : "HATA");
  const { data: notifs } = await admin.from("notifications").select("type, title").eq("user_id", users[1].id);
  log("davet bildirimi:", JSON.stringify(notifs));
  await new Promise((r) => setTimeout(r, 1500));
  const { data: back } = await admin.from("notifications").select("title").eq("user_id", users[0].id).eq("type", "invite");
  log("kaptana kabul bildirimi:", back?.some((n) => n.title.includes("kabul")) ? "✓" : "HATA " + JSON.stringify(back));

  // Takım sayfasından kaptana yazma
  const { data: team } = await admin.from("groups").insert({ name: "E2E Takım", kind: "team", created_by: users[0].id, city: "İstanbul" }).select("id").single();
  await Y.goto(`${BASE}/g/${team.id}`);
  await Y.click('button:has-text("Kaptana mesaj yaz")');
  await Y.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  log("üye olmayan takım sayfasından kaptana yazabildi ✓");
  await admin.from("groups").delete().eq("id", team.id);
} finally {
  await browser?.close();
  if (gid) await admin.from("groups").delete().eq("id", gid);
  await removeTestUsers(admin, users.map((u) => u.id));
  log("test verileri silindi");
}

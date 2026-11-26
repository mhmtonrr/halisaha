// Sohbet listesi arama/süzgeç + Mesaj kısayolları (üye listesi, Keşfet) + Sosyal'de davet kısayolu.
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
  for (const [i, n] of ["Kapitan Liste", "Zeki Arkadas"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString(), discoverable: true }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const P = await ctx.newPage(); P.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  await P.goto(BASE + "/login"); await P.fill('input[type="email"]', users[0].email); await P.fill('input[type="password"]', users[0].password);
  await P.click('form button:has-text("Giriş yap")'); await P.waitForURL(BASE + "/");
  await P.goto(BASE + "/grup-kur"); await P.fill('input[name="name"]', "Liste Grubu"); await P.click('button:has-text("Grubu kur")');
  await P.waitForURL(/\/g\/[0-9a-f-]{36}$/); gid = P.url().split("/g/")[1];
  await admin.from("group_players").insert({ group_id: gid, user_id: users[1].id, display_name: "Zeki Arkadas", role: "member" });
  const [a, b] = users[0].id < users[1].id ? [users[0].id, users[1].id] : [users[1].id, users[0].id];
  await admin.from("friendships").insert({ user_a: a, user_b: b, status: "accepted", requested_by: users[0].id });

  // Üye listesinden mesaj
  await P.goto(`${BASE}/g/${gid}/players?bolum=oyuncular`);
  await P.locator('li:has-text("Zeki Arkadas") summary').first().click();
  await P.click('button[aria-label="Zeki Arkadas ile mesajlaş"]');
  await P.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  await P.waitForSelector("text=canlı", { timeout: 15000 });
  await P.fill('textarea[aria-label="Mesaj"]', "Liste testi"); await P.keyboard.press("Enter");
  await P.waitForSelector("text=Liste testi");
  log("üye listesindeki 💬 konuşmayı açtı ✓");

  // Sohbet listesi: arama + süzgeç
  await P.goto(`${BASE}/sohbet`); await P.waitForSelector("text=Zeki Arkadas");
  log("liste: grup ve kişi birlikte:", (await P.locator("text=Liste Grubu").count()) && (await P.locator("text=Zeki Arkadas").count()) ? "✓" : "HATA");
  await P.fill('input[aria-label="Sohbetlerde ara"]', "zeki");
  log("arama 'zeki' (büyük/küçük harf fark etmez):", (await P.locator("text=Liste Grubu").count()) === 0 && (await P.locator("text=Zeki Arkadas").count()) ? "✓" : "HATA");
  await P.fill('input[aria-label="Sohbetlerde ara"]', "");
  await P.click('button[role="tab"]:has-text("Gruplar")');
  log("süzgeç Takım/Grup:", (await P.locator("text=Zeki Arkadas").count()) === 0 && (await P.locator("text=Liste Grubu").count()) ? "✓" : "HATA");
  await P.click('button[role="tab"]:has-text("Kişiler")');
  log("süzgeç Kişiler:", (await P.locator("text=Liste Grubu").count()) === 0 && (await P.locator("text=Zeki Arkadas").count()) ? "✓" : "HATA");
  await P.click('button[role="tab"]:has-text("Tümü")'); await P.waitForTimeout(400);
  await P.screenshot({ path: `${SHOTS}/inbox-filters.png` });

  // Sosyal: arkadaş satırında davet kısayolu
  await P.goto(`${BASE}/sosyal`); await P.waitForSelector("text=Zeki Arkadas");
  log("Sosyal'de kaptana davet kısayolu:", (await P.locator('a[aria-label="Zeki Arkadas kişisini davet et"]').count()) === 1 ? "✓" : "HATA");
  await P.screenshot({ path: `${SHOTS}/social-invite-shortcut.png` });

  // Keşfet: sonuç satırında mesaj düğmesi
  await P.goto(`${BASE}/kesfet?sekme=oyuncu`); await P.waitForTimeout(1500);
  const found = await P.locator('button[aria-label$="ile mesajlaş"]').count();
  log("Keşfet sayfasında 💬 düğmeleri:", found, found ? "✓" : "(oyuncu sekmesi/sonuç bulunamadı, ekran görüntüsüne bak)");
  await P.screenshot({ path: `${SHOTS}/kesfet-players.png` });
} finally {
  await browser?.close();
  if (gid) await admin.from("groups").delete().eq("id", gid);
  await removeTestUsers(admin, users.map((u) => u.id));
  log("test verileri silindi");
}

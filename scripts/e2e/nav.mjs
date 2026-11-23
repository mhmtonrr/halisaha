// Geri düğmesi: formdan yönlendirilen sayfada form değil önceki sayfa; sohbet listesinden girilen sohbette liste; sekme korunur.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const users = []; let gid, browser;
const log = (...a) => console.log("•", ...a);
const path = (p) => new URL(p.url()).pathname + new URL(p.url()).search;
try {
  for (const [i, n] of ["Nav Bir", "Nav İki"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const P = await ctx.newPage(); P.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  await P.goto(BASE + "/login"); await P.fill('input[type="email"]', users[0].email); await P.fill('input[type="password"]', users[0].password);
  await P.click('form button:has-text("Giriş yap")'); await P.waitForURL(BASE + "/");
  const back = async () => { const from = P.url(); await P.click('a[aria-label="Geri"]'); await P.waitForURL((u) => u.toString() !== from, { timeout: 15000 }).catch(() => {}); await P.waitForTimeout(500); };

  // 1) Form → yönlendirilen sayfa: geri formu değil ana sayfayı açar
  await P.goto(BASE + "/grup-kur"); await P.fill('input[name="name"]', "Nav Grubu"); await P.click('button:has-text("Grubu kur")');
  await P.waitForURL(/\/g\/[0-9a-f-]{36}$/); gid = P.url().split("/g/")[1];
  await back();
  log("grup kurunca geri → form değil:", path(P) === "/" ? "✓ (/)" : "HATA " + path(P));

  // 2) Genel sohbet listesi → grup sohbeti → geri = liste
  await P.goto(BASE + "/sohbet"); await P.waitForSelector("text=Nav Grubu");
  await P.click("text=Nav Grubu"); await P.waitForURL(/\/g\/[0-9a-f-]{36}\/sohbet/, { timeout: 15000 });
  await P.waitForSelector('a[aria-label="Geri"]'); await back();
  log("grup sohbetinden geri → sohbet listesi:", path(P) === "/sohbet" ? "✓" : "HATA " + path(P));

  // 3) Sosyal sekmesi korunur
  await P.goto(BASE + "/sosyal?sekme=gruplar"); await P.waitForSelector("text=Nav Grubu");
  await P.click("text=Nav Grubu"); await P.waitForURL(/\/g\/[0-9a-f-]{36}$/); await back();
  log("gruptan geri → Sosyal 'Gruplar' sekmesi:", path(P) === "/sosyal?sekme=gruplar" ? "✓" : "HATA " + path(P));

  // 4) Profil → Mesaj gönder → konuşma → geri = profil
  await P.goto(`${BASE}/oyuncu/${users[1].id}`); await P.click('button:has-text("Mesaj gönder")');
  await P.waitForURL(/\/sohbet\/[0-9a-f-]{36}/); await P.waitForSelector('a[aria-label="Geri"]'); await back();
  log("konuşmadan geri → oyuncu profili:", path(P) === `/oyuncu/${users[1].id}` ? "✓" : "HATA " + path(P));

  // 5) Ana sayfa → profil (uygulama içi link) → sekme değiştir → geri = ana sayfa; tarayıcı ileri profili açar (gerçek geçmiş)
  await P.goto(BASE + "/"); await P.click('a[href="/profil"]'); await P.waitForURL(BASE + "/profil");
  await P.click('a[href="/profil?sekme=istatistik"]'); await P.waitForURL(/sekme=istatistik/);
  await back();
  log("profilden geri → ana sayfa:", path(P) === "/" ? "✓" : "HATA " + path(P));
  await P.goForward(); await P.waitForTimeout(800);
  log("tarayıcı ileri → profil (ayna bozulmadı):", path(P).startsWith("/profil") ? "✓" : "HATA " + path(P));
} finally {
  await browser?.close();
  if (gid) await admin.from("groups").delete().eq("id", gid);
  await removeTestUsers(admin, users.map((u) => u.id));
  log("test verileri silindi");
}

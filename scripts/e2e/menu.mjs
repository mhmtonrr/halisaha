// Menü: üst çubukta bildirim çanı ve ☰, çekmece (profil, bölümler, takım/grup kısayolları), çıkış yap.
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

let user, groupIds = [], browser;
try {
  const email = `e2e-menu-${Date.now()}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Menü Kullanıcı" } });
  if (error) throw error;
  user = data.user;
  await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", user.id);
  const T = (await admin.from("groups").insert({ name: "E2E Menü Takımı", kind: "team", city: "İstanbul", color: "#e11d48", created_by: user.id }).select("id").single()).data.id;
  const G = (await admin.from("groups").insert({ name: "E2E Menü Grubu", created_by: user.id }).select("id").single()).data.id;
  groupIds.push(T, G);

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  await page.goto(BASE + "/login");
  check("giriş sayfasında menü düğmesi yok", (await page.locator('button[aria-label="Menüyü aç"]').count()) === 0);
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password);
  await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");

  check("ana sayfada ☰ ve bildirim çanı", (await page.locator('button[aria-label="Menüyü aç"]').count()) === 1 && (await page.locator('a[aria-label="Bildirimler"]').count()) === 1);
  await page.click('button[aria-label="Menüyü aç"]');
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor();
  let t = (await dlg.innerText()).toLocaleLowerCase("tr");
  check("çekmece: profil özeti", t.includes("menü kullanıcı") && t.includes("rating"));
  check("çekmece: bölümler", ["ana sayfa", "keşfet", "bildirimler", "yetenek değerlendirmesi", "i̇statistiklerim", "ayarlar", "takım kur", "grup kur", "gizlilik politikası", "çıkış yap"].every((x) => t.includes(x) || (x === "i̇statistiklerim" && t.includes("istatistiklerim"))));
  check("çekmece: takım ve grup listesi", t.includes("e2e menü takımı") && t.includes("e2e menü grubu"));
  await page.screenshot({ path: `${SHOTS}/101-menu-acik.png` });

  await dlg.locator("button", { hasText: "E2E Menü Takımı" }).click();
  t = (await dlg.innerText()).toLocaleLowerCase("tr");
  check("takım açılınca kısayollar (kadro, sohbet, teklifler, takım istatistikleri)", ["kadro", "sohbet", "maç teklifleri", "takım istatistikleri"].every((x) => t.includes(x)));
  await page.screenshot({ path: `${SHOTS}/102-menu-takim.png` });

  await dlg.locator("a", { hasText: "Kadro" }).first().click();
  await page.waitForURL(new RegExp(`/g/${T}/kadro`));
  check("bağlantıya tıklayınca çekmece kapanır", (await page.locator('[role="dialog"]').count()) === 0);
  check("başlıklı sayfada da ☰ var", (await page.locator('button[aria-label="Menüyü aç"]').count()) === 1);

  await page.click('button[aria-label="Menüyü aç"]');
  await page.keyboard.press("Escape");
  check("Escape çekmeceyi kapatır", (await page.locator('[role="dialog"]').count()) === 0);
  await page.click('button[aria-label="Menüyü aç"]');
  await page.locator('button[aria-label="Menüyü kapat"]').click({ position: { x: 10, y: 400 } });
  check("karartmaya dokunmak çekmeceyi kapatır", (await page.locator('[role="dialog"]').count()) === 0);

  await page.click('button[aria-label="Menüyü aç"]');
  await page.click('button:has-text("Çıkış yap")');
  await page.waitForURL(/\/login/);
  check("çıkış yapınca giriş sayfasına döner", page.url().includes("/login"));
  await page.goto(BASE + "/profil");
  check("çıkıştan sonra korumalı sayfa girişe yönlenir", page.url().includes("/login"));
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  if (user) await admin.auth.admin.deleteUser(user.id);
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

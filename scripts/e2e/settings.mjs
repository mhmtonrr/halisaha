// Ayarlar (Obsidian Pitch): ana ekran + alt ekranlar (kişisel, futbolcu), müsaitlik, istatistik paylaşımı,
// hesabı dondurma, engelleme, geri bildirim ve SSS. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

const users = []; let browser;
try {
  for (const [i, n] of ["Ayar Sahibi", "Engelli Oyuncu"].entries()) {
    const email = `e2e-settings-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b] = users;
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  await page.goto(BASE + "/login"); await page.fill('input[type="email"]', a.email); await page.fill('input[type="password"]', a.password);
  await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
  const text = () => page.locator("body").innerText();
  const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));

  console.log("Ana ekran");
  await page.goto(`${BASE}/profil?sekme=ayarlar`);
  let t = await text();
  check("onaylı oyuncu ve tamamlanma yüzdesi", has(t, "Onaylı Oyuncu") && /%\d+ Tamamlandı/.test(t));
  await page.screenshot({ path: `${SHOTS}/110-ayarlar.png`, fullPage: true });

  console.log("Kişisel bilgiler");
  await page.goto(`${BASE}/profil/ayarlar/kisisel`);
  await page.fill('input[name="name"]', "Ayar Sahibi Yeni");
  await page.fill('input[name="birthDate"]', "1994-05-17");
  await page.click('button:has-text("Kaydet")'); await page.waitForURL(/saved=1/);
  const { data: priv } = await admin.from("profile_private").select("birth_date").eq("user_id", a.id).single();
  const { data: p1 } = await admin.from("profiles").select("display_name, birth_year, preferred_position").eq("id", a.id).single();
  check("doğum tarihi özel tabloya yazıldı", priv?.birth_date === "1994-05-17");
  check("birth_year eşitlendi, ad güncellendi, mevki korundu", p1?.birth_year === 1994 && p1?.display_name === "Ayar Sahibi Yeni" && p1?.preferred_position === "MID");
  await page.screenshot({ path: `${SHOTS}/111-ayar-kisisel.png`, fullPage: true });

  console.log("Futbolcu profili");
  await page.goto(`${BASE}/profil/ayarlar/futbolcu`);
  await page.locator('label:has(input[name="position"][value="FWD"])').click();
  await page.locator('label:has(input[name="secondary"][value="MID"])').click();
  await page.locator('label:has(input[name="foot"][value="R"])').click();
  await page.fill('input[name="shirt"]', "39"); await page.fill('input[name="height"]', "182"); await page.fill('input[name="weight"]', "76");
  await page.click('button:has-text("Kaydet")'); await page.waitForURL(/saved=1/);
  const { data: p2 } = await admin.from("profiles").select("preferred_position, secondary_positions, preferred_foot, shirt_number, height_cm, weight_kg, display_name").eq("id", a.id).single();
  check("mevki/ayak/forma/boy/kilo kaydedildi", p2?.preferred_position === "FWD" && p2?.preferred_foot === "R" && p2?.shirt_number === 39 && p2?.height_cm === 182 && p2?.weight_kg === 76 && p2?.secondary_positions?.includes("MID"));
  check("kişisel alanlar bozulmadı", p2?.display_name === "Ayar Sahibi Yeni");
  await page.screenshot({ path: `${SHOTS}/112-ayar-futbolcu.png`, fullPage: true });
  check("geçersiz boy reddedilir", await (async () => { await page.fill('input[name="height"]', "50"); await page.evaluate(() => document.querySelector('input[name="height"]').removeAttribute("min")); await page.click('button:has-text("Kaydet")'); await page.waitForURL(/error=/); return true; })());

  console.log("Müsaitlik, paylaşım, dondurma");
  await page.goto(`${BASE}/profil?sekme=ayarlar`);
  await page.getByRole("button", { name: "Pzt", exact: true }).click();
  await page.getByRole("button", { name: "Cum", exact: true }).click();
  await page.waitForTimeout(1500);
  const { data: p3 } = await admin.from("profiles").select("available_days").eq("id", a.id).single();
  check("müsait günler kaydedildi (Pzt=0, Cum=4)", JSON.stringify(p3?.available_days) === "[0,4]");
  await page.locator('button[role="switch"][aria-label="İstatistiklerimi Paylaş"]').click();
  await page.waitForTimeout(1500);
  const { data: p4 } = await admin.from("profiles").select("stats_visibility").eq("id", a.id).single();
  check("istatistik paylaşımı açıldı (public)", p4?.stats_visibility === "public");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Hesabımı Geçici Dondur/ }).click();
  await page.getByRole("button", { name: /Hesabımı Yeniden Aç/ }).waitFor();
  const { data: p5 } = await admin.from("profiles").select("frozen_at").eq("id", a.id).single();
  check("hesap donduruldu", !!p5?.frozen_at);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Hesabımı Yeniden Aç/ }).click();
  await page.getByRole("button", { name: /Hesabımı Geçici Dondur/ }).waitFor();
  const { data: p6 } = await admin.from("profiles").select("frozen_at").eq("id", a.id).single();
  check("hesap yeniden açıldı", p6?.frozen_at === null);

  console.log("Engelleme");
  await page.goto(`${BASE}/oyuncu/${b.id}`);
  await page.click('button:has-text("Bu oyuncuyu engelle")');
  await page.waitForURL(/engellenenler/);
  t = await text();
  check("engellenen listede görünür", has(t, "Engelli Oyuncu"));
  await page.screenshot({ path: `${SHOTS}/113-ayar-engellenenler.png`, fullPage: true });
  await page.goto(`${BASE}/kesfet?sekme=oyuncu`);
  check("engellenen oyuncu aramada görünmez", !has(await text(), "Engelli Oyuncu"));
  await page.goto(`${BASE}/profil/ayarlar/engellenenler`);
  await page.click('button:has-text("Engeli kaldır")'); await page.waitForTimeout(1500);
  const { count } = await admin.from("user_blocks").select("id", { count: "exact", head: true }).eq("blocker_id", a.id);
  check("engel kaldırıldı", count === 0);

  console.log("Geri bildirim ve SSS");
  await page.goto(`${BASE}/geri-bildirim`);
  await page.fill('textarea[name="message"]', "E2E test geri bildirimi, lütfen yoksayın");
  await page.click('button:has-text("Gönder")'); await page.waitForURL(/saved=1/);
  const { count: fb } = await admin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", a.id);
  check("geri bildirim kaydedildi", fb === 1);
  await page.goto(`${BASE}/yardim`);
  check("SSS soruları görünür", has(await text(), "Grup ile takım arasındaki fark nedir?"));
  await page.screenshot({ path: `${SHOTS}/114-yardim.png`, fullPage: true });
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

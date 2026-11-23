// Giriş + karşılama: yanlış şifre, ilk girişte karşılama zorunlu, il/ilçe seçimi, davet linkiyle gelenin karşılama sonrası gruba katılması,
// profilde ve oyuncu sayfasında bölge, çıkış/tekrar girişte karşılama sorulmaması. Arayüzden kayıt (signUp) test edilmez (onay maili limiti).
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Kullanım: node scripts/e2e/auth-onboarding.mjs [ekran-klasörü]
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
import os from "os";
import path from "path";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? path.join(os.tmpdir(), "halisaha-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(
  fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
/** Yalnız `npm run dev`'de: kendisi yönlendiren sayfaya istemci geçişi boş kalabiliyor (üretimde sorun yok). Takılırsa bir kez yeniler. */
const settle = async (page, re, ms = 15000) => {
  try { await page.waitForURL(re, { timeout: ms }); } catch { await page.reload(); await page.waitForURL(re, { timeout: ms }); }
};
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

const users = []; let groupId; let browser;
try {
  for (const [i, n] of ["Kemal Arslan", "Levent Koç"].entries()) {
    const email = `e2e-auth-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    users.push({ id: data.user.id, email, password, name: n });
  }
  browser = await chromium.launch();
  const newPage = async () => {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    p.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const body = (p) => p.locator("body").innerText();
  const login = async (page, u, pw = u.password) => {
    await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', pw);
    await page.click('form button:has-text("Giriş yap")');
  };

  // 1) Giriş ekranı + yanlış şifre
  const A = await newPage();
  await A.goto(BASE + "/", { waitUntil: "networkidle" }); await A.waitForURL(/\/login/);
  check("girişsiz ana sayfa girişe yönlenir", A.url().includes("/login"));
  await shot(A, "10-giris");
  await A.click('button:has-text("Kayıt ol")'); await shot(A, "11-kayit"); await A.click('button:has-text("Giriş yap")');
  await login(A, users[0], "yanlis-sifre-123");
  check("yanlış şifrede hata mesajı", !!(await A.locator("text=E-posta veya şifre hatalı").waitFor({ timeout: 10000 }).then(() => 1, () => 0)));

  // 2) Doğru şifre → karşılama ekranı zorunlu
  await login(A, users[0]); await settle(A, /\/hosgeldin/);
  check("ilk girişte karşılamaya yönlenir", new URL(A.url()).pathname === "/hosgeldin");
  await A.goto(BASE + "/g/00000000-0000-0000-0000-000000000000"); await A.waitForURL(/\/hosgeldin/);
  check("karşılama bitmeden başka sayfaya gidilemez, dönüş adresi saklanır", new URL(A.url()).searchParams.get("next")?.startsWith("/g/"));
  await A.goto(BASE + "/hosgeldin");
  check("isim önceden dolu", (await A.inputValue('input[name="name"]')) === "Kemal Arslan");
  await A.click('button:has-text("Devam et")');
  check("il seçmeden devam edilemez", (await A.locator('select[name="city"]:invalid').count()) === 1);
  await A.selectOption('select[name="city"]', "İstanbul");
  await A.selectOption('select[name="district"]', "Kadıköy");
  await A.locator('input[name="position"][value="MID"]').check({ force: true });
  await A.locator('input[name="foot"][value="R"]').check({ force: true });
  await A.fill('input[name="birthYear"]', "1994");
  await shot(A, "12-hosgeldin");
  await A.click('button:has-text("Devam et")'); await A.waitForURL(BASE + "/", { timeout: 20000 });
  check("karşılama tamamlanınca ana sayfa", new URL(A.url()).pathname === "/");

  // Grup kur (davet testi için)
  await A.goto(BASE + "/grup-kur"); await A.fill('input[name="name"]', "Kadıköy Kartalları");
  await A.click('button:has-text("Grubu kur")'); await A.waitForURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 20000 });
  groupId = A.url().split("/g/")[1];
  const { data: g } = await admin.from("groups").select("invite_code").eq("id", groupId).single();

  // 3) Davet linkiyle gelen yeni oyuncu: giriş → karşılama → gruba katılım
  const B = await newPage();
  await B.goto(`${BASE}/join/${g.invite_code}`); await B.waitForURL(/\/login/);
  await login(B, users[1]); await settle(B, /\/hosgeldin/);
  check("davetli karşılamada, dönüş adresi davet linki", new URL(B.url()).searchParams.get("next")?.includes(g.invite_code));
  await B.selectOption('select[name="city"]', "İzmir");
  await B.locator('input[name="position"][value="GK"]').check({ force: true });
  await B.click('button:has-text("Devam et")'); await settle(B, /\/g\//);
  check("karşılama sonrası doğrudan gruba katıldı", B.url().includes(groupId));

  // 4) Profil ve oyuncu sayfasında bölge
  await A.goto(BASE + "/profil"); await shot(A, "13-profil");
  check("profilde bölge görünür", (await body(A)).includes("Kadıköy"));
  const { data: me } = await admin.from("group_players").select("id").eq("group_id", groupId).eq("user_id", users[0].id).single();
  await B.goto(`${BASE}/g/${groupId}/p/${me.id}`); await B.waitForURL(new RegExp(`/oyuncu/${users[0].id}`));
  check("grup oyuncusu sayfası hesabın oyuncu sayfasına gider, bölge görünür", (await body(B)).includes("Kadıköy"));

  // 5) Çıkış → tekrar giriş, karşılama sorulmaz
  // Çıkış düğmesi tembel yüklenen menüde/ayarlarda: aynı uç noktaya form gönderimi gibi POST
  await A.evaluate(() => fetch("/auth/signout", { method: "POST" }));
  await A.goto(BASE + "/"); await A.waitForURL(/\/login/, { timeout: 20000 });
  await login(A, users[0]); await A.waitForURL(BASE + "/", { timeout: 30000 });
  check("tekrar girişte karşılama sorulmaz", new URL(A.url()).pathname === "/");
  const { data: profs } = await admin.from("profiles").select("id, city, district, birth_year, preferred_position, onboarded_at").in("id", users.map((u) => u.id));
  const pa = profs.find((p) => p.id === users[0].id), pb = profs.find((p) => p.id === users[1].id);
  check("profil kaydı: Kadıköy/İstanbul, 1994, MID", pa.city === "İstanbul" && pa.district === "Kadıköy" && pa.birth_year === 1994 && pa.preferred_position === "MID" && !!pa.onboarded_at);
  check("davetli profili: İzmir, GK", pb.city === "İzmir" && pb.preferred_position === "GK" && !!pb.onboarded_at);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  if (groupId) await admin.from("groups").delete().eq("id", groupId);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

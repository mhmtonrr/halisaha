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
const users = []; let groupId;
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Kemal Arslan", "Levent Koç"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error; users.push({ id: data.user.id, email, password, name: n });
  }
  const browser = await chromium.launch();
  const newPage = async (scale = 1) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale }); const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message)); return { ctx, page: p }; };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const login = async (page, u, pw = u.password) => { await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', pw); await page.click('form button:has-text("Giriş yap")'); };

  // 1) Giriş ekranı + yanlış şifre
  const A = await newPage(2);
  await A.page.goto(BASE + "/"); await A.page.waitForURL(/\/login/);
  await shot(A.page, "10-giris");
  await A.page.click('button:has-text("Kayıt ol")'); await shot(A.page, "11-kayit"); await A.page.click('button:has-text("Giriş yap")');
  await login(A.page, users[0], "yanlis-sifre-123");
  log("yanlış şifre mesajı:", await A.page.locator("text=E-posta veya şifre hatalı").textContent());

  // 2) Doğru şifre → karşılama ekranı
  await login(A.page, users[0]); await A.page.waitForURL(/\/hosgeldin/);
  log("ilk girişte karşılamaya yönlendi:", new URL(A.page.url()).pathname);
  await A.page.goto(BASE + "/g/00000000-0000-0000-0000-000000000000"); await A.page.waitForURL(/\/hosgeldin/);
  log("karşılama bitmeden başka sayfaya gidemiyor ✓ (next=", new URL(A.page.url()).searchParams.get("next"), ")");
  await A.page.goto(BASE + "/hosgeldin");
  log("isim önceden dolu:", await A.page.inputValue('input[name="name"]'));
  await A.page.click('button:has-text("Devam et")');
  const invalid = await A.page.locator('select[name="city"]:invalid').count();
  log("il seçmeden devam edilemiyor:", invalid ? "✓" : "HATA");
  await A.page.selectOption('select[name="city"]', "İstanbul"); await A.page.fill('input[name="district"]', "Kadıköy");
  await A.page.locator('input[name="position"][value="MID"]').check({ force: true });
  await A.page.locator('input[name="foot"][value="R"]').check({ force: true });
  await A.page.fill('input[name="birthYear"]', "1994");
  await shot(A.page, "12-hosgeldin");
  await A.page.click('button:has-text("Devam et")'); await A.page.waitForURL(BASE + "/");
  log("karşılama tamamlandı → ana sayfa");
  await A.page.fill('input[name="name"]', "Kadıköy Kartalları"); await A.page.click('button:has-text("Kur")');
  await A.page.waitForURL(/\/g\/[0-9a-f-]+$/); groupId = A.page.url().split("/g/")[1];
  const { data: g } = await admin.from("groups").select("invite_code").eq("id", groupId).single();

  // 3) Davet linkiyle gelen yeni oyuncu: login → karşılama → gruba katılım
  const B = await newPage();
  await B.page.goto(`${BASE}/join/${g.invite_code}`); await B.page.waitForURL(/\/login/);
  await login(B.page, users[1]); await B.page.waitForURL(/\/hosgeldin/);
  log("davetli karşılamada, dönüş adresi:", new URL(B.page.url()).searchParams.get("next"));
  await B.page.selectOption('select[name="city"]', "İzmir"); await B.page.locator('input[name="position"][value="GK"]').check({ force: true });
  await B.page.click('button:has-text("Devam et")'); await B.page.waitForURL(/\/g\//);
  log("karşılama sonrası doğrudan gruba katıldı:", B.page.url().includes(groupId) ? "✓" : "HATA");

  // 4) Profil sayfası ve oyuncu sayfasında bölge
  await A.page.goto(BASE + "/profil"); await shot(A.page, "13-profil");
  log("profilde il:", await A.page.inputValue('select[name="city"]'), "/ ilçe:", await A.page.inputValue('input[name="district"]'));
  const { data: me } = await admin.from("group_players").select("id").eq("group_id", groupId).eq("user_id", users[0].id).single();
  await A.page.goto(`${BASE}/g/${groupId}/p/${me.id}`);
  log("oyuncu sayfasında bölge:", await A.page.locator("dd").first().textContent());

  // 5) Çıkış → tekrar giriş, karşılama sorulmamalı
  await A.page.goto(BASE + "/"); await A.page.click('button:has-text("Çıkış")'); await A.page.waitForURL(/\/login/);
  await login(A.page, users[0]); await A.page.waitForURL(BASE + "/");
  log("tekrar girişte karşılama sorulmadı ✓");
  const { data: profs } = await admin.from("profiles").select("display_name, city, district, birth_year, preferred_position, onboarded_at").in("id", users.map((u) => u.id));
  for (const p of profs) log(`  ${p.display_name}: ${p.district ?? "-"}, ${p.city} · ${p.birth_year ?? "-"} · ${p.preferred_position} · onboarded=${!!p.onboarded_at}`);
  await browser.close();
} finally {
  if (groupId) await admin.from("groups").delete().eq("id", groupId);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  const { data: left } = await admin.from("profiles").select("id").in("id", users.map((u) => u.id));
  log(`temizlendi (kalan test profili: ${left?.length ?? 0})`);
}

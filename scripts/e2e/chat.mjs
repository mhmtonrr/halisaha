import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
import { fillSetup } from "./wizard.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const users = []; let gid;
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Ahmet Yılmaz", "Burak Demir", "Cem Kaya", "Deniz Şahin"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  const browser = await chromium.launch();
  const login = async (u, scale = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/"); return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
  const [A, B, C, D] = [await login(users[0], 2), await login(users[1], 2), await login(users[2]), await login(users[3])];
  await A.goto(BASE + "/grup-kur"); await A.fill('input[name="name"]', "Moda Futbol Severler"); await A.click('button:has-text("Grubu kur")');
  await A.waitForURL(/\/g\//); gid = A.url().split("/g/")[1];
  const { data: g } = await admin.from("groups").select("invite_code").eq("id", gid).single();
  for (const X of [B, C]) { await X.goto(`${BASE}/join/${g.invite_code}`); await X.waitForURL(/\/g\//); }

  // İkisi de sohbette
  await B.goto(`${BASE}/g/${gid}/sohbet`); await A.goto(`${BASE}/g/${gid}/sohbet`);
  await A.waitForSelector("text=canlı", { timeout: 15000 }); await B.waitForSelector("text=canlı", { timeout: 15000 });
  log("iki tarayıcı da gerçek zamanlı kanala bağlandı ✓");
  const t0 = Date.now();
  await A.fill('textarea[aria-label="Mesaj"]', "Selam millet! Cuma kim var? ⚽"); await A.keyboard.press("Enter");
  await B.waitForSelector("text=Cuma kim var?", { timeout: 10000 });
  log(`B mesajı sayfa yenilemeden gördü ✓ (${Date.now() - t0} ms)`);
  await B.fill('textarea[aria-label="Mesaj"]', "Ben varım! 🙋‍♂️\nKaleye de geçebilirim"); await B.click('button[aria-label="Gönder"]');
  await A.waitForSelector("text=Kaleye de geçebilirim", { timeout: 10000 });
  log("A cevabı anında gördü ✓ (çok satırlı mesaj)");
  await B.fill('textarea[aria-label="Mesaj"]', "Detaylar: https://example.com/saha"); await B.keyboard.press("Enter");
  await A.waitForSelector('a[href="https://example.com/saha"]', { timeout: 10000 });
  log("linkler tıklanabilir ✓");

  // Okunmamış rozeti (C sohbete girmedi)
  await C.goto(BASE + "/"); const badge = await C.locator('span[title$="okunmamış mesaj"]').first().textContent();
  log("C'nin ana sayfasında okunmamış rozeti:", badge, "(beklenen 3)");
  await C.goto(`${BASE}/g/${gid}`); log("grup sayfasında:", (await C.locator("text=3 yeni").count()) ? "✓ '3 yeni'" : "HATA");
  await C.goto(`${BASE}/g/${gid}/sohbet`); await C.waitForSelector("text=canlı"); await C.goto(BASE + "/");
  log("sohbeti açınca rozet kalktı:", (await C.locator('span[title$="okunmamış mesaj"]').count()) === 0 ? "✓" : "HATA");

  // Etkinlik kartı: kurucu maç ayarlayınca sohbete düşer (0042: "📣 Maç ayarlanıyor: <tarih>")
  const A2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await A2.context().addCookies(await A.context().cookies());
  await A2.goto(`${BASE}/mac-ayarla?grup=${gid}`); await fillSetup(A2, { venue: "Petroller" });
  await B.waitForSelector("text=📣 Maç ayarlanıyor:", { timeout: 10000 });
  log("maç ayarlanınca sohbete etkinlik kartı düştü ✓ (B canlı gördü)");

  // Silme: kurucu B'nin mesajını siler, B canlı görür
  await A.locator("button:has-text('Ben varım!')").click(); await A.click("text=Mesajı sil");
  await B.waitForSelector("text=Bu mesaj silindi", { timeout: 10000 });
  log("kurucu mesajı sildi, B'de canlı 'Bu mesaj silindi' ✓");
  const { data: del } = await admin.from("group_messages").select("body").eq("group_id", gid).not("deleted_at", "is", null).single();
  log("silinen mesajın içeriği veritabanında saklanmıyor:", del.body === "—" ? "✓" : "HATA");
  await B.fill('textarea[aria-label="Mesaj"]', "Tamam, Cuma görüşürüz 👍"); await B.keyboard.press("Enter");
  await A.waitForSelector("text=Cuma görüşürüz");
  await shot(A, "40-sohbet-ahmet"); await shot(B, "41-sohbet-burak");

  // Üye olmayan giremez
  await D.goto(`${BASE}/g/${gid}/sohbet`); await D.waitForLoadState("networkidle");
  const body = await D.locator("body").innerText();
  log("üye olmayan sohbete giremiyor:", !body.includes("Cuma görüşürüz") && !body.includes("Mesaj yaz") ? `✓ (${body.includes("404") ? "404 sayfası" : "yönlendirildi"})` : "HATA");
  // Takım sohbeti: takım herkese açık olsa da sohbet sadece oyunculara
  const T = await (await browser.newContext()).newPage(); await T.context().addCookies(await A.context().cookies());
  await T.goto(BASE + "/takim-kur"); await T.fill('input[name="name"]', "Test Takımı"); await T.selectOption('select[name="city"]', "İstanbul");
  await T.click('button:has-text("Takımı kur")'); await T.waitForURL(/\/g\//); const tid = T.url().split("/g/")[1];
  await T.goto(`${BASE}/g/${tid}/sohbet`); await T.fill('textarea[aria-label="Mesaj"]', "Takım içi gizli taktik"); await T.keyboard.press("Enter"); await T.waitForTimeout(1500);
  await D.goto(`${BASE}/g/${tid}`); const sees = await D.locator("h1:has-text('Test Takımı')").count();
  await D.goto(`${BASE}/g/${tid}/sohbet`); await D.waitForURL(new RegExp(`/g/${tid}$`));
  log("yabancı takım sayfasını görüyor:", sees ? "✓" : "HATA", "| takım sohbetine giremiyor, takım sayfasına döndü: ✓");
  const { count } = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY).from("group_messages").select("*", { count: "exact", head: true });
  log("girişsiz istemcinin görebildiği mesaj:", count ?? 0);
  await admin.from("groups").delete().eq("id", tid);
  await browser.close();
} finally {
  if (gid) await admin.from("groups").delete().eq("id", gid);
  await removeTestUsers(admin, users.map((u) => u.id));
  const { data: left } = await admin.from("profiles").select("id").in("id", users.map((u) => u.id));
  log(`temizlendi (kalan test profili: ${left?.length ?? 0})`);
}

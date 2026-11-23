// Davet kodu: kaptan kodu görür/yeniler, oyuncu "Gruba katıl" / "Takıma katıl" ile kodu yazarak girer (önizleme, tür uyuşmazlığı,
// link yapıştırma, geçersiz kod); menüde Takımlarım ve Gruplarım ayrı başlıklar. Canlı Supabase'e karşı; test verisini siler.
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
const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));

const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of ["Kaan Kaptan", "Oya Oyuncu"].entries()) {
    const email = `e2e-invite-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b] = users;
  const G = (await admin.from("groups").insert({ name: "E2E Davet Grubu", created_by: a.id }).select("id").single()).data.id;
  const T = (await admin.from("groups").insert({ name: "E2E Davet Takımı", kind: "team", city: "İstanbul", color: "#2563eb", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G, T);
  const codeOf = async (id) => (await admin.from("groups").select("invite_code").eq("id", id).single()).data.invite_code;
  const isMember = async (g, u) => (await admin.from("group_players").select("id").eq("group_id", g).eq("user_id", u.id).is("left_at", null)).data.length === 1;

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [aP, bP] = [await open(a), await open(b)];

  // 1) Kaptan kodu görür ve yeniler
  await aP.goto(`${BASE}/g/${G}`);
  const shown = (await aP.locator('[data-testid="invite-code"]').innerText()).trim();
  const codeG = await codeOf(G);
  check("grup sayfasında davet kodu okunaklı gösterilir (XXXXX-XXXXX)", /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(shown) && shown.replace("-", "") === codeG);
  await aP.screenshot({ path: `${SHOTS}/110-davet-kodu.png`, fullPage: true });
  await aP.click('button:has-text("Yeni kod oluştur")');
  await aP.waitForLoadState("networkidle");
  const codeG2 = await codeOf(G);
  check("'Yeni kod oluştur' kodu değiştirir", codeG2 !== codeG && /^[A-Z2-9]{10}$/.test(codeG2));
  await aP.goto(`${BASE}/g/${T}`);
  check("takım sayfasında da kod görünür (kaptan)", /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test((await aP.locator('[data-testid="invite-code"]').innerText()).trim()));

  // 2) Oyuncu ana sayfada ayrı 'Takıma katıl' ve 'Gruba katıl' görür
  await bP.goto(BASE + "/");
  check("ana sayfada 'Takıma katıl' ve 'Gruba katıl' bağlantıları", (await bP.locator('a[href="/katil?tur=takim"]').count()) >= 1 && (await bP.locator('a[href="/katil?tur=grup"]').count()) >= 1);
  await bP.locator('a[href="/katil?tur=grup"]').first().click();
  await bP.waitForURL(/\/katil\?tur=grup/);
  await bP.screenshot({ path: `${SHOTS}/111-gruba-katil.png`, fullPage: true });

  // 3) Eski kod geçersiz
  await bP.fill('input[name="kod"]', codeG.toLowerCase());
  await bP.click('button:has-text("Kodu kontrol et")');
  await bP.waitForURL(/kod=/);
  check("yenilenmeden önceki kod artık geçersiz (mesaj)", has(await bP.locator("body").innerText(), "bulunamadı"));

  // 4) Yeni kodu küçük harf ve tireyle yaz → önizleme → katıl
  const typed = codeG2.slice(0, 5).toLowerCase() + "-" + codeG2.slice(5).toLowerCase();
  await bP.fill('input[name="kod"]', typed);
  await bP.click('button:has-text("Kodu kontrol et")');
  await bP.locator("text=E2E Davet Grubu").first().waitFor({ timeout: 10000 });
  let t = await bP.locator("body").innerText();
  check("önizleme: ad, 'Grup' etiketi ve oyuncu sayısı", has(t, "E2E Davet Grubu") && has(t, "Grup") && has(t, "1 oyuncu"));
  await bP.screenshot({ path: `${SHOTS}/112-davet-onizleme.png`, fullPage: true });
  await bP.click('button:text-is("Gruba katıl")');
  await bP.waitForURL(new RegExp(`/g/${G}`), { timeout: 15000 });
  check("gruba katıldı (üye)", await isMember(G, b));

  // 5) Takım kodunu 'Gruba katıl' bölümüne yazarsa doğru bölüme yönlendirilir
  const codeT = await codeOf(T);
  await bP.goto(`${BASE}/katil?tur=grup`);
  await bP.fill('input[name="kod"]', codeT);
  await bP.click('button:has-text("Kodu kontrol et")');
  await bP.locator("text=E2E Davet Takımı").first().waitFor({ timeout: 10000 });
  t = await bP.locator("body").innerText();
  check("yanlış bölüm: 'bu kod bir takıma ait' yönlendirmesi, doğrudan katılma yok", has(t, "Bu kod bir takıma ait") && (await bP.locator('button:text-is("Gruba katıl")').count()) === 0);
  await bP.click("text=takıma katıl ›");
  await bP.waitForURL(/tur=takim/);
  check("doğru bölüme geçince 'Takıma katıl' düğmesi", (await bP.locator('button:text-is("Takıma katıl")').count()) === 1);
  await bP.screenshot({ path: `${SHOTS}/113-davet-takim.png`, fullPage: true });
  await bP.click('button:text-is("Takıma katıl")');
  await bP.waitForURL(new RegExp(`/g/${T}`), { timeout: 15000 });
  check("takıma katıldı (üye)", await isMember(T, b));

  // 6) Link yapıştırma ve zaten üye
  await bP.goto(`${BASE}/katil?tur=takim`);
  await bP.fill('input[name="kod"]', `https://halisaha-tawny.vercel.app/join/${codeT}`);
  await bP.click('button:has-text("Kodu kontrol et")');
  await bP.locator("text=Zaten üyesin").first().waitFor({ timeout: 10000 });
  check("link yapıştırılabilir; zaten üyeyse bilgi ve bağlantı", has(await bP.locator("body").innerText(), "Zaten üyesin"));

  // 7) Geçersiz kod
  await bP.goto(`${BASE}/katil`);
  await bP.fill('input[name="kod"]', "YANLIS-KODXX");
  await bP.click('button:has-text("Kodu kontrol et")');
  await bP.waitForURL(/kod=/);
  check("geçersiz kod için açıklayıcı mesaj", has(await bP.locator("body").innerText(), "bulunamadı"));

  // 8) Menü: Takımlarım ve Gruplarım ayrı başlıklar
  await bP.goto(BASE + "/");
  await bP.click('button[aria-label="Menüyü aç"]');
  const dlg = bP.locator('[role="dialog"]');
  await dlg.waitFor();
  await dlg.locator("text=E2E Davet Grubu").waitFor({ timeout: 10000 });
  t = await dlg.innerText();
  check("menüde 'Takımlarım' ve 'Gruplarım' ayrı başlıklar (birleşik başlık yok)", has(t, "Takımlarım") && has(t, "Gruplarım") && !has(t, "Takımlarım ve gruplarım"));
  check("menüde takım ve grup kendi başlığı altında, katıl/kur bağlantılarıyla", has(t, "E2E Davet Takımı") && has(t, "E2E Davet Grubu") && has(t, "Takıma katıl") && has(t, "Gruba katıl") && has(t, "Takım kur") && has(t, "Grup kur"));
  await bP.screenshot({ path: `${SHOTS}/114-menu-ayri.png` });
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

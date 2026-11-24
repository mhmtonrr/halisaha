// Herkese açık adam arama (0041): kaptan maç ekranında "Herkese açık" işaretleyerek adam arar; başka ilden yabancı
// Keşfet "Adam arayan" sekmesinde il seçince görür, başvurur ("Başvurdun"), kaptan kadroya alır; kapatınca listeden düşer.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Kullanım: node scripts/e2e/open-calls.mjs [ekran-klasörü]
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
const CITY = "Kırşehir";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const users = []; const groups = []; let browser;
try {
  for (const [i, [n, city]] of [["Acik Kaptan", CITY], ["Acik Yabanci", "İstanbul"]].entries()) {
    const email = `e2e-open-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city, preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, O] = users;
  const T = must(await admin.from("groups").insert({ name: "Acik Takim", kind: "team", created_by: K.id, city: CITY }).select("id").single()).id;
  groups.push(T);
  const m = must(await admin.from("matches").insert({ group_id: T, played_at: new Date(Date.now() + 2 * 864e5).toISOString(), venue: "Acik Saha", created_by: K.id, kind: "external", opponent_name: "Rakip FK" }).select("id").single());

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, page.url(), e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const [PK, PO] = [await login(K), await login(O)];
  const kesfet = `${BASE}/kesfet?sekme=mac&il=${encodeURIComponent(CITY)}`;

  // 1) Kaptan herkese açık adam arar
  await PK.goto(`${BASE}/g/${T}/m/${m.id}`);
  await PK.locator("summary:has-text('Adam ara')").click();
  await PK.locator('select[name="needed"]').selectOption("1");
  await PK.locator('input[name="positions"][value="GK"]').check();
  await PK.locator('input[name="public"]').check();
  await PK.click('button:has-text("Adam ara")');
  await PK.waitForURL(/\/cagri\/[0-9a-f-]{36}/);
  const pollId = PK.url().match(/cagri\/([0-9a-f-]{36})/)[1];
  check("adam arama herkese açık açıldı", must(await admin.from("match_polls").select("is_public").eq("id", pollId).single()).is_public === true);
  check("çağrı sayfasında 'herkese açık · kapat' görünür", (await PK.locator("text=Herkese açık · kapat").count()) === 1);

  // 2) Yabancı Keşfet'te görür, başvurur
  await PO.goto(kesfet);
  check("Keşfet'te 'Adam arayan' sekmesi listeler", await PO.waitForSelector("text=Acik Takim vs Rakip FK", { timeout: 15000 }).then(() => true, () => false));
  check("kartta aranan sayı ve mevki", (await PO.locator("text=1 oyuncu").count()) >= 1 && (await PO.locator("text=Kaleci").count()) >= 1);
  await PO.screenshot({ path: `${SHOTS}/open-calls-list.png`, fullPage: true });
  await PO.goto(`${BASE}/kesfet?sekme=mac&il=Ankara`);
  check("başka ilde görünmez", (await PO.locator("text=Acik Takim").count()) === 0);
  await PO.goto(kesfet);
  await PO.click("text=Acik Takim vs Rakip FK");
  await PO.waitForURL(new RegExp(`/cagri/${pollId}`));
  await PO.click('button[name="answer"]:has-text("Geliyorum")');
  await PO.waitForSelector("text=Organizatörün kararını bekliyorsun", { timeout: 15000 });
  await PO.goto(kesfet);
  check("başvurduktan sonra 'Başvurdun'", await PO.waitForSelector("text=Başvurdun", { timeout: 15000 }).then(() => true, () => false));

  // 3) Kaptan kapatır: listeden düşer; tekrar açar, kadroya alır
  await PK.goto(`${BASE}/g/${T}/cagri/${pollId}`);
  await PK.click("text=Herkese açık · kapat");
  await PK.waitForSelector("text=Herkese aç (Keşfet)", { timeout: 15000 });
  await PO.goto(kesfet);
  await PO.waitForSelector("text=adam arayan maçlar");
  check("kapatılan arama listeden düştü", (await PO.locator("text=Acik Takim").count()) === 0);
  await PK.click("text=Herkese aç (Keşfet)");
  await PK.waitForSelector("text=Herkese açık · kapat", { timeout: 15000 });
  await PK.click('button:has-text("Kadroya al")');
  let status = "";
  for (let i = 0; i < 20 && status !== "filled"; i++) {
    await PK.waitForTimeout(500);
    status = must(await admin.from("match_polls").select("status").eq("id", pollId).single()).status;
  }
  const loan = must(await admin.from("group_players").select("is_loan").eq("group_id", T).eq("user_id", O.id));
  check("başvuran ödünç kadroya alındı, arama doldu", status === "filled" && loan[0]?.is_loan === true);
  await PO.goto(kesfet);
  await PO.waitForSelector("text=adam arayan maçlar");
  check("dolan arama listeden düştü", (await PO.locator("text=Acik Takim").count()) === 0);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groups) await admin.from("groups").delete().eq("id", g);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

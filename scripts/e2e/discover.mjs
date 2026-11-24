// Keşfet oyuncu araması (bölge/mevki/rating/yetenek/takımsız filtreleri), "aramada görün" ayarı ve ana sayfa öne çıkanlar.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Benzersiz bir il kullanır (Edirne) ki gerçek verilerle karışmasın.
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

const spec = [
  { n: "Zeki Forvet", pos: "FWD", overall: 85, matches: 5, team: true, skill: 90 },
  { n: "Zeki Kaleci", pos: "GK", overall: 80, matches: 4, hidden: true },
  { n: "Zeki Defans", pos: "DEF", overall: 70, matches: 3 },
  { n: "Zeki Orta", pos: "MID", overall: 72, matches: 6 },
];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, s] of spec.entries()) {
    const email = `e2e-discover-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: s.n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Edirne", district: "Merkez", preferred_position: s.pos, onboarded_at: new Date().toISOString(), discoverable: !s.hidden }).eq("id", data.user.id);
    users.push({ ...s, id: data.user.id, email, password });
  }
  // Takım ve oyuncu kayıtları (rating/yetenek global olarak her satıra yazılır; burada her oyuncunun kendi özel grubu)
  const team = (await admin.from("groups").insert({ name: "E2E Keşfet FK", kind: "team", city: "Edirne", color: "#0ea5e9", created_by: users[0].id }).select("id").single()).data.id;
  groupIds.push(team);
  for (const u of users) {
    let gpId = (await admin.from("group_players").select("id").eq("group_id", team).eq("user_id", u.id).maybeSingle()).data?.id;
    if (u.team && !gpId) gpId = (await admin.from("group_players").insert({ group_id: team, user_id: u.id, display_name: u.n }).select("id").single()).data.id;
    if (!u.team) {
      const g = (await admin.from("groups").insert({ name: "E2E Özel " + u.n, created_by: u.id }).select("id").single()).data.id;
      groupIds.push(g);
      gpId = (await admin.from("group_players").select("id").eq("group_id", g).eq("user_id", u.id).single()).data.id;
    }
    await admin.from("user_ratings").upsert({ user_id: u.id, overall: u.overall, raw: 0, confidence: 1, matches_played: u.matches });
    if (u.skill) await admin.from("user_skills").upsert({ user_id: u.id, skills: { HIZ: u.skill }, voters: 3, ballots: 3 });
  }
  const [, , defans, orta] = users;

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const body = async (p) => (await p.locator("body").innerText()).toLocaleLowerCase("tr");
  const search = async (p, qs) => { await p.goto(`${BASE}/kesfet?sekme=oyuncu&il=Edirne&q=Zeki&${qs}`); return body(p); };
  // Sayfadaki sıraya göre (ilk geçtiği yere göre) bulunan test oyuncuları
  const found = (t) => spec.map((s) => [s.n.split(" ")[1], t.indexOf(s.n.toLocaleLowerCase("tr"))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n);

  const p = await open(defans);
  console.log("Arama");
  let t = await search(p, "");
  check("sekmeler var (Takımlar / Oyuncular)", t.includes("takımlar") && t.includes("oyuncular"));
  check("aramaya açık olanlar listelenir, gizli olan listelenmez", JSON.stringify(found(t).sort()) === JSON.stringify(["Defans", "Forvet", "Orta"]));
  await p.screenshot({ path: `${SHOTS}/discover-players.png`, fullPage: true });
  check("mevki: Forvet", JSON.stringify(found(await search(p, "mevki=FWD"))) === JSON.stringify(["Forvet"]));
  check("mevki: Kaleci aramada çıkmaz (gizli)", found(await search(p, "mevki=GK")).length === 0);
  check("rating en az 80", JSON.stringify(found(await search(p, "min=80"))) === JSON.stringify(["Forvet"]));
  check("rating aralığı 70-72", JSON.stringify(found(await search(p, "min=70&max=72"))) === JSON.stringify(["Orta", "Defans"]));
  check("takımsız", JSON.stringify(found(await search(p, "takimsiz=1"))) === JSON.stringify(["Orta", "Defans"]));
  check("yetenek HIZ ≥ 80", JSON.stringify(found(await search(p, "yetenek=HIZ&ymin=80"))) === JSON.stringify(["Forvet"]));
  check("deneyim 5+ maç", JSON.stringify(found(await search(p, "mac=5"))) === JSON.stringify(["Forvet", "Orta"]));
  check("sıralama: isim", JSON.stringify(found(await search(p, "sirala=isim"))) === JSON.stringify(["Defans", "Forvet", "Orta"]));
  t = await search(p, "");
  check("takım adı ve 'Takımsız' etiketi", t.includes("e2e keşfet fk") && t.includes("takımsız"));
  check("özel grup adı sızmaz", !t.includes("e2e özel"));
  const il = await search(p, "il=Edirne&ilce=Merkez");
  check("ilçe filtresi çalışır", found(il).length === 3);
  await p.goto(`${BASE}/kesfet?sekme=oyuncu&il=Edirne&q=Zeki&min=70`);
  check("filtre açıkken panel açık gelir", await p.locator("details[open]").count() === 1);
  await p.locator("a", { hasText: "Zeki Forvet" }).first().click();
  await p.waitForURL(/\/oyuncu\//);
  check("sonuç satırı oyuncu profiline gider", (await body(p)).includes("zeki forvet"));

  console.log("Ayar: aramada görün");
  await p.goto(`${BASE}/profil/ayarlar/gorunurluk`);
  const box = p.locator('input[name="discoverable"]');
  check("ayar işaretli geliyor (varsayılan açık)", await box.isChecked());
  await box.uncheck();
  await p.locator('form:has(input[name="discoverable"]) button').click();
  await p.waitForURL(/saved=1/);
  check("kapatınca ayar kaydolur", !(await p.locator('input[name="discoverable"]').isChecked()));
  const other = await open(orta);
  check("kapatan kişi aramada görünmez", !found(await search(other, "")).includes("Defans"));

  console.log("Ana sayfa");
  await other.goto(BASE + "/");
  await other.waitForFunction(() => document.body.innerText.toLowerCase().includes("öne çıkan"), null, { timeout: 15000 }).catch(() => {});
  t = await body(other);
  check("'Öne çıkan oyuncular' bölümü", t.includes("öne çıkan oyuncular"));
  check("öne çıkanlarda yüksek ratingli oyuncu", t.includes("zeki forvet"));
  check("gizlenen (kaleci, defans) öne çıkanlarda yok", !t.includes("zeki kaleci") && !t.includes("zeki defans"));
  const chips = other.locator('[role="tablist"][aria-label="Öne çıkanların bölgesi"] [role="tab"]');
  check("bölge çipleri İlçe · İl · Türkiye (Merkez, Edirne, Türkiye)", (await chips.allInnerTexts()).join("|") === "Merkez|Edirne|Türkiye");
  const ilcePanel = other.locator('[role="tabpanel"]:visible').filter({ hasText: /öne çıkan oyuncular/i }).first();
  const ilceText = (await ilcePanel.innerText()).toLowerCase();
  // Defans gizlendi: Merkez'de 2 oyuncu kaldı (eski kural 3 kişi isteyip Türkiye'ye çıkıyordu: Lüleburgaz hatası)
  check("ilçe panelinde hiçbir bölüm üst kademeye geçmez ('yeterli kayıt yok' yok)", !ilceText.includes("yeterli kayıt yok") && !ilceText.includes("gösteriliyor"));
  check("ilçede takım yoksa boş durum ilçe adıyla", ilceText.includes("merkez için henüz sıralanacak takım yok"));
  for (const tab of ["Haftanın MVP'leri", "Yükselenler"]) {
    await ilcePanel.locator(`[role="tab"]:has-text("${tab}")`).click();
    const tt = (await ilcePanel.innerText()).toLowerCase();
    check(`${tab}: ilçede kalır, Türkiye'ye geçmez`, !tt.includes("yeterli kayıt yok") && tt.includes("merkez için"));
  }
  await ilcePanel.locator('[role="tab"]:has-text("En yüksek")').click();
  const cards = ilcePanel.locator('[role="tabpanel"]:visible a[href^="/oyuncu/"]');
  const names = (await cards.allInnerTexts()).map((x) => x.toLowerCase());
  check("öne çıkan oyuncular yan yana kart (Merkez: forvet, orta)", names.length === 2 && names[0].includes("zeki forvet") && names[1].includes("zeki orta"));
  check("kart altında sıra ve maç sayısı", names[0].includes("#1") && names[0].includes("5 maç"));
  await other.screenshot({ path: `${SHOTS}/discover-home.png`, fullPage: true });
  await chips.filter({ hasText: "Türkiye" }).click();
  const trPanel = other.locator('[role="tabpanel"]:visible').filter({ hasText: /öne çıkan takımlar/i }).first();
  check("Türkiye çipi seçilince Türkiye listesi görünür", await trPanel.isVisible());
  await trPanel.locator('[role="tab"]:has-text("Yükselenler")').click();
  check("oyuncu sekmesi değişir (Yükselenler)", (await trPanel.locator('[role="tab"][aria-selected="true"]').last().innerText()) === "Yükselenler");
  await other.screenshot({ path: `${SHOTS}/discover-home-tr.png`, fullPage: true });
  const bad = await other.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check("yatay taşma yok (390px)", !bad);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message); failed++;
} finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  await removeTestUsers(admin, users.map((u) => u.id));
}
console.log(failed ? `\n${failed} hata` : "\nTümü geçti");
process.exit(failed ? 1 : 0);

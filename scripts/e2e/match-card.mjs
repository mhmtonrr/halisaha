// Oyuncu ekle (davet) + canlı maç kartı + Keşfet "Adam arayan" + ana sayfa yapılacaklar (yeniden tasarım 5a):
// kaptan maç ekranındaki "Oyuncu ekle"den arkadaşa ve aramayla bulunan yabancıya davet gönderir (kişiye özel davet, 0043);
// gizli profil aramada yok; davetli sohbette canlı sayacı ve "Davetlisin"i görür, maça bakıp "Geliyorum" der (üye değil → ödünç);
// Keşfet ilanı il süzgeciyle "Adam arayan"da, yabancı oradan başvurur; takım üyesi ana sayfadan hızlı "Geliyorum" der.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const users = []; let browser;
const stamp = Date.now();
try {
  for (const [i, n] of ["Kart Kaptan", "Kart Arkadas", `Kart Yabanci ${stamp % 10000}`, "Kart Gizli", "Kart Uye", "Kart Kesifci"].entries()) {
    const email = `e2e-card-${stamp}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Edirne", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, F, , H, U, X] = users; // 3. kullanıcı: aramayla bulunan yabancı (adıyla aranır)
  await admin.from("profiles").update({ discoverable: false }).eq("id", H.id);
  const T = must(await admin.from("groups").insert({ name: `Kart Takimi ${stamp % 1000}`, kind: "team", created_by: K.id, city: "Edirne" }).select("id").single()).id;
  must(await admin.from("group_players").insert({ group_id: T, user_id: U.id, display_name: U.name, role: "member" }));
  const [a, b] = K.id < F.id ? [K.id, F.id] : [F.id, K.id];
  must(await admin.from("friendships").insert({ user_a: a, user_b: b, status: "accepted", requested_by: K.id }));
  // Kaptan maç ayarlar (kendi oturumuyla): 5v5, kadro 5, saat belli değil, takıma duyurulu
  const kc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  must(await kc.auth.signInWithPassword({ email: K.email, password: K.password }));
  const day = new Date(Date.now() + 3 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
  const M = must(await kc.rpc("create_match_v2", { p_group: T, p_day: day, p_time: null, p_team_size: 5, p_kind: "external", p_capacity: 5, p_venue: "Meydan Saha" }));

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, page.url(), e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const PK = await login(K);

  // --- Oyuncu ekle: arkadaş + aramayla yabancı; gizli profil aramada yok
  await PK.goto(`${BASE}/g/${T}/m/${M}`, { waitUntil: "networkidle" });
  await PK.click('button:text-is("Davet et")');
  check("arkadaşa davet gönderildi", !!(await PK.waitForSelector("text=✓ Davet edildi", { timeout: 15000 }).catch(() => null)));
  check("arkadaş 'davetli' kaydı aldı (onaysız davet)", (await admin.from("match_entries").select("status").eq("match_id", M).eq("user_id", F.id).single()).data?.status === "invited");
  await PK.click('button:text-is("Uygulamada ara")');
  await PK.selectOption('select[aria-label="İl"]', "");
  await PK.fill('input[aria-label="Oyuncu ara"]', "Kart Gizli");
  check("aramada gizli profil çıkmaz", !!(await PK.waitForSelector("text=Oyuncu bulunamadı", { timeout: 15000 }).catch(() => null)));
  await PK.fill('input[aria-label="Oyuncu ara"]', `Kart Yabanci ${stamp % 10000}`);
  await PK.click('button:text-is("Davet et")');
  for (let i = 0; i < 40 && !(await admin.from("match_entries").select("status").eq("match_id", M).eq("user_id", users[2].id).maybeSingle()).data; i++) await sleep(300);
  check("aramayla bulunan yabancıya da gönderildi", (await admin.from("match_entries").select("status").eq("match_id", M).eq("user_id", users[2].id).single()).data?.status === "invited");
  await PK.screenshot({ path: `${SHOTS}/card-picker.png`, fullPage: true });

  // --- Arkadaş sohbette canlı kartı görür, maça bakıp "Geliyorum" der (üye değil → ödünç)
  const PF = await login(F);
  const { data: th } = await admin.from("dm_messages").select("thread_id").eq("match_id", M).eq("kind", "match").limit(1).single();
  await PF.goto(`${BASE}/sohbet/${th.thread_id}`, { waitUntil: "networkidle" });
  check("kart başlığı 'Maça davet', canlı sayaç 1/5 ve 'Davetlisin'", (await PF.locator("text=Maça davet").count()) === 1 && (await PF.locator("text=1/5").count()) === 1 && (await PF.locator("text=Davetlisin").count()) === 1);
  await PF.screenshot({ path: `${SHOTS}/card-thread.png`, fullPage: true });
  await PF.click('a:has-text("Maça bak ve yanıtla")'); await PF.waitForURL(/\/m\//); await PF.waitForLoadState("networkidle");
  check("üye olmayan davetli maç ekranını görür", (await PF.locator("text=Bu maça çağrıldın").count()) === 1);
  await PF.click('form button:has-text("Geliyorum")'); await PF.waitForURL(/yanit=in/);
  check("davetli kadroya girdi (ödünç)", (await admin.from("group_players").select("is_loan").eq("group_id", T).eq("user_id", F.id).single()).data?.is_loan === true);
  await PF.goto(`${BASE}/sohbet/${th.thread_id}`, { waitUntil: "networkidle" });
  check("sohbet kartı güncel: 2/5 ve 'Kadrodasın'", (await PF.locator("text=2/5").count()) === 1 && (await PF.locator("text=Kadrodasın").count()) === 1);

  // --- Takım üyesi ana sayfadan hızlı "Geliyorum"
  const PU = await login(U);
  check("ana sayfada 'Maça geliyor musun?'", (await PU.locator("text=Maça geliyor musun?").count()) === 1);
  await PU.locator('form button:has-text("Geliyorum")').first().click();
  await PU.waitForLoadState("networkidle"); await sleep(1500);
  check("hızlı yanıtla kadroya girdi, ana sayfada kaldı", (await admin.from("match_entries").select("status").eq("match_id", M).eq("user_id", U.id).single()).data?.status === "in" && PU.url() === BASE + "/");

  // --- Keşfet ilanı → "Adam arayan" (il süzgeci) → yabancı başvurur
  must(await kc.rpc("create_listing", { p_match: M, p_target: null, p_positions: ["GK"], p_note: null }));
  const PX = await login(X);
  await PX.goto(`${BASE}/kesfet?sekme=mac&il=Edirne`, { waitUntil: "networkidle" });
  check("Keşfet 'Adam arayan'da maç, sayaç 3/5 ve mevki", (await PX.locator(`text=Kart Takimi ${stamp % 1000}`).count()) >= 1 && (await PX.locator("text=3/5").count()) >= 1 && (await PX.locator("text=Aranan: Kaleci").count()) >= 1);
  await PX.goto(`${BASE}/kesfet?sekme=mac&il=Bolu`, { waitUntil: "networkidle" });
  check("başka il süzgecinde yok", (await PX.locator(`text=Kart Takimi ${stamp % 1000}`).count()) === 0);
  await PX.goto(`${BASE}/kesfet?sekme=mac&il=Edirne`, { waitUntil: "networkidle" });
  await PX.screenshot({ path: `${SHOTS}/card-kesfet.png`, fullPage: true });
  await PX.click(`a:has-text("Kart Takimi ${stamp % 1000}")`); await PX.waitForURL(/\/m\//); await PX.waitForLoadState("networkidle");
  await PX.click('button:has-text("Başvur")'); await PX.waitForURL(/ok=basvuru/);
  check("Keşfet'ten başvuru onay bekliyor", (await admin.from("match_entries").select("status, source").eq("match_id", M).eq("user_id", X.id).single()).data?.source === "listing");
  await PX.goto(`${BASE}/kesfet?sekme=mac&il=Edirne`, { waitUntil: "networkidle" });
  check("Keşfet'te 'Başvurdun' rozeti", (await PX.locator("text=Başvurdun").count()) >= 1);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message.split("\n")[0]);
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exitCode = failed ? 1 : 0;

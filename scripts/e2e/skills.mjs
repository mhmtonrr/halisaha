// Yetenek oylaması: oy formunda "Yetenekler" bölümü → pusula kaydı → sunucuda hesaplama → karttaki değerler.
// Eşikler: en az 2 maç ve 2 farklı oy veren. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = ["Ali Atak", "Barış Bek", "Cem Orta", "Deniz Kaleci"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-skills-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: i === 3 ? "GK" : "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b, c, d] = users;
  const G = (await admin.from("groups").insert({ name: "E2E Yetenek Grubu", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G);
  for (const u of [b, c, d]) await admin.from("group_players").insert({ group_id: G, user_id: u.id, display_name: u.name, position: u.id === d.id ? "GK" : "MID" });
  const gp = async (u) => (await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", u.id).single()).data.id;
  const gps = { a: await gp(a), b: await gp(b), c: await gp(c), d: await gp(d) };

  const mkMatch = async () => {
    const m = (await admin.from("matches").insert({ group_id: G, played_at: new Date(Date.now() - 2 * 3600e3).toISOString(), created_by: a.id, kind: "internal", status: "voting", voting_deadline: new Date(Date.now() + 864e5).toISOString(), team_size: 5, score_a: 3, score_b: 2 }).select("id").single()).data.id;
    const { error: mpErr } = await admin.from("match_players").insert([
      { match_id: m, player_id: gps.a, team: "A", position: null, is_goalkeeper: false }, { match_id: m, player_id: gps.b, team: "A", position: null, is_goalkeeper: false },
      { match_id: m, player_id: gps.c, team: "B", position: null, is_goalkeeper: false }, { match_id: m, player_id: gps.d, team: "B", position: "GK", is_goalkeeper: true },
    ]);
    if (mpErr) throw new Error("kadro eklenemedi: " + mpErr.message);
    return m;
  };
  const m1 = await mkMatch(), m2 = await mkMatch();

  const client = async (u) => {
    const cl = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await cl.auth.signInWithPassword({ email: u.email, password: u.password });
    if (error) throw error;
    return cl;
  };
  const [aC, cC] = [await client(a), await client(c)];

  // 1) RPC kuralları (canlıda)
  let r = await aC.rpc("submit_skill_ballot", { p_match_id: m1, p_picks: { HIZ: [gps.b], ŞUT: [gps.b, gps.c] } });
  check("pusula gönderilir" + (r.error ? ` (${r.error.message})` : ""), !r.error);
  r = await aC.rpc("submit_skill_ballot", { p_match_id: m1, p_picks: { HIZ: [gps.a] } });
  check("kendine oy reddedilir", !!r.error);
  r = await aC.rpc("submit_skill_ballot", { p_match_id: m1, p_picks: { HIZ: [gps.d] } });
  check("saha kategorisinde kaleci reddedilir", !!r.error);
  r = await aC.rpc("submit_skill_ballot", { p_match_id: m1, p_picks: { REF: [gps.d], HIZ: [gps.b] } });
  check("kaleci kategorisinde kaleci kabul edilir" + (r.error ? ` (${r.error.message})` : ""), !r.error);
  await cC.rpc("submit_skill_ballot", { p_match_id: m1, p_picks: { HIZ: [gps.b], REF: [gps.d] } });
  await aC.rpc("submit_skill_ballot", { p_match_id: m2, p_picks: { HIZ: [gps.b] } });
  const { data: others } = await cC.from("skill_ballots").select("voter_id");
  check("kimse başkasının pusulasını göremez", (others ?? []).every((x) => x.voter_id === gps.c));

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };

  // 2) Arayüz: d (kaleci) oy formunda Barış'ı HIZ'da işaretler, gönderir → hesaplama tetiklenir
  const dP = await open(d);
  await dP.goto(`${BASE}/g/${G}/m/${m2}`);
  await dP.locator("summary:has-text('Yetenekler')").click();
  await dP.screenshot({ path: `${SHOTS}/90-yetenek-oylamasi.png`, fullPage: true });
  const hizBlock = dP.locator("div:has(> div > b:text-is('HIZ'))").first();
  await hizBlock.locator("button:has-text('Barış B.')").first().click();
  check("seçilen oyuncu işaretlenir", (await hizBlock.locator("button[aria-pressed='true']").count()) === 1);
  await dP.click('button:has-text("Oylarımı gönder")');
  await dP.waitForURL(/voted=1/, { timeout: 15000 });
  const { data: bal } = await admin.from("skill_ballots").select("id, skill_picks(category, nominee_id)").eq("match_id", m2).eq("voter_id", gps.d).maybeSingle();
  check("arayüzden gelen pusula kaydedildi", !!bal && bal.skill_picks.some((p) => p.category === "HIZ" && p.nominee_id === gps.b));

  // Sunucu yanıttan sonra hesaplar; en fazla ~15 sn bekle
  let skB = null;
  for (let i = 0; i < 15; i++) {
    skB = (await admin.from("player_skills").select("skills, voters, ballots").eq("player_id", gps.b).maybeSingle()).data;
    if (skB) break;
    await sleep(1000);
  }
  check("Barış'ın yetenekleri hesaplandı", !!skB);
  check("HIZ ortalamanın üstünde (4 oy, 3 farklı oy veren)", skB?.skills?.HIZ > 65 && skB.voters === 3 && skB.ballots === 2);
  const skC = (await admin.from("player_skills").select("skills").eq("player_id", gps.c).maybeSingle()).data;
  check("hiç işaret almayan oyuncunun HIZ'ı ortalamanın altında", skC?.skills?.HIZ < 65);
  const skD = (await admin.from("player_skills").select("skills").eq("player_id", gps.d).maybeSingle()).data;
  check("kaleci REF değeri hesaplandı (Ali işaretledi)", skD?.skills?.REF > 65);

  // 3) Kart ve profil
  const bP = await open(b);
  await bP.goto(`${BASE}/g/${G}/kadro`);
  await bP.waitForSelector("text=HIZ", { timeout: 10000 }).catch(() => {});
  await bP.screenshot({ path: `${SHOTS}/91-kadro-kartlar.png`, fullPage: true });
  const kadro = await bP.locator("body").innerText();
  check("kadro kartında yetenek kısaltmaları (HIZ ŞUT PAS DRİ DEF FİZ)", ["HIZ", "ŞUT", "PAS", "DRİ", "DEF", "FİZ"].every((k) => kadro.includes(k)));
  check("kartta bölge plaka kodu (34)", kadro.includes("34"));
  await bP.goto(`${BASE}/g/${G}/p/${gps.b}`);
  await bP.screenshot({ path: `${SHOTS}/92-oyuncu-sayfasi.png`, fullPage: true });
  await bP.goto(`${BASE}/profil`);
  await bP.screenshot({ path: `${SHOTS}/93-profil-kart.png`, fullPage: false });
  check("profil kartı HIZ gösterir", (await bP.locator("body").innerText()).includes("HIZ"));
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

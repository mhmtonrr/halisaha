// Yetenek değerlendirmesi: birlikte 2 maç oynayanlar 1-10 puanlar → /yetenek sayfası → sunucuda hesaplama → karttaki değerler.
// Eşikler: en az 2 ortak maç ve 2 farklı oy veren. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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
  await mkMatch();
  await mkMatch();

  const client = async (u) => {
    const cl = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await cl.auth.signInWithPassword({ email: u.email, password: u.password });
    if (error) throw error;
    return cl;
  };
  const [aC, cC, dC] = [await client(a), await client(c), await client(d)];

  // 1) Sıra ve kurallar (canlıda)
  const { data: qa } = await aC.rpc("skill_queue", { p_limit: 10 });
  check("2 maç birlikte oynayınca 3 kişi sırada", qa?.length === 3);
  check("kaleci 'keeper' işaretli", qa?.find((x) => x.target_player === gps.d)?.keeper === true);
  let r = await aC.rpc("submit_skill_rating", { p_target_player: gps.a, p_scores: { HIZ: 9 } });
  check("kendini değerlendiremez", !!r.error);
  r = await aC.rpc("submit_skill_rating", { p_target_player: gps.d, p_scores: { HIZ: 9 } });
  check("kaleciye saha yeteneği verilemez", !!r.error);
  // Diğer oy verenler: c ve d, b'yi yüksek, kendi diğer hedeflerini düşük puanlar (ayırt ediyorlar)
  r = await cC.rpc("submit_skill_rating", { p_target_player: gps.b, p_scores: { HIZ: 9, PAS: 7 } });
  check("c, Barış'ı puanlar" + (r.error ? ` (${r.error.message})` : ""), !r.error);
  await cC.rpc("submit_skill_rating", { p_target_player: gps.a, p_scores: { HIZ: 4, PAS: 6 } });
  await cC.rpc("submit_skill_rating", { p_target_player: gps.d, p_scores: { REF: 5 } });
  r = await dC.rpc("submit_skill_rating", { p_target_player: gps.b, p_scores: { HIZ: 8 } });
  await dC.rpc("submit_skill_rating", { p_target_player: gps.a, p_scores: { HIZ: 4 } });
  await dC.rpc("submit_skill_rating", { p_target_player: gps.c, p_scores: { HIZ: 5 } });
  const { data: others } = await cC.from("skill_ratings").select("voter_id");
  check("kimse başkasının değerlendirmesini göremez", (others ?? []).every((x) => x.voter_id === c.id));

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };

  // 2) Arayüz: Ali ana sayfada davet kartını görür, /yetenek'te Barış'ı puanlar
  const aP = await open(a);
  check("ana sayfada yetenek değerlendirmesi kartı", await aP.locator("text=Yetenek değerlendirmesi").first().isVisible());
  await aP.click("text=Yetenek değerlendirmesi");
  await aP.waitForURL(/\/yetenek/);
  await aP.screenshot({ path: `${SHOTS}/90-yetenek-sayfasi.png`, fullPage: true });
  const form = aP.locator("form:has-text('Barış Bek')");
  check("Kaydet düğmesi puan verilene dek kapalı", await form.locator("button:has-text('En az bir yeteneği puanla')").isDisabled());
  await form.locator("input[type=range]").nth(0).fill("9"); // HIZ
  await form.locator("input[type=range]").nth(1).fill("8"); // ŞUT
  await form.screenshot({ path: `${SHOTS}/91-yetenek-formu.png` });
  await form.locator("button:has-text('Kaydet')").click();
  await aP.waitForURL(/saved=1/, { timeout: 15000 });
  const { data: row } = await admin.from("skill_ratings").select("scores").eq("voter_id", a.id).eq("target_user", b.id).maybeSingle();
  check("arayüzden gelen değerlendirme kaydedildi (HIZ 9, ŞUT 8, diğerleri boş)", row?.scores?.HIZ === 9 && row.scores.ŞUT === 8 && !("PAS" in row.scores));
  check("puanlanan kişi sıradan çıktı", (await aP.locator("form:has-text('Barış Bek')").count()) === 0);

  // Sunucu yanıttan sonra hesaplar; en fazla ~15 sn bekle
  let skB = null;
  for (let i = 0; i < 15; i++) {
    skB = (await admin.from("user_skills").select("skills, voters").eq("user_id", b.id).maybeSingle()).data;
    if (skB) break;
    await sleep(1000);
  }
  check("Barış'ın yetenekleri hesaplandı", !!skB);
  check("HIZ ortalamanın üstünde (3 oy veren yüksek puan verdi)", skB?.skills?.HIZ > 65 && skB.voters === 3);
  check("tek kişinin puanladığı ŞUT henüz görünmez", skB?.skills?.ŞUT === null || skB?.skills?.ŞUT === undefined);
  // İkinci hedef: Ali, Cem'i de arayüzden düşük puanlar → Cem'in değeri (Deniz'le birlikte 2 oy veren) yeniden hesaplanır
  const formC = aP.locator("form:has-text('Cem Orta')");
  await formC.locator("input[type=range]").nth(0).fill("3");
  await formC.locator("button:has-text('Kaydet')").click();
  await aP.waitForURL(/saved=1/, { timeout: 15000 });
  let skC = null;
  for (let i = 0; i < 15; i++) {
    skC = (await admin.from("user_skills").select("skills, voters").eq("user_id", c.id).maybeSingle()).data;
    if (skC) break;
    await sleep(1000);
  }
  check("düşük puan alan Cem'in HIZ'ı ortalamanın altında (2 oy veren)", skC?.skills?.HIZ < 65 && skC.voters === 2);

  // 3) Kart ve profil
  const bP = await open(b);
  await bP.goto(`${BASE}/g/${G}/kadro`);
  await bP.waitForSelector("text=HIZ", { timeout: 10000 }).catch(() => {});
  await bP.screenshot({ path: `${SHOTS}/92-kadro-kartlar.png`, fullPage: true });
  const kadro = await bP.locator("body").innerText();
  check("kadro kartında yetenek kısaltmaları (HIZ ŞUT PAS DRİ DEF FİZ)", ["HIZ", "ŞUT", "PAS", "DRİ", "DEF", "FİZ"].every((k) => kadro.includes(k)));
  check("kartta bölge plaka kodu (34)", kadro.includes("34"));
  await bP.goto(`${BASE}/g/${G}/p/${gps.b}`);
  await bP.screenshot({ path: `${SHOTS}/93-oyuncu-sayfasi.png`, fullPage: true });
  await bP.goto(`${BASE}/profil`);
  await bP.screenshot({ path: `${SHOTS}/94-profil-kart.png`, fullPage: false });
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

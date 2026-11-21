// Oyuncu adlarından profile/oyuncu sayfasına bağlantılar: Oyuncular sayfası, maç kadrosu (planlanmış ve sonuç), ilan başvuranları.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));

const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of ["Kaan Kaptan", "Mert Üye"].entries()) {
    const email = `e2e-links-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b] = users;
  const G = (await admin.from("groups").insert({ name: "E2E Bağlantı Grubu", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G);
  await admin.from("group_players").insert({ group_id: G, user_id: b.id, display_name: b.name, position: "MID" });
  const gp = async (u) => (await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", u.id).single()).data.id;
  const [aG, bG] = [await gp(a), await gp(b)];
  const row = (m, p, team) => ({ match_id: m, player_id: p, team, goals: 0, assists: 0, saves: 0, position: null, is_goalkeeper: false });
  const mk = async (status) => (await admin.from("matches").insert({ group_id: G, played_at: new Date(Date.now() + (status === "planned" ? 72 : -48) * 3600e3).toISOString(), created_by: a.id, kind: "internal", status, team_size: 5, score_a: status === "planned" ? null : 2, score_b: status === "planned" ? null : 1 }).select("id").single()).data.id;
  const planned = await mk("planned"), closed = await mk("closed");
  for (const m of [planned, closed]) await admin.from("match_players").insert([row(m, aG, "A"), row(m, bG, "B")]);
  for (const [p, s] of [[aG, 7.5], [bG, 6]]) await admin.from("match_results").insert({ match_id: closed, player_id: p, performance: s / 10, match_score: s, votes_received: 2, weight: 1, rating_before: 65, rating_after: 65, is_mvp: false });

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
  await page.goto(BASE + "/login"); await page.fill('input[type="email"]', a.email); await page.fill('input[type="password"]', a.password);
  await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");

  await page.goto(`${BASE}/g/${G}/players`);
  check("Oyuncular sayfasında üye adı oyuncu sayfasına bağlantı", (await page.locator(`a[href="/g/${G}/p/${bG}"]`).count()) >= 1);
  await page.goto(`${BASE}/g/${G}/m/${planned}`);
  check("planlanmış maç kadrosunda oyuncu bağlantıları (iç içe bağlantı yok)", (await page.locator("a a").count()) === 0 && (await page.locator(`a[href="/g/${G}/p/${aG}"]`).count()) >= 1 && (await page.locator(`a[href="/g/${G}/p/${bG}"]`).count()) >= 1);
  await page.goto(`${BASE}/g/${G}/m/${closed}`);
  check("sonuçlanmış maçta satırlar zaten oyuncu bağlantısı (iç içe bağlantı yok)", (await page.locator(`a[href="/g/${G}/p/${bG}"]`).count()) >= 1 && (await page.locator("a a").count()) === 0);
  await page.locator(`a[href="/g/${G}/p/${bG}"]`).first().click();
  await page.waitForURL(new RegExp(`/g/${G}/p/${bG}`));
  check("bağlantı oyuncu sayfasını açar; oradan tüm istatistiklere geçilir", has(await page.locator("body").innerText(), "Tüm gruplardaki istatistikleri gör"));
  await page.click("text=Tüm gruplardaki istatistikleri gör");
  await page.waitForURL(new RegExp(`/oyuncu/${b.id}`));
  const t = await page.locator("body").innerText();
  check("/oyuncu/[id] profili: kart görünür, takım arkadaşı olduğu için istatistik de açık", has(t, "Mert Üye") && has(t, "İstatistik") && !has(t, "🔒"));
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

// Sayfa yanıt süresi ölçümü: geçici kullanıcı + grup/takım/maç oluşturur, giriş yapar, belirli sayfaların
// sunucu yanıt süresini (TTFB) ve tam yüklenme süresini ölçer, sonunda her şeyi siler.
// Kullanım: node scripts/perf/ttfb.mjs [taban-adres]   (varsayılan: canlı site)
import { createRequire } from "module";
import fs from "fs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = process.argv[2] ?? "https://halisaha-tawny.vercel.app";
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let user, browser; const groupIds = [];
try {
  const email = `perf-${Date.now()}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
  user = (await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Perf Test" } })).data.user;
  await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", user.id);
  const G = (await admin.from("groups").insert({ name: "Perf Grubu", created_by: user.id }).select("id").single()).data.id;
  const T = (await admin.from("groups").insert({ name: "Perf Takımı", kind: "team", city: "İstanbul", created_by: user.id }).select("id").single()).data.id;
  groupIds.push(G, T);
  const gp = (await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", user.id).single()).data.id;
  const M = (await admin.from("matches").insert({ group_id: G, played_at: new Date(Date.now() + 72 * 3600e3).toISOString(), created_by: user.id, kind: "internal", status: "planned", team_size: 5 }).select("id").single()).data.id;
  await admin.from("match_players").insert({ match_id: M, player_id: gp, team: "A", position: null, is_goalkeeper: false });

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(BASE + "/login");
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password);
  await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");

  const targets = [["Ana sayfa", "/"], ["Keşfet", "/kesfet"], ["Profil", "/profil"], ["Profil istatistik", "/profil?sekme=istatistik"], ["Grup", `/g/${G}`], ["Takım", `/g/${T}`], ["Maç", `/g/${G}/m/${M}`], ["Kadro", `/g/${G}/kadro`], ["Oyuncular", `/g/${G}/players`], ["Yetenek", "/yetenek"], ["Bildirimler", "/bildirimler"]];
  console.log(`Taban: ${BASE}\n${"Sayfa".padEnd(18)} TTFB (ms, 3 ölçümün ortancası)   Yüklenme (ms)`);
  for (const [name, path] of targets) {
    const ttfb = [], load = [];
    for (let i = 0; i < 3; i++) {
      await page.goto(BASE + path, { waitUntil: "load" });
      const t = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { ttfb: n.responseStart - n.startTime, load: n.loadEventEnd - n.startTime }; });
      ttfb.push(t.ttfb); load.push(t.load);
    }
    console.log(`${name.padEnd(18)} ${String(Math.round(median(ttfb))).padStart(6)}                          ${String(Math.round(median(load))).padStart(6)}`);
  }
} catch (e) { console.log("HATA:", e.message); }
finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  if (user) await admin.auth.admin.deleteUser(user.id);
}

// Futbolcu profili mevkisi gruba/takıma yansır; kendi aramızda ve rakibe karşı maç: sihirbaz → skor → oylama → sonuç.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { removeTestUsers } from "./cleanup.mjs";
import { fillSetup } from "./wizard.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? path.join(os.tmpdir(), "halisaha-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const names = ["Ahmet Yılmaz", "Burak Demir", "Cem Kaya", "Deniz Şahin"];
const users = []; let groupId, teamId;
const log = (...a) => console.log("•", ...a);
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
let browser;

async function sessionCookies(email, password) {
  const jar = [];
  const sb = createServerClient(URL_, ANON, { cookies: { getAll: () => jar, setAll: (l) => l.forEach((c) => { const i = jar.findIndex((x) => x.name === c.name); if (i >= 0) jar.splice(i, 1); jar.push(c); }) } });
  const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
  return jar.map((c) => ({ name: c.name, value: c.value, url: BASE }));
}

try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Pw-" + Math.random().toString(36).slice(2) + "A1!";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    // Karşılama tamamlanmış sayılsın; yoksa her sayfa /hosgeldin'e yönlenir
    await admin.from("profiles").update({ city: "İstanbul", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, name: n, cookies: await sessionCookies(email, password) });
  }
  browser = await chromium.launch();
  const ctxFor = async (u, scale = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
    await ctx.addCookies(u.cookies); const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    return { ctx, page };
  };
  const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const vote = async (page) => {
    const rows = page.locator("[data-vote-row]"); const n = await rows.count();
    const tabs = page.locator('[aria-label="Oylama"] [role="tab"]');
    for (let j = 0; j < n; j++) {
      const row = rows.nth(j);
      for (let k = 0; !(await row.isVisible()) && k < (await tabs.count()); k++) await tabs.nth(k).click();
      const t = 3 + ((j * 5 + Math.floor(Math.random() * 3)) % 7);
      await row.locator('[role="radio"]').nth(t - 1).click();
    }
    await page.locator('button:has-text("MVP"):visible').first().click();
    await page.click('button:has-text("Oylarımı gönder")'); await page.waitForURL(/voted=1/, { timeout: 30000 }); await page.waitForLoadState("networkidle");
  };

  // Profiller: herkes kendi mevkisini seçsin
  const profiles = [["MID", ["FWD"], "R", 10, "Orta sahanın beyni"], ["GK", [], "R", 1, ""], ["DEF", ["MID"], "L", 4, ""], ["FWD", ["MID"], "R", 9, "Gol makinesi"]];
  for (const [i, u] of users.entries()) {
    const { ctx, page } = await ctxFor(u, i === 0 ? 2 : 1);
    await page.goto(BASE + "/profil/ayarlar/futbolcu", { waitUntil: "networkidle" }); // mevki/ayak/forma Ayarlar > Futbolcu profili alt ekranında (0028)
    const [pos, sec, foot, shirt, bio] = profiles[i];
    await page.locator(`input[name="position"][value="${pos}"]`).check({ force: true });
    for (const s of sec) await page.locator(`input[name="secondary"][value="${s}"]`).check({ force: true });
    await page.locator(`input[name="foot"][value="${foot}"]`).check({ force: true });
    await page.fill('input[name="shirt"]', String(shirt));
    await page.fill('textarea[name="bio"]', bio);
    await page.click('button:has-text("Kaydet")'); await page.waitForURL(/saved=1/);
    if (i === 0) await shot(page, "01-profil");
    await ctx.close();
  }
  const { data: profs } = await admin.from("profiles").select("display_name, preferred_position, secondary_positions, shirt_number").in("id", users.map((u) => u.id));
  check("profiller kaydedildi (mevki, yan mevki, forma no)", profiles.every(([pos, sec, , shirt], i) => {
    const p = profs.find((x) => x.display_name === names[i]);
    return p?.preferred_position === pos && p.secondary_positions.join() === sec.join() && p.shirt_number === shirt;
  }));

  const A = await ctxFor(users[0], 2);
  // Grup /grup-kur'dan kurulur; diğerleri davet linkiyle katılır (misafir artık sadece maç ekranından eklenir, burada gerekmez)
  await A.page.goto(BASE + "/grup-kur"); await A.page.fill('input[name="name"]', "Salı Akşamı Ekibi"); await A.page.click('button:has-text("Grubu kur")');
  await A.page.waitForURL(/\/g\/[0-9a-f-]+$/); groupId = A.page.url().split("/g/")[1];
  const { data: g } = await admin.from("groups").select("invite_code").eq("id", groupId).single();
  for (const u of users.slice(1)) { const { ctx, page } = await ctxFor(u); await page.goto(`${BASE}/join/${g.invite_code}`); await page.waitForURL(/\/g\//); await ctx.close(); }
  const { data: gp } = await admin.from("group_players").select("display_name, position").eq("group_id", groupId);
  check("mevkiler gruba geldi", profiles.every(([pos], i) => gp.find((x) => x.display_name === names[i])?.position === pos));

  // Maç ayarla sihirbazı: yarın 21:00, seçilenler + ben; kadro formattan geldiği için eksik açılır, sonra kesinleştirilir
  const setup = async (gid, others, opponent) => {
    await A.page.goto(`${BASE}/mac-ayarla?grup=${gid}`, { waitUntil: "networkidle" });
    await fillSetup(A.page, { time: "21:00", opponent, pick: others });
    await A.page.click('button:has-text("Maçı kesinleştir")');
    await A.page.waitForURL(/ok=kesin/, { timeout: 30000 });
    await A.page.goto(A.page.url().split("?")[0], { waitUntil: "networkidle" });
  };

  // 1) Kendi aramızda maç: taraflar mevkiye göre dengelenir
  await setup(groupId, ["Burak", "Cem", "Deniz"]);
  const m1 = A.page.url();
  const { data: rosterPos } = await admin.from("match_players").select("team, position, group_players(display_name, position)").eq("match_id", m1.split("/m/")[1]);
  check("4 kişi, iki tarafa 2'şer", rosterPos.length === 4 && ["A", "B"].every((t) => rosterPos.filter((r) => r.team === t).length === 2));
  await A.page.fill('input[name="scoreA"]', "6"); await A.page.fill('input[name="scoreB"]', "4");
  await A.page.locator('input[name^="goals_"]').nth(1).fill("3"); await A.page.locator('input[name^="goals_"]').nth(3).fill("2");
  await A.page.click('button:has-text("oylamayı başlat")'); await A.page.locator('section[aria-label="Oylama"]').waitFor({ timeout: 30000 });
  for (const ui of [1, 2, 3, 0]) { const c = ui === 0 ? A : await ctxFor(users[ui]); await c.page.goto(m1); await vote(c.page); if (ui) await c.ctx.close(); }
  await A.page.goto(m1); await A.page.waitForSelector("text=Maçın adamı");
  const sum1 = await A.page.locator('section[aria-label="Maç özeti"]').innerText();
  check("iç maç kapandı: skor ve goller özette", ["6", "4", "3 gol", "2 gol"].every((x) => sum1.includes(x)));
  check("grupta puan tablosu sekmesi yok", (await A.page.locator('[role="tab"]:has-text("Puan tablosu")').count()) === 0);

  // 2) Rakip takıma karşı maç: grupta yok (kullanıcı kararı 2026-11-23), takımda açılır
  await A.page.goto(BASE + "/takim-kur"); await A.page.fill('input[name="name"]', "Salı Yıldızları"); await A.page.click('button:has-text("Takımı kur")');
  await A.page.waitForURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 20000 }); teamId = A.page.url().split("/g/")[1];
  const { data: tm } = await admin.from("groups").select("invite_code").eq("id", teamId).single();
  for (const u of users.slice(1)) { const { ctx, page } = await ctxFor(u); await page.goto(`${BASE}/join/${tm.invite_code}`); await page.waitForURL(/\/g\//); await ctx.close(); }
  await setup(teamId, ["Burak", "Cem", "Deniz"], "Yıldızspor");
  const m2 = A.page.url();
  await shot(A.page, "04-rakip-mac-kadro");
  const { data: m2rows } = await admin.from("match_players").select("team").eq("match_id", m2.split("/m/")[1]);
  check("rakip maçta tüm kadro A tarafında", m2rows.length === 4 && m2rows.every((r) => r.team === "A"));
  await A.page.fill('input[name="scoreA"]', "5"); await A.page.fill('input[name="scoreB"]', "3");
  await A.page.locator('input[name^="goals_"]').nth(3).fill("2");
  await A.page.click('button:has-text("oylamayı başlat")'); await A.page.locator('section[aria-label="Oylama"]').waitFor({ timeout: 30000 });
  { const c = await ctxFor(users[1], 2); await c.page.goto(m2); await shot(c.page, "05-rakip-mac-oylama"); await vote(c.page); await c.ctx.close(); }
  for (const ui of [2, 3, 0]) { const c = ui === 0 ? A : await ctxFor(users[ui]); await c.page.goto(m2); await vote(c.page); if (ui) await c.ctx.close(); }
  await A.page.goto(m2); await A.page.waitForSelector("text=Maçın adamı");
  check("takım maçında puan tablosu sekmesi var", (await A.page.locator('[role="tab"]:has-text("Puan tablosu")').count()) === 1);
  check("uygulamada olmayan rakipte kadro kartı yok, maç özeti var", (await A.page.locator("text=Kadro bekleniyor").count()) === 0 && (await A.page.locator("main >> text=/^4 kişi$/").count()) === 0 && (await A.page.locator('section[aria-label="Maç özeti"]').innerText()).toLocaleLowerCase("tr").includes("yıldızspor"));
  await shot(A.page, "06-rakip-mac-sonuc");

  await A.page.goto(`${BASE}/g/${groupId}`); await shot(A.page, "07-grup");
  await A.page.goto(`${BASE}/g/${groupId}/kadro`); await shot(A.page, "08-kadro");
  await A.page.click('button:has-text("Defans")'); const defCount = await A.page.locator('a[href*="/p/"]').count();
  check("kadro defans filtresi: 1 oyuncu (Cem)", defCount === 1);
  await A.page.click('button:has-text("Tümü")');
  await A.page.locator('a[href*="/p/"], a[href*="/oyuncu/"]').first().click(); await A.page.waitForURL(/\/(p|oyuncu)\//);
  await shot(A.page, "09-oyuncu-detay");

  const { data: res } = await admin.from("match_results").select("match_score, rating_after, is_mvp, group_players(display_name), matches!inner(group_id, kind)").in("matches.group_id", [groupId, teamId]);
  console.log("\nSonuçlar:"); for (const r of res.sort((a, b) => a.matches.kind.localeCompare(b.matches.kind) || b.match_score - a.match_score)) console.log(`  ${r.matches.kind.padEnd(8)} ${r.group_players.display_name.padEnd(14)} ${r.match_score.toFixed(1)}  → ${r.rating_after}${r.is_mvp ? " ⭐" : ""}`);
  check("iki maçın sonuçları yazıldı (8)", res.length === 8);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  for (const id of [groupId, teamId]) if (id) await admin.from("groups").delete().eq("id", id);
  await removeTestUsers(admin, users.map((u) => u.id));
  const { data: left } = await admin.from("profiles").select("id").in("id", users.map((u) => u.id));
  log(`temizlendi (kalan test profili: ${left?.length ?? 0})`);
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

// 0037/0046: üye maç önerisi → onay (format seçilir) → öneren adına toplanan maç → üyeler Geliyorum → öneren kesinleştirir (taraflar bölünür)
// → sessize alma (toplu "Maç ayarlanıyor" duyurusu gelmez). Canlı Supabase; test verisini siler.
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
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));
const trDate = (offsetDays) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

const names = ["Kerem Kurucu", "Orhan Organizatör", "Onur Öneren", "Ali Oyuncu", "Sena Sessiz"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-prop-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, O, N, A, S] = users;
  const C = (await admin.from("groups").insert({ name: "E2E Öneri Topluluğu", created_by: K.id, city: "İstanbul" }).select("id").single()).data.id;
  groupIds.push(C);
  for (const u of [O, N, A, S]) await admin.from("group_players").insert({ group_id: C, user_id: u.id, display_name: u.name, position: "MID" });
  await admin.from("group_players").update({ role: "organizer" }).eq("group_id", C).eq("user_id", O.id);

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 });
    return page;
  };
  const body = (p) => p.locator("body").innerText();
  const [oP, nP, aP, sP] = [await open(O), await open(N), await open(A), await open(S)];

  // 1) Üye maç önerir; başka üye görmez; organizatör görür ve onaylar
  await nP.goto(`${BASE}/g/${C}`);
  check("üye 'Maç ayarla' yerine 'Maç öner' görür", has(await body(nP), "Maç öner") && !has(await body(nP), "Maç ayarla"));
  await nP.locator("summary:has-text('Maç öner')").click();
  await nP.fill('#oneriler input[name="day"]', trDate(2));
  await nP.fill('#oneriler input[name="venue"]', "Petroller");
  await nP.fill('#oneriler input[name="note"]', "Cuma rakip ayarladım, adam lazım");
  await nP.click('button:has-text("Öneriyi gönder")');
  await nP.waitForURL(/oneri=gonderildi/, { timeout: 20000 });
  check("öneren 'Önerin gönderildi' görür", has(await body(nP), "Önerin gönderildi"));
  await aP.goto(`${BASE}/g/${C}`);
  check("başka üye öneriyi görmez", !has(await body(aP), "Cuma rakip ayarladım"));
  let notif = null;
  for (let i = 0; i < 10 && !notif; i++) { notif = (await admin.from("notifications").select("title").eq("user_id", O.id).like("title", "%Maç önerisi%")).data?.[0]; if (!notif) await sleep(1000); }
  check("organizatöre 'Maç önerisi' bildirimi gitti", !!notif);
  await oP.goto(`${BASE}/g/${C}`);
  check("organizatör öneriyi görür", has(await body(oP), "Maç önerileri · 1") && has(await body(oP), "Onur Öneren"));
  await oP.screenshot({ path: `${SHOTS}/p01-oneriler.png`, fullPage: true });
  // 0046: onayda format seçilir, öneren adına toplanan maç açılır
  await oP.selectOption('select[aria-label="Format"]', "6");
  await oP.click('button:has-text("Onayla, maçı ayarla")');
  await oP.waitForURL(/\/m\/[0-9a-f-]{36}/, { timeout: 20000 });
  const mid = oP.url().split("/m/")[1].split("?")[0];
  const { data: mm } = await admin.from("matches").select("created_by, status, team_size, capacity, roster_count").eq("id", mid).single();
  check("öneri onayıyla öneren adına toplanan maç açıldı (6v6, kadro 12, öneren kadroda)", mm.created_by === N.id && mm.status === "gathering" && mm.team_size === 6 && mm.capacity === 12 && mm.roster_count === 1);
  check("öneri maça bağlandı", (await admin.from("match_proposals").select("match_id").eq("group_id", C).eq("status", "accepted").single()).data.match_id === mid);

  // 2) Üyeler "Geliyorum" der; öneren (rolü olmadan) maçı yönetir ve kesinleştirir
  for (const p of [aP, sP, oP]) {
    await p.goto(`${BASE}/g/${C}/m/${mid}`, { waitUntil: "networkidle" });
    await p.click('form button:has-text("Geliyorum")');
    await p.waitForURL(/yanit=in/, { timeout: 20000 });
  }
  await nP.goto(`${BASE}/g/${C}/m/${mid}`, { waitUntil: "networkidle" });
  check("öneren 'Maçı kesinleştir' görür (4/12)", has(await body(nP), "Maçı kesinleştir") && has(await body(nP), "4/12"));
  await nP.screenshot({ path: `${SHOTS}/p02-oneri-maci.png`, fullPage: true });
  await nP.fill('input[aria-label="Maç saati"]', "21:00");
  await nP.click('button:has-text("Maçı kesinleştir")');
  await nP.waitForURL(/ok=kesin/, { timeout: 20000 });
  const { data: kk } = await admin.from("matches").select("status").eq("id", mid).single();
  const { data: sides } = await admin.from("match_players").select("team").eq("match_id", mid);
  check("öneren kesinleştirdi, taraflar bölündü", kk.status === "planned" && new Set(sides.map((x) => x.team)).size === 2);

  // 3) Sessize alma: Sena sessize alır; yeni maç duyurusu Ali'ye gider, Sena'ya gitmez
  await sP.goto(`${BASE}/g/${C}`);
  await sP.click('button:has-text("Sessize al")');
  await sP.waitForLoadState("networkidle");
  const { data: m } = await admin.from("group_players").select("muted").eq("group_id", C).eq("user_id", S.id).single();
  check("üye grubu sessize aldı", m.muted === true);
  const since = new Date().toISOString();
  await oP.goto(`${BASE}/mac-ayarla?grup=${C}`, { waitUntil: "networkidle" });
  await oP.fill('input[name="day"]', trDate(3));
  await oP.check("text=Saat belli değil");
  await oP.click('button:has-text("Maçı ayarla")');
  await oP.waitForURL(/\/m\/[0-9a-f-]{36}/, { timeout: 20000 });
  await sleep(4000);
  const got = async (u) => ((await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", u.id).eq("type", "match").like("title", "%Maç ayarlanıyor%").gt("created_at", since)).count ?? 0) > 0;
  check("sessize almayan üyeye yeni maç duyurusu gitti", await got(A));
  check("sessize alan üyeye toplu duyuru gitmedi", !(await got(S)));
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

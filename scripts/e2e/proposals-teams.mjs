// 0037: üye maç önerisi → onay → öneren kesinleştirir (grupta arayüz sadece kendi aramızda; hızlı/geçici takım RPC ile) → geçici takım listelerde ayrı,
// Keşfet'te yok → ödünç oyuncuya takım daveti → sessize alma (toplu duyuru gelmez). Canlı Supabase; test verisini siler.
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
const stamp = Date.now().toString(36).slice(-5);

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
  await oP.click('button:has-text("Onayla, çağrı aç")');
  await oP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const poll = oP.url().split("/cagri/")[1];
  const { data: pr } = await admin.from("match_polls").select("created_by, proposal_id").eq("id", poll).single();
  check("çağrı öneren adına açıldı", pr.created_by === N.id && !!pr.proposal_id);

  // 2) Yanıtlar; öneren kesinleştirme ekranında sadece "kendi aramızda" görür; hızlı takımla rakibe karşı (RPC)
  for (const p of [aP, sP]) {
    await p.goto(`${BASE}/g/${C}/cagri/${poll}`);
    await p.click('button[name="answer"]:has-text("Geliyorum")');
    await p.waitForLoadState("networkidle");
  }
  await nP.goto(`${BASE}/g/${C}/cagri/${poll}`);
  check("öneren (rolü olmadan) 'Kadroyu kesinleştir' görür", has(await body(nP), "Kadroyu kesinleştir"));
  await nP.goto(`${BASE}/g/${C}/cagri/${poll}?kesinlestir=1`);
  check(
    "grupta kesinleştirmede 'rakibe karşı' yok, 'Takım kur' yönlendirmesi var",
    (await nP.locator('input[name="kind"][value="external"]').count()) === 0 && has(await body(nP), "Takım kur"),
  );
  await nP.screenshot({ path: `${SHOTS}/p02-kesinlestir.png`, fullPage: true });
  // Arayüz grupta hızlı takım kurmuyor; RPC hâlâ destekliyor. Geçici takım davranışı (adım 3-4) için öneren adına RPC ile kurulur
  const asN = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await asN.auth.signInWithPassword({ email: N.email, password: N.password });
  const { data: mid, error: fe } = await asN.rpc("finalize_poll", {
    p_poll: poll, p_starts_at: `${trDate(2)}T21:00:00+03:00`, p_venue: "Petroller", p_team_size: null, p_kind: "external", p_team: null,
    p_opponent: "Yıldızspor", p_roster: [A, S].map((u) => ({ user_id: u.id, team: "A", gk: false })), p_new_team: `Cuma Ekibi ${stamp}`,
  });
  if (fe) throw fe;
  const T = (await admin.from("matches").select("group_id").eq("id", mid).single()).data.group_id;
  groupIds.push(T);
  const { data: t } = await admin.from("groups").select("name, is_temporary, city, created_by").eq("id", T).single();
  check("hızlı takım geçici kuruldu, öneren kaptan", t.is_temporary && t.created_by === N.id && t.city === "İstanbul");
  const { data: loans } = await admin.from("group_players").select("user_id, is_loan").eq("group_id", T).eq("is_loan", true);
  check("seçilen iki oyuncu hızlı takıma ödünç yazıldı", loans.length === 2);

  // 3) Geçici takım listelerde ayrı, Keşfet'te yok; şerit görünür
  await nP.goto(`${BASE}/`);
  const home = await body(nP);
  check("ana sayfada 'Geçici ve dağıtılmış takımlarım' bölümü var", has(home, "Geçici ve dağıtılmış takımlarım · 1"));
  await nP.goto(`${BASE}/g/${T}`);
  check("takım sayfasında 'Geçici takım' şeridi ve kaptana 'Kalıcı yap'", has(await body(nP), "Geçici takım") && has(await body(nP), "Kalıcı yap"));
  await nP.goto(`${BASE}/kesfet?il=&q=${encodeURIComponent("Cuma Ekibi " + stamp)}`);
  check("geçici takım Keşfet aramasında çıkmaz", !has(await body(nP), `Cuma Ekibi ${stamp}`));

  // 4) Ödünç oyuncuya takım daveti
  await nP.goto(`${BASE}/g/${T}/players`);
  await nP.locator('button:has-text("Takıma davet et")').first().click();
  await nP.waitForURL(/davet=1/, { timeout: 20000 });
  await nP.locator("text=Takım daveti gönderildi").waitFor({ timeout: 15000 }).catch(() => {});
  check("davet gönderildi mesajı", has(await body(nP), "Takım daveti gönderildi"));
  const { count: inv } = await admin.from("group_invites").select("*", { count: "exact", head: true }).eq("group_id", T).eq("status", "pending");
  check("ödünç oyuncuya bekleyen takım daveti oluştu", inv === 1);

  // 5) Sessize alma: Sena sessize alır; yeni çağrıda Ali'ye duyuru gider, Sena'ya gitmez
  await sP.goto(`${BASE}/g/${C}`);
  await sP.click('button:has-text("Sessize al")');
  await sP.waitForLoadState("networkidle");
  const { data: m } = await admin.from("group_players").select("muted").eq("group_id", C).eq("user_id", S.id).single();
  check("üye grubu sessize aldı", m.muted === true);
  const since = new Date().toISOString();
  await oP.goto(`${BASE}/g/${C}/cagri/yeni`);
  await oP.fill('input[name="day"]', trDate(3));
  await oP.click('button:has-text("Çağrıyı aç")');
  await oP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await sleep(4000);
  const got = async (u) => ((await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", u.id).eq("type", "poll").like("title", "%Maç çağrısı%").gt("created_at", since)).count ?? 0) > 0;
  check("sessize almayan üyeye yeni çağrı duyurusu gitti", await got(A));
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

// Bildirimler: olaylar doğru kişilere ulaşır (teklif, çağrı, oylama, sohbet, adam ara), olayı yapana gitmez, tercih kapalıysa gitmez,
// sohbet 10 dakikada tek bildirime birleşir, rozet canlı güncellenir, kutu okundu işaretlenir, hatırlatma cron'u bir kez gönderir.
// Cron adımı için sunucu CRON_SECRET=e2e-secret ile başlatılmalı (değilse o adım atlanır ve söylenir).
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Kullanım: node scripts/e2e/notifications.mjs [ekran-klasörü]
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
const trDate = (offsetDays) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
/** Koşul sağlanana kadar bekler (sunucu bildirimi yanıttan sonra gönderir) */
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* tekrar dene */ } await new Promise((r) => setTimeout(r, 400)); } return false; };

const names = ["Kaan Kaptan", "Mert Oyuncu", "Rıza Rakip", "Ahmet Başvuran"];
const users = []; const groupIds = []; let browser;
const notifs = async (u, type) => (await admin.from("notifications").select("type, title, body, url, read_at").eq("user_id", u.id).order("created_at")).data.filter((n) => !type || n.type === type);
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-notif-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [cap, mem, riv, apl] = users;
  const mkGroup = async (name, kind, owner, members) => {
    const { data: g } = await admin.from("groups").insert({ name, kind, ...(kind === "team" ? { city: "İstanbul", district: "Kadıköy", color: "#e11d48" } : {}), created_by: owner.id }).select("id").single();
    groupIds.push(g.id);
    for (const m of members) await admin.from("group_players").insert({ group_id: g.id, user_id: m.id, display_name: m.name, position: "MID" });
    return g.id;
  };
  const A = await mkGroup("E2E Bildirim Takımı", "team", cap, [mem]);
  const B = await mkGroup("E2E Rakip Takım", "team", riv, []);
  const G = await mkGroup("E2E Bildirim Grubu", "community", cap, [mem, apl]);
  const gp = async (g, u) => (await admin.from("group_players").select("id").eq("group_id", g).eq("user_id", u.id).single()).data.id;

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [capP, memP, rivP, aplP] = [await open(cap), await open(mem), await open(riv), await open(apl)];
  const badge = (p) => p.locator('nav a[href="/bildirimler"] span.rounded-full');

  // 1) Teklif: rakip kaptanın AÇIK ana sayfasında rozet canlı çıkar; gönderene bildirim gitmez
  await rivP.goto(BASE + "/"); await rivP.evaluate(() => { window.__live = 1; });
  await capP.goto(`${BASE}/g/${B}/teklif`);
  await capP.click('button:has-text("Teklifi gönder")'); await capP.waitForURL(/teklifler\?sent=1/);
  check("teklif: rakip kaptana 'offer' bildirimi yazıldı", !!(await until(async () => (await notifs(riv, "offer")).length === 1)));
  check("teklif bildirimi doğru metin ve adres", (await notifs(riv, "offer"))[0]?.title === "🤝 Maç teklifi geldi" && (await notifs(riv, "offer"))[0]?.url === `/g/${B}/teklifler`);
  check("teklifi gönderene bildirim gitmedi", (await notifs(cap)).length === 0);
  check("rakip kaptanın açık sayfasında rozet canlı '1' oldu", !!(await until(async () => (await badge(rivP).first().innerText()) === "1")));
  check("sayfa tam yenilenmedi", await rivP.evaluate(() => window.__live === 1));

  // 2) Bildirim kutusu: liste + otomatik okundu
  await rivP.goto(`${BASE}/bildirimler`);
  check("bildirim kutusunda teklif görünür", (await rivP.locator("text=Maç teklifi geldi").count()) > 0);
  await rivP.screenshot({ path: `${SHOTS}/90-bildirim-kutusu.png`, fullPage: true });
  check("kutu açılınca bildirim okundu işaretlenir", !!(await until(async () => (await notifs(riv, "offer"))[0].read_at)));
  check("okununca rozet kalkar", !!(await until(async () => (await badge(rivP).count()) === 0)));

  // 3) Tercih: teklif bildirimini kapat → ikinci teklifte bildirim gelmez
  await rivP.goto(`${BASE}/profil?sekme=ayarlar#bildirimler`);
  const offerBox = rivP.locator('button[role="switch"][aria-label="Maç teklifi"]');
  await offerBox.click();
  check("tercih kapatıldı (veritabanında offers=false)", !!(await until(async () => (await admin.from("notification_prefs").select("offers").eq("user_id", riv.id).single()).data.offers === false)));
  await rivP.screenshot({ path: `${SHOTS}/91-bildirim-ayarlari.png`, fullPage: true });
  await capP.goto(`${BASE}/g/${B}/teklif`);
  await capP.click('button:has-text("Teklifi gönder")'); await capP.waitForURL(/teklifler\?sent=1/);
  await new Promise((r) => setTimeout(r, 4000));
  check("tercih kapalıyken ikinci teklif için bildirim yazılmadı", (await notifs(riv, "offer")).length === 1);
  await offerBox.click();

  // 4) Teklif kabulü → teklifi gönderene bildirim
  await rivP.goto(`${BASE}/g/${B}/teklifler`);
  await rivP.locator('button:has-text("Kabul et")').first().click(); await rivP.waitForURL(/\/m\/[0-9a-f-]+\?kabul=1/);
  check("teklif kabul edilince gönderene 'kabul edildi' bildirimi", !!(await until(async () => (await notifs(cap, "offer")).some((n) => n.title.includes("kabul edildi")))));

  // 5) Çağrı: gruba yeni çağrı → üyelere (açan hariç)
  await capP.goto(`${BASE}/g/${G}/cagri/yeni`);
  await capP.fill('input[name="day"]', trDate(2));
  await capP.fill('input[name="venue"]', "Bildirim Sahası");
  await capP.click('button:has-text("Çağrıyı aç")'); await capP.waitForURL(/cagri\/[0-9a-f-]+$/);
  check("çağrı: iki üyeye 'poll' bildirimi", !!(await until(async () => (await notifs(mem, "poll")).length === 1 && (await notifs(apl, "poll")).length === 1)));
  check("çağrıyı açana bildirim yok", (await notifs(cap, "poll")).length === 0);
  check("çağrı bildirimi saha bilgisini taşır", (await notifs(mem, "poll"))[0].body.includes("Bildirim Sahası"));

  // 6) Oylama açıldı + hatırlatma cron'u
  const mid = (await admin.from("matches").insert({ group_id: A, played_at: new Date(Date.now() + 3 * 3600e3).toISOString(), created_by: cap.id, kind: "external", opponent_name: "Rakip FK", team_size: 7 }).select("id").single()).data.id;
  await admin.from("match_players").insert([await gp(A, cap), await gp(A, mem)].map((id) => ({ match_id: mid, player_id: id, team: "A" })));
  await capP.goto(`${BASE}/g/${A}/m/${mid}`);
  await capP.fill('input[name="scoreA"]', "3"); await capP.fill('input[name="scoreB"]', "2");
  await capP.click('button:has-text("oylamayı başlat")');
  await capP.locator("text=kişi oy verdi").waitFor({ timeout: 15000 });
  check("sonuç girilince oyuncuya 'oylama açıldı' bildirimi", !!(await until(async () => (await notifs(mem, "vote")).length === 1)));
  check("sonucu girene (kaptan) oylama bildirimi gitmedi", (await notifs(cap, "vote")).length === 0);
  check("oylama bildirimi maç adresine gider", (await notifs(mem, "vote"))[0].url === `/g/${A}/m/${mid}`);
  const unauthorized = await fetch(`${BASE}/api/cron/vote-reminders`);
  check("hatırlatma cron'u anahtarsız 401", unauthorized.status === 401);
  const wrong = await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer yanlis" } });
  check("yanlış anahtarla da 401", wrong.status === 401);
  const res1 = await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer e2e-secret" } });
  if (res1.status === 401) {
    console.log("  – ATLANDI: hatırlatma cron'u (sunucu CRON_SECRET=e2e-secret ile başlatılmamış)");
  } else {
    const r1 = await res1.json();
    check("cron: oy vermemiş iki kişiye hatırlatma (kaptan + oyuncu)", r1.reminded >= 2 && (await notifs(mem, "vote")).length === 2);
    const r2 = await (await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer e2e-secret" } })).json();
    check("ikinci çalıştırmada tekrar hatırlatma yok (en fazla 1)", r2.reminded === 0 && (await notifs(mem, "vote")).length === 2);
  }

  // 6b) Oylama süresi dolunca kapanır → kadroya "Sonuçlar açıklandı" (cron varsa cron kapatır, yoksa maç sayfası açılınca)
  await admin.from("matches").update({ voting_deadline: new Date(Date.now() - 60e3).toISOString() }).eq("id", mid);
  const cron = await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer e2e-secret" } });
  if (cron.status === 200) {
    check("cron süresi dolan oylamayı kapattı", (await cron.json()).finalized >= 1);
  } else {
    console.log("  – ATLANDI: cron ile kapatma (sunucu CRON_SECRET=e2e-secret ile başlatılmamış); maç sayfasıyla kapatılıyor");
    await memP.goto(`${BASE}/g/${A}/m/${mid}`);
  }
  check("oylama kapanınca maç kapandı", !!(await until(async () => (await admin.from("matches").select("status").eq("id", mid).single()).data.status === "closed")));
  const results = async () => (await notifs(mem, "vote")).find((n) => n.title.includes("Sonuçlar açıklandı"));
  check("oylama kapanınca oyuncuya '🏆 Sonuçlar açıklandı'", !!(await until(results)));
  check("sonuç bildirimi maç adresine gider", (await results())?.url === `/g/${A}/m/${mid}`);

  // 7) Sohbet: bildirim gider, 10 dakikada tek kalır
  await memP.goto(`${BASE}/g/${A}/sohbet`);
  await memP.fill('textarea[aria-label="Mesaj"]', "Selam kaptan, maç iyiydi!"); await memP.keyboard.press("Enter");
  check("sohbet: kaptana 'chat' bildirimi", !!(await until(async () => (await notifs(cap, "chat")).length === 1)));
  check("sohbet bildirimi gönderen adı ve mesajı içerir", (await notifs(cap, "chat"))[0].body.includes("Mert Oyuncu: Selam kaptan"));
  await memP.fill('textarea[aria-label="Mesaj"]', "İkinci mesaj hemen arkasından"); await memP.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 4000));
  check("10 dakika içinde ikinci mesaj yeni bildirim üretmedi (birleştirme)", (await notifs(cap, "chat")).length === 1);
  check("mesajı yazana kendi mesajı için bildirim gitmedi", (await notifs(mem, "chat")).length === 0);

  // 8) Adam ara: açılınca takım üyesine; başvuru → açana; kadroya alınınca → başvurana
  const mid2 = (await admin.from("matches").insert({ group_id: A, played_at: new Date(Date.now() + 4 * 864e5).toISOString(), created_by: cap.id, kind: "external", opponent_name: "Rakip 2", team_size: 7 }).select("id").single()).data.id;
  await admin.from("match_players").insert({ match_id: mid2, player_id: await gp(A, cap), team: "A" });
  await capP.goto(`${BASE}/g/${A}/m/${mid2}`);
  await capP.locator("summary:has-text('Adam ara')").click();
  await capP.selectOption('select[name="needed"]', "1");
  await capP.click('button:has-text("🔎 Adam ara")');
  await capP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const F = capP.url().split("/cagri/")[1];
  const fillN = async () => (await notifs(mem, "poll")).filter((n) => n.url === `/g/${A}/cagri/${F}`);
  check("adam ara: takım üyesine '1 oyuncu aranıyor' bildirimi", !!(await until(async () => (await fillN()).some((n) => n.title.includes("1 oyuncu aranıyor")))));
  check("adam arayana kendi araması için bildirim yok", !(await notifs(cap, "poll")).some((n) => n.url === `/g/${A}/cagri/${F}`));
  await memP.goto(`${BASE}/g/${A}/cagri/${F}`);
  await memP.click('button[name="answer"]:has-text("Geliyorum")');
  await memP.waitForLoadState("networkidle");
  check("başvuru: açana 'Adam aramana başvuru' bildirimi", !!(await until(async () => (await notifs(cap, "poll")).some((n) => n.title.includes("Adam aramana başvuru")))));
  check("başvuru bildirimi başvuranın adını taşır", (await notifs(cap, "poll")).find((n) => n.title.includes("Adam aramana başvuru"))?.body.includes("Mert Oyuncu"));
  await capP.goto(`${BASE}/g/${A}/cagri/${F}`);
  await capP.click('button:has-text("Kadroya al")');
  await capP.waitForLoadState("networkidle");
  check("kadroya alınınca başvurana '⚽ Kadrodasın'", !!(await until(async () => (await notifs(mem, "match")).some((n) => n.title.includes("Kadrodasın")))));
  check("kabul bildirimi maç adresine gider", (await notifs(mem, "match")).find((n) => n.title.includes("Kadrodasın"))?.url === `/g/${A}/m/${mid2}`);

  // 9) Elle kadrodan çıkarma / ekleme → oyuncuya bildirim
  const memA = await gp(A, mem);
  const kadrodasin = async () => (await notifs(mem, "match")).filter((n) => n.title.includes("Kadrodasın")).length;
  await capP.goto(`${BASE}/g/${A}/m/${mid2}`);
  await capP.locator("summary:has-text('Kadroya oyuncu ekle')").click();
  await capP.locator(`form:has(input[name="playerId"][value="${memA}"]) button:has-text("Çıkar")`).click();
  check("elle çıkarılana 'kadrosundan çıkarıldın'", !!(await until(async () => (await notifs(mem, "match")).some((n) => n.title.includes("kadrosundan çıkarıldın")))));
  await capP.goto(`${BASE}/g/${A}/m/${mid2}`);
  await capP.locator("summary:has-text('Kadroya oyuncu ekle')").click();
  await capP.locator(`label:has(input[value="${memA}"])`).click();
  await capP.click('button:has-text("Seçilenleri ekle")');
  check("elle eklenene '⚽ Kadrodasın'", !!(await until(async () => (await kadrodasin()) === 2)));

  // 10) Maç iptali → kadroya bildirim (iptal edene gitmez)
  await capP.goto(`${BASE}/g/${A}/m/${mid2}`);
  await capP.click('button:has-text("Maçı iptal et")');
  await capP.waitForURL(`${BASE}/g/${A}`);
  check("maç iptal edilince kadroya '❌ Maç iptal edildi'", !!(await until(async () => (await notifs(mem, "match")).some((n) => n.title.includes("Maç iptal edildi")))));
  check("iptal edene bildirim yok", !(await notifs(cap, "match")).some((n) => n.title.includes("Maç iptal edildi")));

  // 11) Takımlar arası maç (4'te kabul edilen): skor girince rakibe, farklı skor girilince iki tarafa
  const lA = (await admin.from("matches").select("id, challenge_id").eq("group_id", A).not("challenge_id", "is", null).single()).data;
  const lB = (await admin.from("matches").select("id").eq("challenge_id", lA.challenge_id).neq("id", lA.id).single()).data;
  await admin.from("match_players").insert([await gp(A, cap), memA].map((id) => ({ match_id: lA.id, player_id: id, team: "A" })));
  await capP.goto(`${BASE}/g/${A}/m/${lA.id}`);
  await capP.fill('input[name="scoreA"]', "2"); await capP.fill('input[name="scoreB"]', "1");
  await capP.click('button:has-text("Skoru kaydet")'); await capP.waitForURL(/skor=waiting/);
  const scored = async () => (await notifs(riv, "match")).find((n) => n.title.includes("Rakip takım skoru girdi"));
  check("skor girilince rakip kaptana 'Rakip takım skoru girdi'", !!(await until(scored)));
  check("skor rakibin açısından yazılır (1-2)", (await scored())?.body.includes("1-2"));
  const { data: guest } = await admin.from("group_players").insert({ group_id: B, user_id: null, display_name: "Misafir B", position: "MID" }).select("id").single();
  await admin.from("match_players").insert([await gp(B, riv), guest.id].map((id) => ({ match_id: lB.id, player_id: id, team: "A" })));
  await rivP.goto(`${BASE}/g/${B}/m/${lB.id}`);
  await rivP.fill('input[name="scoreA"]', "1"); await rivP.fill('input[name="scoreB"]', "1");
  await rivP.click('button:has-text("Skoru kaydet")'); await rivP.waitForURL(/skor=mismatch/);
  check("skorlar uyuşmayınca diğer kaptana '⚠️ Skorlar uyuşmuyor'", !!(await until(async () => (await notifs(cap, "match")).some((n) => n.title.includes("Skorlar uyuşmuyor")))));

  // 12) Bekleyen teklif geri çekilince karşı takıma (3'teki ikinci teklif)
  await admin.from("notification_prefs").update({ offers: true }).eq("user_id", riv.id);
  await capP.goto(`${BASE}/g/${A}/teklifler`);
  await capP.locator('button:has-text("Teklifi geri çek")').first().click();
  check("teklif geri çekilince rakibe bildirim", !!(await until(async () => (await notifs(riv, "offer")).some((n) => n.title.includes("geri çekildi")))));
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

// Bildirimler: olaylar doğru kişilere ulaşır (teklif, çağrı, oylama, sohbet, ilan), olayı yapana gitmez, tercih kapalıysa gitmez,
// sohbet 10 dakikada tek bildirime birleşir, rozet canlı güncellenir, kutu okundu işaretlenir, hatırlatma cron'u bir kez gönderir.
// Sunucu CRON_SECRET=e2e-secret ile başlatılmalı. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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
  await rivP.goto(`${BASE}/profil#bildirimler`);
  const offerBox = rivP.locator('label:has-text("Teklif ve oyuncu ilanı") input[type="checkbox"]');
  await offerBox.uncheck();
  check("tercih kapatıldı (veritabanında offers=false)", !!(await until(async () => (await admin.from("notification_prefs").select("offers").eq("user_id", riv.id).single()).data.offers === false)));
  await rivP.screenshot({ path: `${SHOTS}/91-bildirim-ayarlari.png`, fullPage: true });
  await capP.goto(`${BASE}/g/${B}/teklif`);
  await capP.click('button:has-text("Teklifi gönder")'); await capP.waitForURL(/teklifler\?sent=1/);
  await new Promise((r) => setTimeout(r, 4000));
  check("tercih kapalıyken ikinci teklif için bildirim yazılmadı", (await notifs(riv, "offer")).length === 1);
  await offerBox.check();

  // 4) Teklif kabulü → teklifi gönderene bildirim
  await rivP.goto(`${BASE}/g/${B}/teklifler`);
  await rivP.locator('button:has-text("Kabul et")').first().click(); await rivP.waitForURL(/\/m\/[0-9a-f-]+\?kabul=1/);
  check("teklif kabul edilince gönderene 'kabul edildi' bildirimi", !!(await until(async () => (await notifs(cap, "offer")).some((n) => n.title.includes("kabul edildi")))));

  // 5) Çağrı: gruba yeni çağrı → üyelere (açan hariç)
  await capP.goto(`${BASE}/g/${G}/cagri/yeni`);
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
  const r1 = await (await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer e2e-secret" } })).json();
  check("cron: oy vermemiş iki kişiye hatırlatma (kaptan + oyuncu)", r1.reminded >= 2 && (await notifs(mem, "vote")).length === 2);
  const r2 = await (await fetch(`${BASE}/api/cron/vote-reminders`, { headers: { authorization: "Bearer e2e-secret" } })).json();
  check("ikinci çalıştırmada tekrar hatırlatma yok (en fazla 1)", r2.reminded === 0 && (await notifs(mem, "vote")).length === 2);

  // 7) Sohbet: bildirim gider, 10 dakikada tek kalır
  await memP.goto(`${BASE}/g/${A}/sohbet`);
  await memP.fill('textarea[aria-label="Mesaj"]', "Selam kaptan, maç iyiydi!"); await memP.keyboard.press("Enter");
  check("sohbet: kaptana 'chat' bildirimi", !!(await until(async () => (await notifs(cap, "chat")).length === 1)));
  check("sohbet bildirimi gönderen adı ve mesajı içerir", (await notifs(cap, "chat"))[0].body.includes("Mert Oyuncu: Selam kaptan"));
  await memP.fill('textarea[aria-label="Mesaj"]', "İkinci mesaj hemen arkasından"); await memP.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 4000));
  check("10 dakika içinde ikinci mesaj yeni bildirim üretmedi (birleştirme)", (await notifs(cap, "chat")).length === 1);
  check("mesajı yazana kendi mesajı için bildirim gitmedi", (await notifs(mem, "chat")).length === 0);

  // 8) İlan: başvuru → takım yetkilisine; kabul → başvurana
  const mid2 = (await admin.from("matches").insert({ group_id: A, played_at: new Date(Date.now() + 4 * 864e5).toISOString(), created_by: cap.id, kind: "external", opponent_name: "Rakip 2", team_size: 7 }).select("id").single()).data.id;
  await admin.from("match_players").insert({ match_id: mid2, player_id: await gp(A, cap), team: "A" });
  const L = (await admin.from("player_listings").insert({ group_id: A, match_id: mid2, created_by: cap.id, needed: 1 }).select("id").single()).data.id;
  await aplP.goto(`${BASE}/ilan/${L}`);
  await aplP.click('button:has-text("Başvur")');
  await aplP.locator("text=Yanıt bekliyor").first().waitFor({ timeout: 12000 });
  check("ilan başvurusu: takım yetkilisine bildirim", !!(await until(async () => (await notifs(cap, "listing")).length === 1)));
  check("ilan bildirimi başvuranın adını taşır", (await notifs(cap, "listing"))[0].body.includes("Ahmet Başvuran"));
  await capP.goto(`${BASE}/g/${A}/m/${mid2}`);
  await capP.locator("summary:has-text('Oyuncu arıyoruz')").click().catch(() => {});
  await capP.locator('button:has-text("Kadroya al")').first().waitFor({ timeout: 12000 }).catch(async () => { await capP.locator("summary:has-text('Oyuncu arıyoruz')").click(); });
  await capP.locator('button:has-text("Kadroya al")').first().click();
  check("başvuru kabul edilince başvurana 'kadroya alındın'", !!(await until(async () => (await notifs(apl, "listing")).some((n) => n.title.includes("Kadroya alındın")))));
  check("kabul bildirimi maç adresine gider", (await notifs(apl, "listing")).find((n) => n.title.includes("Kadroya alındın"))?.url === `/g/${A}/m/${mid2}`);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

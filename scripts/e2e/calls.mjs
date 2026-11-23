// Birleşik çağrı (0035): toplama çağrısı (sadece gün) → yanıtlar → kadroyu kesinleştir (kendi aramızda) → yedek →
// çekilme + yer açıldı → yedeği kadroya al → adam ara (toplulukta) → rakibe karşı kesinleştirme (takıma ödünç).
// Canlı Supabase'e karşı çalışır; test kullanıcılarını ve gruplarını sonunda siler. Kullanım: node scripts/e2e/calls.mjs [ekran-klasörü]
import { createRequire } from "module";
import fs from "fs";
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

const names = ["Kerem Kurucu", "Orhan Organizatör", "Kaan Kaleci", "Deniz Defans", "Batu Belki", "Yusuf Yedek"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-call-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, O, P1, P2, P3, P4] = users;
  // Topluluk: Kerem kurucu, Orhan organizatör, diğerleri üye. Takım: Orhan kaptan.
  const C = (await admin.from("groups").insert({ name: "E2E Çağrı Topluluğu", created_by: K.id }).select("id").single()).data.id;
  groupIds.push(C);
  for (const u of [O, P1, P2, P3, P4]) await admin.from("group_players").insert({ group_id: C, user_id: u.id, display_name: u.name, position: "MID" });
  await admin.from("group_players").update({ role: "organizer" }).eq("group_id", C).eq("user_id", O.id);
  const T = (await admin.from("groups").insert({ name: "E2E Hızlı Takım", created_by: O.id, kind: "team", city: "İstanbul" }).select("id").single()).data.id;
  groupIds.push(T);

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 });
    return page;
  };
  const body = (p) => p.locator("body").innerText();
  const [kP, oP, p1P, p2P, p3P, p4P] = [await open(K), await open(O), await open(P1), await open(P2), await open(P3), await open(P4)];

  // 1) Üye çağrı açamaz; organizatör sadece günle açar
  await p1P.goto(`${BASE}/g/${C}`);
  check("üye 'Kimler gelir?' düğmesini görmez", !has(await body(p1P), "Kimler gelir?"));
  await p1P.goto(`${BASE}/g/${C}/cagri/yeni`);
  check("üye çağrı açma sayfasından geri gönderilir", !p1P.url().includes("/cagri/yeni"));
  await oP.goto(`${BASE}/g/${C}`);
  await oP.click('a:has-text("Kimler gelir?")');
  await oP.waitForURL(/cagri\/yeni/);
  await oP.fill('input[name="day"]', trDate(2));
  await oP.fill('input[name="venue"]', "Petroller");
  await oP.screenshot({ path: `${SHOTS}/c01-cagri-ac.png`, fullPage: true });
  await oP.click('button:has-text("Çağrıyı aç")');
  await oP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const poll = oP.url().split("/cagri/")[1];
  check("çağrı sayfası 'saat belli değil' gösterir", has(await body(oP), "saat belli değil"));
  const { data: pr } = await admin.from("match_polls").select("purpose, status, starts_at, play_on").eq("id", poll).single();
  check("veritabanında toplama çağrısı, saat boş", pr.purpose === "gather" && pr.status === "open" && pr.starts_at === null && pr.play_on === trDate(2));

  // 2) Yanıtlar
  const answer = async (page, label, position, id = poll) => {
    await page.goto(`${BASE}/g/${C}/cagri/${id}`);
    if (position) await page.selectOption('select[name="position"]', position);
    await page.click(`button[name="answer"]:has-text("${label}")`);
    await page.waitForLoadState("networkidle");
  };
  await answer(p1P, "Geliyorum", "GK");
  await answer(p2P, "Geliyorum");
  await answer(p3P, "Belki");
  await answer(kP, "Geliyorum");
  await answer(p4P, "Geliyorum");
  check("yanıt veren 'kararını bekliyorsun' görür", has(await body(p1P), "kararını bekliyorsun"));
  const { data: resp } = await admin.from("poll_responses").select("user_id, answer, position").eq("poll_id", poll);
  check("5 yanıt kaydedildi (4 geliyorum, 1 belki), mevki saklandı",
    resp.length === 5 && resp.filter((r) => r.answer === "yes").length === 4 && resp.find((r) => r.user_id === P1.id)?.position === "GK");
  await p2P.goto(`${BASE}/g/${C}/cagri/${poll}`);
  check("üye 'Kadroyu kesinleştir' düğmesini görmez", !has(await body(p2P), "Kadroyu kesinleştir"));
  await p1P.goto(`${BASE}/`);
  check("ana sayfada yanıtlanan çağrı tekrar 'geliyor musun' diye sorulmaz", !has(await body(p1P), "Maça geliyor musun?"));
  await p3P.goto(`${BASE}/g/${C}`);
  check("grup sayfasında çağrı listelenir", has(await body(p3P), "saat belli değil"));

  // 3) Organizatör düzenler (saat) ve kesinleştirir: Yusuf işaretsiz → yedek, Batu (belki) seçilir
  await oP.goto(`${BASE}/g/${C}/cagri/${poll}?duzenle=1`);
  await oP.fill('input[name="time"]', "20:00");
  await oP.click('button:has-text("Kaydet ve yanıt verenlere haber ver")');
  await oP.waitForURL(new RegExp(`cagri/${poll}$`), { timeout: 20000 });
  check("düzenlenen saat çağrıda görünür", has(await body(oP), "20:00"));
  await oP.goto(`${BASE}/g/${C}/cagri/${poll}?kesinlestir=1`);
  const t3 = await body(oP);
  check("kesinleştirme ekranı geliyorum ve belki diyenleri listeler", ["Kaan Kaleci", "Deniz Defans", "Batu Belki", "Yusuf Yedek", "Kerem Kurucu"].every((n) => has(t3, n)));
  check("ilk geliyorumcular işaretli, belki işaretsiz gelir",
    (await oP.isChecked(`input[name="players"][value="${P4.id}"]`)) && !(await oP.isChecked(`input[name="players"][value="${P3.id}"]`)));
  check("profilde/yanıtta kaleci olan 🧤 işaretli gelir", await oP.isChecked(`input[name="gk"][value="${P1.id}"]`));
  await oP.fill('input[name="time"]', "21:00");
  await oP.uncheck(`input[name="players"][value="${P4.id}"]`);
  await oP.check(`input[name="players"][value="${P3.id}"]`);
  await oP.screenshot({ path: `${SHOTS}/c02-kesinlestir.png`, fullPage: true });
  await oP.click('button:has-text("Kadroyu kesinleştir ve maçı kur")');
  await oP.waitForURL(/\/m\/[0-9a-f-]{36}/, { timeout: 30000 });
  const M = oP.url().split("/m/")[1].split(/[?#]/)[0];
  const { data: mrow } = await admin.from("matches").select("group_id, kind, created_by, status").eq("id", M).single();
  check("maç toplulukta, kendi aramızda, organizatör adına kuruldu", mrow.group_id === C && mrow.kind === "internal" && mrow.created_by === O.id);
  const { data: mp } = await admin.from("match_players").select("team, is_goalkeeper, group_players(user_id)").eq("match_id", M);
  const inM = (u) => mp.some((r) => (Array.isArray(r.group_players) ? r.group_players[0] : r.group_players)?.user_id === u.id);
  check("kadroda 4 kişi: Kerem, Kaan, Deniz, Batu; Yusuf yok", mp.length === 4 && [K, P1, P2, P3].every(inM) && !inM(P4));
  check("taraflar 2-2 bölündü, Kaan kaleci", mp.filter((r) => r.team === "A").length === 2 && mp.some((r) => r.is_goalkeeper));
  const st = async (u) => (await admin.from("poll_responses").select("status").eq("poll_id", poll).eq("user_id", u.id).single()).data?.status;
  check("Yusuf yedek, Batu kadroda", (await st(P4)) === "reserve" && (await st(P3)) === "selected");
  await oP.screenshot({ path: `${SHOTS}/c03-mac.png`, fullPage: true });
  await p4P.goto(`${BASE}/`);
  check("yedek ana sayfada 'Yedektesin' görür", has(await body(p4P), "Yedektesin"));

  // 4) Deniz çekilir, organizatör onaylar → yer açıldı bildirimi → Yusuf'u kadroya alır
  await p2P.goto(`${BASE}/g/${C}/m/${M}`);
  await p2P.locator("summary:has-text('Maçtan çekilmek istiyorum')").click();
  await p2P.click('button:has-text("Çekilme isteği gönder")');
  await p2P.waitForURL(/cekilme=pending/, { timeout: 20000 });
  await oP.goto(`${BASE}/g/${C}/m/${M}`);
  check("maçı kuran organizatör çekilme isteğini görür", has(await body(oP), "Çekilme istekleri"));
  await oP.click('button:has-text("Onayla, kadrodan çıkar")');
  await oP.waitForURL(/cekilme=approved-by-admin/, { timeout: 20000 });
  let spot = null;
  for (let i = 0; i < 12 && !spot; i++) {
    spot = (await admin.from("notifications").select("title, url").eq("user_id", O.id).like("title", "%yer açıldı%")).data?.[0];
    if (!spot) await sleep(1000);
  }
  check("organizatöre 'kadroda yer açıldı' bildirimi gitti", !!spot && spot.url === `/g/${C}/cagri/${poll}`);
  check("çekilenin yanıtı 'çekildi' oldu", (await st(P2)) === "withdrawn");
  await oP.goto(`${BASE}/g/${C}/cagri/${poll}`);
  check("organizatör yedekler listesinde Yusuf'u görür", has(await body(oP), "Yedekler · 1") && has(await body(oP), "Yusuf Yedek"));
  await oP.click('button:has-text("Kadroya al")');
  await oP.waitForLoadState("networkidle");
  check("Yusuf kadroya alındı", (await st(P4)) === "selected");

  // 5) Adam ara (maç ekranından, toplulukta): Deniz başvurur, organizatör alır → doldu
  await oP.goto(`${BASE}/g/${C}/m/${M}`);
  await oP.locator("summary:has-text('Adam ara')").click();
  await oP.selectOption('select[name="needed"]', "1");
  await oP.check('input[name="positions"][value="DEF"]');
  await oP.click('button:has-text("🔎 Adam ara")');
  await oP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const fill = oP.url().split("/cagri/")[1];
  check("adam arama sayfası açıldı", has(await body(oP), "Adam aranıyor") && has(await body(oP), "1 oyuncu"));
  await answer(p2P, "Geliyorum", "DEF", fill);
  await oP.goto(`${BASE}/g/${C}/cagri/${fill}`);
  check("organizatör başvuruyu görür", has(await body(oP), "Başvurular · 1") && has(await body(oP), "Deniz Defans"));
  await oP.click('button:has-text("Kadroya al")');
  await oP.waitForLoadState("networkidle");
  const { data: fr } = await admin.from("match_polls").select("status").eq("id", fill).single();
  check("sayı dolunca adam arama 'doldu' oldu", fr.status === "filled");

  // 6) Rakibe karşı: yeni çağrı → takıma ödünç
  await oP.goto(`${BASE}/g/${C}/cagri/yeni`);
  await oP.fill('input[name="day"]', trDate(3));
  await oP.click('button:has-text("Çağrıyı aç")');
  await oP.waitForURL(/cagri\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const poll2 = oP.url().split("/cagri/")[1];
  await answer(p1P, "Geliyorum", null, poll2);
  await answer(p4P, "Geliyorum", null, poll2);
  await oP.goto(`${BASE}/g/${C}/cagri/${poll2}?kesinlestir=1`);
  await oP.fill('input[name="time"]', "22:00");
  await oP.check('input[name="kind"][value="external"]');
  await oP.selectOption('select[name="teamId"]', T);
  await oP.fill('input[name="opponent"]', "Yıldızspor");
  await oP.click('button:has-text("Kadroyu kesinleştir ve maçı kur")');
  await oP.waitForURL(new RegExp(`/g/${T}/m/`), { timeout: 30000 });
  const MX = oP.url().split("/m/")[1].split(/[?#]/)[0];
  const { data: mx } = await admin.from("matches").select("kind, opponent_name").eq("id", MX).single();
  check("maç takımda, Yıldızspor'a karşı kuruldu", mx.kind === "external" && mx.opponent_name === "Yıldızspor");
  const { data: loans } = await admin.from("group_players").select("user_id, is_loan").eq("group_id", T).in("user_id", [P1.id, P4.id]);
  check("takımda olmayan iki oyuncu ödünç yazıldı", loans.length === 2 && loans.every((l) => l.is_loan));
  await oP.screenshot({ path: `${SHOTS}/c04-rakip-mac.png`, fullPage: true });
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

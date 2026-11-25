// Maç ayarla (yeniden tasarım 4a): tek form; kesin gelen + misafir + duyuru → toplanan maç; üyeler "Geliyorum" der,
// kadro dolunca sonraki yedeğe düşer, kaptana "Kadro tamam"; kadro tam + saat + rakip → direkt kesin; üye formu açamaz.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
import { fillSetup, submitSetup } from "./wizard.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const users = []; let browser;
try {
  for (const [i, n] of ["Onur Kaptan", "Cagatay Kesin", "Berk Uye", "Atakan Uye", "Bartu Uye", "Faruk Arkadas", "Rakip Kaptan"].entries()) {
    const email = `e2e-setup-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Kırklareli", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [O, C, B, A, T, F, R] = users;
  const team = must(await admin.from("groups").insert({ name: "Setup Takimi", kind: "team", created_by: O.id, city: "Kırklareli" }).select("id").single()).id;
  for (const u of [C, B, A, T]) must(await admin.from("group_players").insert({ group_id: team, user_id: u.id, display_name: u.name, role: "member" }));

  // Faruk takım dışı arkadaş; Rakip Kaptan uygulamadaki rakip takımın kurucusu
  const [ua, ub] = [O.id, F.id].sort();
  must(await admin.from("friendships").insert({ user_a: ua, user_b: ub, requested_by: O.id, status: "accepted" }).select("id"));
  const rivalName = `Rakip Takim ${Date.now()}`;
  const rivalId = must(await admin.from("groups").insert({ name: rivalName, kind: "team", created_by: R.id, city: "Kırklareli" }).select("id").single()).id;

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, page.url(), e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const PO = await login(O);

  // --- Grup sayfasında tek "Maç ayarla" düğmesi
  await PO.goto(`${BASE}/g/${team}`, { waitUntil: "networkidle" });
  check("grup sayfasında 'Maç kur' yok, tek 'Maç ayarla' var", (await PO.locator("text=Maç kur").count()) === 0 && (await PO.locator('a:has-text("Maç ayarla")').count()) >= 1);
  await PO.goto(`${BASE}/g/${team}/matches/new`, { waitUntil: "networkidle" });
  check("eski 'Maç kur' adresi yeni forma yönlenir", PO.url().includes("/mac-ayarla?grup=" + team));

  // --- Sihirbaz: 5v5 (kadro 5), saat belli değil, kendisi + Çağatay + misafir, takıma duyur
  await PO.goto(`${BASE}/mac-ayarla?grup=${team}`, { waitUntil: "networkidle" });
  const next = PO.locator('button:text-is("İleri")');
  check("saat seçilmeden 'İleri' pasif", await next.isDisabled());
  check("alt menü gizli", (await PO.locator('nav a[href="/kesfet"]').count()) === 0);
  await PO.click('button:text-is("Belli değil")');
  await next.click();
  await PO.waitForSelector('h2:text-is("Rakip")');
  await PO.goBack();
  await PO.waitForSelector('h2:text-is("Maç bilgileri")');
  check("telefonun geri tuşu önceki adıma döner, seçim korunur", (await PO.locator('button:text-is("Belli değil")').getAttribute("aria-pressed")) === "true");
  await fillSetup(PO, { size: 5, venue: "Petroller", fee: 150, pick: [C.name], guest: { name: "Çağatayın Arkadaşı", position: "FWD" }, submit: false, shot: (n) => PO.screenshot({ path: `${SHOTS}/setup-${n}.png` }) });
  check("özet: 3/5, rakip belli değil, kişi başı ücret", (await PO.locator("text=Gelenler 3/5").count()) === 1 && (await PO.locator("text=Kişi başı 150 TL").count()) === 1);
  await submitSetup(PO);
  const matchId = PO.url().split("/m/")[1].split("?")[0];
  const m = must(await admin.from("matches").select("status, capacity, roster_count, time_tbd, open_to_members, venue, fee_per_person").eq("id", matchId).single());
  check("maç toplanıyor açıldı (3/5, saat belli değil, duyurulu)", m.status === "gathering" && m.capacity === 5 && m.roster_count === 3 && m.time_tbd && m.open_to_members && m.venue === "Petroller" && m.fee_per_person === 150);
  check("maç ekranında 'Toplanıyor' ve 3/5", (await PO.locator("text=Toplanıyor").count()) >= 1 && (await PO.locator("text=3/5").count()) >= 1);
  check("maç ekranında 'Maça çağır' arkadaş listesine gider", (await PO.locator(`a[href="/davet/gonder?tur=match&ref=${matchId}"]`).count()) === 1);
  await PO.screenshot({ path: `${SHOTS}/setup-gathering.png`, fullPage: true });
  await new Promise((r) => setTimeout(r, 2500));
  const notes = async (u, tag) => (must(await admin.from("notifications").select("tag").eq("user_id", u.id)) ?? []).some((n) => n.tag === tag);
  check("Çağatay'a 'kadroya yazdı' bildirimi", await notes(C, `match:${matchId}`));
  check("diğer üyelere 'Maç ayarlanıyor' bildirimi", await notes(B, `match:${matchId}`));

  // --- Üyeler yanıt verir: Berk, Atakan → kadro (5/5); Bartu → yedek
  const respond = async (u) => {
    const p = await login(u);
    await p.goto(`${BASE}/g/${team}/m/${matchId}`, { waitUntil: "networkidle" });
    await p.click('form button:has-text("Geliyorum")');
    await p.waitForURL(/yanit=/, { timeout: 30000 });
    return p;
  };
  const PB = await respond(B);
  check("Berk kadroya girdi", (await PB.locator("text=Kadroya girdin").count()) === 1);
  await PB.screenshot({ path: `${SHOTS}/setup-member-in.png`, fullPage: true });
  await respond(A);
  const PT = await respond(T);
  check("kadro dolunca Bartu yedeğe düştü", (await PT.locator("text=yedeğe yazıldın").count()) === 1);
  const m2 = must(await admin.from("matches").select("roster_count, reserve_count").eq("id", matchId).single());
  check("sayaç 5/5, 1 yedek", m2.roster_count === 5 && m2.reserve_count === 1);
  await new Promise((r) => setTimeout(r, 2500));
  check("kaptana 'Kadro tamam' bildirimi", await notes(O, `roster-full:${matchId}`));
  // Toplanırken çıkmak serbest
  await PB.goto(`${BASE}/g/${team}/m/${matchId}`, { waitUntil: "networkidle" });
  await PB.click('form button:has-text("Gelemem")');
  await PB.waitForURL(/yanit=declined/, { timeout: 30000 });
  check("toplanırken 'Gelemem' ile kadrodan çıkılır (4/5)", must(await admin.from("matches").select("roster_count").eq("id", matchId).single()).roster_count === 4);

  // --- Grup sayfası ve ana sayfa toplanan maçı gösterir
  await PO.goto(`${BASE}/g/${team}`, { waitUntil: "networkidle" });
  check("grup sayfasında 'Toplanıyor' rozeti ve 4/5 kadro", (await PO.locator("text=Toplanıyor").count()) >= 1 && (await PO.locator("text=4/5 kadro").count()) >= 1);
  await PO.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check("ana sayfa yaklaşan maçlarda listelenir", (await PO.locator(`a[href="/g/${team}/m/${matchId}"]`).count()) >= 1);

  // --- Direkt kesin: 5 kişi (takım dışı arkadaş dahil), saat ve rakip adı belli
  await PO.goto(`${BASE}/mac-ayarla?grup=${team}`, { waitUntil: "networkidle" });
  await fillSetup(PO, { time: "21:00", size: 5, opponent: "Yıldızspor", pick: [C.name, B.name, A.name, F.name], submit: false });
  check("kadro tam + saat + rakip → düğme 'Maçı kur'", (await PO.locator('button:text-is("Maçı kur")').count()) === 1);
  await submitSetup(PO);
  const directId = PO.url().split("/m/")[1].split("?")[0];
  const d = must(await admin.from("matches").select("status, opponent_name, roster_count").eq("id", directId).single());
  check("anlaşılmış maç direkt kesin açıldı", d.status === "planned" && d.opponent_name === "Yıldızspor" && d.roster_count === 5);
  check("takım dışı arkadaş kadroda", must(await admin.from("match_entries").select("status").eq("match_id", directId).eq("user_id", F.id))[0]?.status === "in");

  // --- Uygulamadaki rakip: aramayla seç → teklif gider
  await PO.goto(`${BASE}/mac-ayarla?grup=${team}`, { waitUntil: "networkidle" });
  await fillSetup(PO, { time: "20:00", fee: 200, appRival: rivalName, shot: (n) => PO.screenshot({ path: `${SHOTS}/setup-app-${n}.png` }) });
  const offerMatch = PO.url().split("/m/")[1].split("?")[0];
  const ch = must(await admin.from("match_challenges").select("to_group_id, status, fee_note").eq("from_match_id", offerMatch).single());
  check("uygulamadaki rakibe teklif gitti (ücret notuyla)", ch.to_group_id === rivalId && ch.status === "pending" && ch.fee_note === "Kişi başı 200 TL");

  // --- Keşfet "Meydan Oku": rakip hazır seçili gelir
  await PO.goto(`${BASE}/mac-ayarla?grup=${team}&rakip=${rivalId}`, { waitUntil: "networkidle" });
  await PO.click('button:text-is("Belli değil")');
  await PO.click('button:text-is("İleri")');
  await PO.waitForSelector('h2:text-is("Rakip")');
  check("Meydan Oku ile rakip seçili gelir", (await PO.locator(`text=${rivalName}`).count()) === 1 && (await PO.locator('button:text-is("Değiştir")').count()) === 1);

  // --- Üye formu açamaz
  await PB.goto(`${BASE}/mac-ayarla?grup=${team}`, { waitUntil: "networkidle" });
  check("yetkisi olmayan üye formdan ana sayfaya yönlenir", !PB.url().includes("/mac-ayarla"));

  // --- Grup parametresi yoksa form açılmaz (ortak sayfa yok)
  await PO.goto(`${BASE}/mac-ayarla`, { waitUntil: "networkidle" });
  check("?grup= olmadan ana sayfaya yönlenir", !PO.url().includes("/mac-ayarla"));
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message.split("\n")[0]);
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exitCode = failed ? 1 : 0;

// Takım: arayüzden kurma, davet koduyla katılma, yetkili yapma, yetkili/oyuncu/yabancı görünürlüğü, Keşfet'te listelenme.
// (Çağrı akışı calls.mjs'te.) Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Kullanım: node scripts/e2e/teams.mjs [ekran-klasörü]
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

const people = [["Ahmet Yılmaz", "MID"], ["Burak Demir", "GK"], ["Cem Kaya", "DEF"], ["Deniz Şahin", "FWD"], ["Emre Arslan", "MID"]];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, [n, pos]] of people.entries()) {
    const email = `e2e-team-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: i < 3 ? "Kadıköy" : "Beşiktaş", preferred_position: pos, onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 });
    return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const [A, B, C, D] = [await open(users[0]), await open(users[1]), await open(users[2]), await open(users[3])];

  // 1) Kaptan takımı kurar, iki oyuncu davet koduyla katılır
  await A.goto(BASE + "/takim-kur");
  await A.fill('input[name="name"]', "Kadıköy Kartalları");
  await A.locator('input[name="color"]').nth(5).check({ force: true });
  await A.fill('textarea[name="description"]', "Perşembe akşamları Moda'da oynuyoruz, maç tekliflerine açığız.");
  await A.click('button:has-text("Takımı kur")'); await A.waitForURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const teamId = A.url().split("/g/")[1]; groupIds.push(teamId);
  const { data: t } = await admin.from("groups").select("kind, invite_code").eq("id", teamId).single();
  check("takım kuruldu (kind=team)", t.kind === "team");
  for (const X of [B, C]) { await X.goto(`${BASE}/join/${t.invite_code}`); await X.waitForURL(new RegExp(`/g/${teamId}`), { timeout: 20000 }); }
  const { count } = await admin.from("group_players").select("id", { count: "exact", head: true }).eq("group_id", teamId);
  check("davet koduyla 2 oyuncu katıldı (toplam 3)", count === 3);

  // 2) Kaptan Burak'ı yetkili yapar
  await A.goto(`${BASE}/g/${teamId}/players`);
  await A.locator('li:has-text("Burak Demir") button:has-text("Yetkili yap")').click(); await A.waitForLoadState("networkidle");
  const role = (await admin.from("group_players").select("role").eq("group_id", teamId).eq("user_id", users[1].id).single()).data.role;
  check("Burak yetkili oldu", role === "admin");
  await shot(A, "20-takim-yonet");

  // 3) Görünürlük: yetkili maç kurar ama rol veremez; oyuncu maç kuramaz; yabancı takımı görür, davet linkini görmez
  await B.goto(`${BASE}/g/${teamId}`);
  check("yetkili '+ Maç kur' görür", (await B.locator("text=+ Maç kur").count()) > 0);
  await B.goto(`${BASE}/g/${teamId}/players`);
  check("yetkili 'Yetkili yap' düğmesini görmez", (await B.locator("text=Yetkili yap").count()) === 0);
  await C.goto(`${BASE}/g/${teamId}`);
  check("oyuncu '+ Maç kur' görmez", (await C.locator("text=+ Maç kur").count()) === 0);
  await C.goto(`${BASE}/g/${teamId}/matches/new`); await C.waitForLoadState("networkidle");
  check("oyuncu maç kurma sayfasından geri gönderilir", !C.url().includes("/matches/new"));
  await D.goto(`${BASE}/g/${teamId}`);
  check("yabancı takım sayfasını görür", (await D.locator("h1:has-text('Kadıköy Kartalları')").count()) > 0);
  check("yabancı davet bölümünü görmez", (await D.locator("text=Takıma oyuncu davet et").count()) === 0);
  await shot(D, "21-takim-disaridan");

  // 4) Keşfet: en az 5 oyuncusu olan takım listelenir (MIN_LISTED_MEMBERS)
  await D.goto(BASE + "/kesfet");
  check("3 oyunculu takım Keşfet'te listelenmez", (await D.locator("text=Kadıköy Kartalları").count()) === 0);
  // Misafirler sayılmaz; hesabı olan iki üye daha eklenir
  await admin.from("group_players").insert(users.slice(3).map((u) => ({ group_id: teamId, user_id: u.id, display_name: u.name, position: "MID" })));
  await D.goto(BASE + "/kesfet"); await shot(D, "22-kesfet");
  check("5 oyuncuya çıkınca Keşfet takımı listeler", (await D.locator("text=Kadıköy Kartalları").count()) > 0);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const id of groupIds) await admin.from("groups").delete().eq("id", id);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

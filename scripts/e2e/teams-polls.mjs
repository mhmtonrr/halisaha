import { createRequire } from "module";
import fs from "fs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? "/tmp/halisaha-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const people = [["Ahmet Yılmaz", "MID"], ["Burak Demir", "GK"], ["Cem Kaya", "DEF"], ["Deniz Şahin", "FWD"]];
const users = []; const groupIds = [];
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, [n, pos]] of people.entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: i < 3 ? "Kadıköy" : "Beşiktaş", preferred_position: pos, onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const browser = await chromium.launch();
  const open = async (u, scale = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const [A, B, C, D] = [await open(users[0], 2), await open(users[1]), await open(users[2]), await open(users[3], 2)];

  // Takım
  await A.page.goto(BASE + "/takim-kur");
  await A.page.fill('input[name="name"]', "Kadıköy Kartalları");
  await A.page.locator('input[name="color"]').nth(5).check({ force: true });
  await A.page.fill('textarea[name="description"]', "Perşembe akşamları Moda'da oynuyoruz, maç tekliflerine açığız.");
  await A.page.click('button:has-text("Takımı kur")'); await A.page.waitForURL(/\/g\//);
  const teamId = A.page.url().split("/g/")[1]; groupIds.push(teamId);
  const { data: t } = await admin.from("groups").select("invite_code").eq("id", teamId).single();
  for (const X of [B, C]) { await X.page.goto(`${BASE}/join/${t.invite_code}`); await X.page.waitForURL(/\/g\//); }
  log("takım kuruldu, 2 oyuncu katıldı");
  await A.page.goto(`${BASE}/g/${teamId}/players`);
  await A.page.locator('li:has-text("Burak Demir") button:has-text("Yetkili yap")').click(); await A.page.waitForLoadState("networkidle");
  log("Burak yetkili:", (await admin.from("group_players").select("role").eq("group_id", teamId).eq("user_id", users[1].id).single()).data.role);
  await shot(A.page, "20-takim-yonet");
  await B.page.goto(`${BASE}/g/${teamId}`);
  log("yetkili 'Doğrudan maç' görüyor:", (await B.page.locator("text=Doğrudan maç").count()) > 0 ? "✓" : "HATA");
  await B.page.goto(`${BASE}/g/${teamId}/players`);
  log("yetkili rol butonu görmüyor:", (await B.page.locator("text=Yetkili yap").count()) === 0 ? "✓" : "HATA");
  await C.page.goto(`${BASE}/g/${teamId}`);
  log("oyuncu maç kuramıyor:", (await C.page.locator("text=Doğrudan maç").count()) === 0 ? "✓" : "HATA");
  await C.page.goto(`${BASE}/g/${teamId}/matches/new`); await C.page.waitForURL(new RegExp(`/g/${teamId}\\?error`));
  log("oyuncu maç sayfasına doğrudan girse de geri yönlendi ✓");
  await D.page.goto(`${BASE}/g/${teamId}`);
  log("yabancı takımı görüyor:", (await D.page.locator("h1:has-text('Kadıköy Kartalları')").count()) ? "✓" : "HATA",
      "| davet linki gizli:", (await D.page.locator("text=davet et").count()) === 0 ? "✓" : "HATA");
  await shot(D.page, "21-takim-disaridan");
  await D.page.goto(BASE + "/kesfet"); await shot(D.page, "22-kesfet");
  log("keşfet İstanbul'da takımı listeliyor:", (await D.page.locator("text=Kadıköy Kartalları").count()) ? "✓" : "HATA");

  // Grup + maç çağrısı
  await A.page.goto(BASE + "/grup-kur"); await A.page.fill('input[name="name"]', "Cuma Halısaha Ekibi");
  await A.page.click('button:has-text("Grubu kur")'); await A.page.waitForURL(/\/g\//);
  const gid = A.page.url().split("/g/")[1]; groupIds.push(gid);
  const { data: g } = await admin.from("groups").select("invite_code").eq("id", gid).single();
  for (const X of [B, C, D]) { await X.page.goto(`${BASE}/join/${g.invite_code}`); await X.page.waitForURL(/\/g\//); }
  await D.page.goto(`${BASE}/g/${gid}`);
  log("grup üyesi maç/çağrı açamıyor:", (await D.page.locator("text=Maç çağrısı").count()) === 0 ? "✓" : "HATA");
  await A.page.goto(`${BASE}/g/${gid}`); await A.page.click("text=Maç çağrısı"); await A.page.waitForURL(/cagri\/yeni/);
  await A.page.fill('input[name="venue"]', "Petroller Halısaha"); await A.page.fill('input[name="capacity"]', "3");
  await A.page.fill('textarea[name="note"]', "Kişi başı 150 TL. Kaleci lazım!");
  await A.page.click('button:has-text("Çağrıyı aç")'); await A.page.waitForURL(/cagri\/[0-9a-f-]+$/);
  const pollUrl = A.page.url();
  await D.page.goto(BASE + "/"); log("ana sayfada 'Maça geliyor musun?' kartı:", (await D.page.locator("text=Maça geliyor musun?").count()) ? "✓" : "HATA");
  await shot(D.page, "23-anasayfa-cagri");
  for (const [X, ans] of [[C, "Geliyorum"], [D, "Geliyorum"], [B, "Belki"], [A, "Geliyorum"]]) {
    await X.page.goto(pollUrl); await X.page.click(`form button:has-text("${ans}")`); await X.page.waitForLoadState("networkidle");
  }
  await B.page.goto(pollUrl); await B.page.click('form button:has-text("Geliyorum")'); await B.page.waitForLoadState("networkidle");
  log("Burak belki → geliyorum (sıranın sonuna geçti, 4. kişi = yedek)");
  await A.page.goto(pollUrl); await A.page.click('button:has-text("kişiyi onayla")'); await A.page.waitForLoadState("networkidle");
  await shot(A.page, "24-cagri-yetkili");
  const { data: resp } = await admin.from("poll_responses").select("approved, answer, group_players(display_name)").eq("poll_id", pollUrl.split("/").pop());
  log("onaylananlar:", resp.filter((r) => r.approved).map((r) => r.group_players.display_name).sort().join(", "), "| yedek:", resp.filter((r) => r.answer === "yes" && !r.approved).map((r) => r.group_players.display_name).join(", "));
  await A.page.click("text=Maçı oluştur"); await A.page.waitForURL(/matches\/new\?cagri=/);
  await shot(A.page, "25-cagridan-mac");
  log("maç formunda seçili gelen:", await A.page.locator('input[name="players"]').count(), "oyuncu, saha:", await A.page.inputValue('input[name="venue"]'));
  log("3 kişiyle buton:", await A.page.locator('form > button').last().textContent());
  await A.page.locator('li button:has-text("Burak Demir")').click();
  log("yedekteki Burak eklendi →", await A.page.locator('input[name="players"]').count(), "oyuncu");
  await A.page.click('button:has-text("Maçı oluştur")'); await A.page.waitForURL(/\/m\//);
  const { data: poll } = await admin.from("match_polls").select("status, match_id").eq("id", pollUrl.split("/").pop()).single();
  log("çağrı durumu:", poll.status, "| maça bağlı:", A.page.url().includes(poll.match_id) ? "✓" : "HATA");
  await A.page.goto(BASE + "/"); await shot(A.page, "26-anasayfa");
  await browser.close();
} finally {
  for (const id of groupIds) await admin.from("groups").delete().eq("id", id);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  const { data: left } = await admin.from("profiles").select("id").in("id", users.map((u) => u.id));
  log(`temizlendi (kalan test profili: ${left?.length ?? 0})`);
}

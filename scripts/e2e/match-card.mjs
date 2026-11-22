// Maça davet kartı: ilan/çağrı sayfasından arkadaşa ve yabancıya gönder, alıcı sohbette kartı görür, yetkisiz kişi seçiciye giremez.
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
const users = []; const groups = []; let browser;
const log = (...a) => console.log("•", ...a);
try {
  for (const [i, n] of ["Kart Kaptan", "Kart Arkadas", "Kart Yabanci"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  const [K, F, O] = users;
  const mk = async (name, kind) => { const { data } = await admin.from("groups").insert({ name, kind, created_by: K.id, city: "İstanbul" }).select("id").single(); groups.push(data.id); return data.id; };
  const T = await mk("Kart Takimi", "team"), C = await mk("Kart Grubu", "community");
  await admin.from("group_players").insert({ group_id: C, user_id: F.id, display_name: "Kart Arkadas", role: "member" });
  const { data: m } = await admin.from("matches").insert({ group_id: T, played_at: new Date(Date.now() + 3 * 864e5).toISOString(), venue: "Meydan Saha", created_by: K.id, kind: "external", opponent_name: "Rakip FK" }).select("id").single();
  const { data: l } = await admin.from("player_listings").insert({ group_id: T, match_id: m.id, created_by: K.id, needed: 2, positions: ["GK"] }).select("id").single();
  const { data: p } = await admin.from("match_polls").insert({ group_id: C, created_by: K.id, starts_at: new Date(Date.now() + 4 * 864e5).toISOString(), venue: "Poll Saha", capacity: 10 }).select("id").single();
  const [a, b] = K.id < F.id ? [K.id, F.id] : [F.id, K.id];
  await admin.from("friendships").insert({ user_a: a, user_b: b, status: "accepted", requested_by: K.id });

  browser = await chromium.launch();
  const login = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/"); return page;
  };
  const [PK, PF, PO] = [await login(K), await login(F), await login(O)];

  // İlan sayfasından arkadaşa + aramayla yabancıya
  await PK.goto(`${BASE}/ilan/${l.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  await PK.waitForURL(/\/davet\/gonder/);
  await PK.waitForSelector("text=Arkadaşlarım (1)");
  await PK.screenshot({ path: `${SHOTS}/card-picker.png` });
  await PK.click('form button:has-text("Gönder")');
  await PK.waitForSelector("text=Gönderildi");
  log("ilan kartı arkadaşa gönderildi ✓");
  await PK.fill('input[aria-label="Oyuncu ara"]', "Yabanci"); await PK.click('button:has-text("Ara")');
  await PK.waitForSelector("text=Arama sonucu");
  await PK.click('form button:has-text("Gönder")');
  await PK.waitForSelector("text=Gönderildi");
  log("aramayla bulunan yabancıya gönderildi ✓");
  await PK.click('form button:has-text("Gönder")').catch(() => {});

  // Çağrı kartı
  await PK.goto(`${BASE}/g/${C}/cagri/${p.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  await PK.waitForSelector("text=Arkadaşlarım (1)");
  await PK.click('form button:has-text("Gönder")');
  await PK.waitForSelector("text=Gönderildi");
  log("çağrı kartı gönderildi ✓");
  // Maç kartı
  await PK.goto(`${BASE}/g/${T}/m/${m.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  await PK.waitForSelector("text=Arkadaşlarım (1)");
  await PK.click('form button:has-text("Gönder")');
  await PK.waitForSelector("text=Gönderildi");
  log("maç kartı gönderildi ✓");

  // Arkadaş: açık sohbet, 3 kart, isteksiz
  await PF.goto(`${BASE}/sohbet`); await PF.waitForSelector("text=Kart Kaptan");
  log("arkadaşta 'Mesaj istekleri' yok:", (await PF.locator("text=Mesaj istekleri").count()) === 0 ? "✓" : "HATA");
  await PF.click("text=Kart Kaptan"); await PF.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  await PF.waitForSelector("text=Oyuncu ilanı");
  log("arkadaş 3 kartı gördü:", (await PF.locator("text=Maç çağrısı").count()) >= 1 && (await PF.locator("text=Maç daveti").count()) >= 1 ? "✓" : "HATA");
  await PF.screenshot({ path: `${SHOTS}/card-thread.png` });
  log("üye olunan grubun çağrısında 'Çağrıya yanıt ver':", (await PF.locator("text=Çağrıya yanıt ver").count()) === 1 ? "✓" : "HATA");
  log("üye olunmayan takım maçında 'Takıma bak':", (await PF.locator("text=Takıma bak").count()) === 1 ? "✓" : "HATA");
  await PF.click("text=İlanı aç ve başvur");
  await PF.waitForURL(new RegExp(`/ilan/${l.id}`));
  log("ilan kartı başvuru sayfasını açtı ✓");

  // Yabancı: istek olarak düştü
  await PO.goto(`${BASE}/sohbet`); await PO.waitForSelector("text=Mesaj istekleri");
  log("yabancıya kart istek olarak düştü ✓");

  // Yetkisiz seçiciye giremez
  await PF.goto(`${BASE}/davet/gonder?tur=listing&ref=${l.id}`); await PF.waitForTimeout(800);
  log("yetkisiz kişi seçiciden ana sayfaya atılır:", new URL(PF.url()).pathname === "/" ? "✓" : "HATA " + PF.url());

  const { data: notifs } = await admin.from("notifications").select("title").eq("user_id", F.id).eq("type", "invite");
  log("bildirimler:", JSON.stringify(notifs.map((n) => n.title)));
} finally {
  await browser?.close();
  for (const g of groups) await admin.from("groups").delete().eq("id", g);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  log("test verileri silindi");
}

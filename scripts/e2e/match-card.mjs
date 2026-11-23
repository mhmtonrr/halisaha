// Sohbetten maç/çağrı kartı: adam arama (takım maçı), toplama çağrısı (topluluk) ve maç kartını arkadaşa / aramayla yabancıya gönder;
// alıcı sohbette kartları ve üyeliğe göre doğru düğmeyi görür, yabancıya istek olarak düşer, yetkisiz kişi seçiciye giremez.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler. Kullanım: node scripts/e2e/match-card.mjs [ekran-klasörü]
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
const trDate = (offsetDays) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const users = []; const groups = []; let browser;
try {
  for (const [i, n] of ["Kart Kaptan", "Kart Arkadas", "Kart Yabanci"].entries()) {
    const email = `e2e-card-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, F, O] = users;
  const mk = async (name, kind) => { const g = must(await admin.from("groups").insert({ name, kind, created_by: K.id, city: "İstanbul" }).select("id").single()); groups.push(g.id); return g.id; };
  const T = await mk("Kart Takimi", "team"), C = await mk("Kart Grubu", "community");
  must(await admin.from("group_players").insert({ group_id: C, user_id: F.id, display_name: F.name, role: "member" }));
  const playedAt = new Date(Date.now() + 3 * 864e5);
  const m = must(await admin.from("matches").insert({ group_id: T, played_at: playedAt.toISOString(), venue: "Meydan Saha", created_by: K.id, kind: "external", opponent_name: "Rakip FK" }).select("id").single());
  // Adam ara (takım maçının eksiği) ve toplama çağrısı (toplulukta, sadece gün)
  const fill = must(await admin.from("match_polls").insert({ group_id: T, match_id: m.id, created_by: K.id, purpose: "fill", play_on: trDate(3), starts_at: playedAt.toISOString(), venue: "Meydan Saha", capacity: 2, positions: ["GK"] }).select("id").single());
  const gather = must(await admin.from("match_polls").insert({ group_id: C, created_by: K.id, purpose: "gather", play_on: trDate(4), venue: "Poll Saha", capacity: 10 }).select("id").single());
  const [a, b] = K.id < F.id ? [K.id, F.id] : [F.id, K.id];
  must(await admin.from("friendships").insert({ user_a: a, user_b: b, status: "accepted", requested_by: K.id }));

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const [PK, PF, PO] = [await login(K), await login(F), await login(O)];
  const sendToFriend = async () => {
    await PK.waitForSelector("text=Arkadaşlarım (1)");
    await PK.click('form button:has-text("Gönder")');
    return PK.waitForSelector("text=Gönderildi", { timeout: 15000 }).then(() => true, () => false);
  };

  // 1) Adam arama sayfasından arkadaşa + aramayla yabancıya
  await PK.goto(`${BASE}/g/${T}/cagri/${fill.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  await PK.waitForURL(/\/davet\/gonder/);
  await PK.screenshot({ path: `${SHOTS}/card-picker.png` });
  check("adam arama kartı arkadaşa gönderildi", await sendToFriend());
  await PK.fill('input[aria-label="Oyuncu ara"]', "Yabanci"); await PK.click('button:has-text("Ara")');
  await PK.waitForSelector("text=Arama sonucu");
  await PK.locator('form button:has-text("Gönder")').first().click();
  check("aramayla bulunan yabancıya gönderildi", await PK.waitForSelector("text=Gönderildi", { timeout: 15000 }).then(() => true, () => false));

  // 2) Toplama çağrısı ve maç kartı
  await PK.goto(`${BASE}/g/${C}/cagri/${gather.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  check("toplama çağrısı kartı gönderildi", await sendToFriend());
  await PK.goto(`${BASE}/g/${T}/m/${m.id}`);
  await PK.click('a:has-text("Sohbetten davet et")');
  check("maç kartı gönderildi", await sendToFriend());

  // 3) Arkadaş: açık sohbet (istek değil), 3 kart, üyeliğe göre düğme
  await PF.goto(`${BASE}/sohbet`); await PF.waitForSelector("text=Kart Kaptan");
  check("arkadaşta 'Mesaj istekleri' yok", (await PF.locator("text=Mesaj istekleri").count()) === 0);
  await PF.click("text=Kart Kaptan"); await PF.waitForURL(/\/sohbet\/[0-9a-f-]{36}/);
  await PF.waitForSelector("text=Adam aranıyor");
  check("arkadaş 3 kartı görür (adam aranıyor, maç çağrısı, maç daveti)",
    (await PF.locator("text=Maç çağrısı").count()) >= 1 && (await PF.locator("text=Maç daveti").count()) >= 1);
  check("adam arama kartında aranan sayı yazar", (await PF.locator("text=2 oyuncu aranıyor").count()) >= 1);
  await PF.screenshot({ path: `${SHOTS}/card-thread.png`, fullPage: true });
  check("üye olunan grubun çağrısında 'Çağrıya yanıt ver'", (await PF.locator("a", { hasText: "Çağrıya yanıt ver" }).count()) === 1);
  check("üye olunmayan takımın iki kartında 'Takıma bak'", (await PF.locator("a", { hasText: "Takıma bak" }).count()) === 2);
  await PF.locator("a", { hasText: "Çağrıya yanıt ver" }).click();
  await PF.waitForURL(new RegExp(`/cagri/${gather.id}`));
  check("çağrı kartı çağrı sayfasını açar", PF.url().includes(gather.id));

  // 4) Yabancı: istek olarak düştü
  await PO.goto(`${BASE}/sohbet`);
  check("yabancıya kart istek olarak düştü", await PO.waitForSelector("text=Mesaj istekleri", { timeout: 15000 }).then(() => true, () => false));

  // 5) Yetkisiz kişi seçiciye giremez
  await PF.goto(`${BASE}/davet/gonder?tur=poll&ref=${gather.id}`); await PF.waitForLoadState("networkidle");
  check("çağrıyı görebilen ama yönetemeyen üye seçiciden ana sayfaya atılır", new URL(PF.url()).pathname === "/");
  const notifs = must(await admin.from("notifications").select("title").eq("user_id", F.id).eq("type", "invite"));
  check("arkadaşa davet bildirimi yazıldı", notifs.length >= 1);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groups) await admin.from("groups").delete().eq("id", g);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

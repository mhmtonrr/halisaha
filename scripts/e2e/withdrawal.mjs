// Maçtan çekilme: oyuncu istek gönderir → kaptan görür (son dakika etiketi) → reddeder/onaylar → bildirimler;
// geri çekme; kaptanın doğrudan çıkışı; onaylı çekilme "gelmedi" sayılmaz. Canlı Supabase'e karşı çalışır; test verisini siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));

const names = ["Kaan Kaptan", "Mert Çekilen", "Cem Kalan"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-wd-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b, c] = users;
  const G = (await admin.from("groups").insert({ name: "E2E Çekilme Grubu", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G);
  for (const u of [b, c]) await admin.from("group_players").insert({ group_id: G, user_id: u.id, display_name: u.name, position: "MID" });
  const gp = async (u) => (await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", u.id).single()).data.id;
  const [aG, bG, cG] = [await gp(a), await gp(b), await gp(c)];
  const mk = async (hours) => (await admin.from("matches").insert({ group_id: G, played_at: new Date(Date.now() + hours * 3600e3).toISOString(), created_by: a.id, kind: "internal", status: "planned", team_size: 5 }).select("id").single()).data.id;
  const row = (m, p, team) => ({ match_id: m, player_id: p, team, goals: 0, assists: 0, saves: 0, position: null, is_goalkeeper: false });
  const m1 = await mk(72), m2 = await mk(2);
  await admin.from("match_players").insert([row(m1, aG, "A"), row(m1, bG, "B"), row(m1, cG, "B"), row(m2, aG, "A"), row(m2, bG, "B")]);
  const inRoster = async (m, p) => ((await admin.from("match_players").select("*", { count: "exact", head: true }).eq("match_id", m).eq("player_id", p)).count ?? 0) === 1;
  const waitNotif = async (uid, like) => { for (let i = 0; i < 12; i++) { const { data } = await admin.from("notifications").select("title, body, url").eq("user_id", uid).like("title", like); if (data?.length) return data[0]; await sleep(1000); } return null; };

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [aP, bP, cP] = [await open(a), await open(b), await open(c)];
  const url = (m) => `${BASE}/g/${G}/m/${m}`;
  const body = (p) => p.locator("body").innerText();

  // 1) Mert çekilme isteği gönderir
  await bP.goto(url(m1));
  check("kadrodaki oyuncu 'Maça gelemeyeceğim' bölümünü görür", has(await body(bP), "Maça gelemeyeceğim"));
  await cP.goto(url(m1));
  await bP.locator("summary:has-text('Maça gelemeyeceğim')").click();
  await bP.fill('textarea[name="reason"]', "Dizim ağrıyor");
  await bP.screenshot({ path: `${SHOTS}/107-cekilme-formu.png`, fullPage: true });
  await bP.click('button:has-text("Çekilme isteği gönder")');
  await bP.waitForURL(/cekilme=pending/, { timeout: 15000 });
  await bP.locator("text=onay").first().waitFor({ timeout: 10000 });
  check("istek gönderildi mesajı ve bekleme kartı", has(await body(bP), "kaptana ve yetkililere gönderildi") && has(await body(bP), "kaptan onayını bekliyor"));
  const { data: w1 } = await admin.from("match_withdrawals").select("status, late, reason").eq("match_id", m1).eq("player_id", bG).single();
  check("istek 'pending', son dakika değil, sebep kayıtlı", w1.status === "pending" && w1.late === false && w1.reason === "Dizim ağrıyor");
  check("onaylanana kadar kadroda", await inRoster(m1, bG));
  const n1 = await waitNotif(a.id, "%çekilme isteği%");
  check("kaptana bildirim gitti (isim ve sebep)", !!n1 && n1.body.includes("Mert Çekilen") && n1.body.includes("Dizim ağrıyor") && n1.url === `/g/${G}/m/${m1}`);

  // 2) Diğer üye (Cem) isteği görmez; kaptan görür
  check("başka üye çekilme isteklerini görmez", !has(await body(cP), "Çekilme istekleri") && has(await body(cP), "Maça gelemeyeceğim"));
  await aP.goto(url(m1));
  let t = await body(aP);
  check("kaptan 'Çekilme istekleri · 1' ve sebebi görür", has(t, "Çekilme istekleri · 1") && has(t, "Dizim ağrıyor") && has(t, "Mert Çekilen"));
  await aP.screenshot({ path: `${SHOTS}/108-cekilme-kaptan.png`, fullPage: true });

  // 3) Kaptan reddeder
  await aP.click('button:has-text("Reddet")');
  await aP.waitForURL(/cekilme=denied-by-admin/, { timeout: 15000 });
  await aP.locator("text=reddedildi").first().waitFor({ timeout: 10000 });
  const { data: w2 } = await admin.from("match_withdrawals").select("status, decided_by").eq("id", (await admin.from("match_withdrawals").select("id").eq("match_id", m1).eq("player_id", bG).single()).data.id).single();
  check("reddedildi, karar veren kaptan", w2.status === "denied" && w2.decided_by === a.id && (await inRoster(m1, bG)));
  const n2 = await waitNotif(b.id, "%reddedildi%");
  check("oyuncuya 'reddedildi' bildirimi gitti", !!n2 && n2.body.includes("kadroda kalıyorsun"));
  await bP.goto(url(m1));
  check("reddedilen oyuncu notu görür, tekrar istek gönderebilir", has(await body(bP), "reddedildi, kadroda kalıyorsun") && (await bP.locator("summary:has-text('Maça gelemeyeceğim')").count()) === 1);

  // 4) Tekrar istek → geri çek
  await bP.locator("summary:has-text('Maça gelemeyeceğim')").click();
  await bP.click('button:has-text("Çekilme isteği gönder")');
  await bP.waitForURL(/cekilme=pending/, { timeout: 15000 });
  await bP.locator("button:has-text('İsteği geri çek')").click();
  await bP.waitForURL(/cekilme=cancelled/, { timeout: 15000 });
  const { data: cancelled } = await admin.from("match_withdrawals").select("status").eq("match_id", m1).eq("player_id", bG).eq("status", "cancelled");
  check("istek geri çekilebilir", cancelled?.length === 1);

  // 5) Yeniden istek → kaptan onaylar → kadrodan çıkar, gelmedi sayılmaz
  await bP.goto(url(m1));
  await bP.locator("summary:has-text('Maça gelemeyeceğim')").click();
  await bP.click('button:has-text("Çekilme isteği gönder")');
  await bP.waitForURL(/cekilme=pending/, { timeout: 15000 });
  await aP.goto(url(m1));
  await aP.click('button:has-text("Onayla, kadrodan çıkar")');
  await aP.waitForURL(/cekilme=approved-by-admin/, { timeout: 15000 });
  await sleep(800);
  check("onaylanınca oyuncu kadrodan çıktı", !(await inRoster(m1, bG)));
  const { count: noShows } = await admin.from("match_no_shows").select("*", { count: "exact", head: true }).eq("user_id", b.id);
  check("onaylı çekilme 'gelmedi' sayılmadı", (noShows ?? 0) === 0);
  const n3 = await waitNotif(b.id, "%onaylandı%");
  check("oyuncuya 'onaylandı' bildirimi gitti", !!n3);
  await bP.goto(url(m1));
  t = await body(bP);
  check("kadrodan çıkan oyuncu artık çekilme bölümü görmez", !has(t, "Maça gelemeyeceğim"));

  // 6) Son dakika (2 saat kala)
  await bP.goto(url(m2));
  check("2 saat kala formda 'son dakika' uyarısı", (await bP.locator("summary:has-text('Maça gelemeyeceğim')").click(), has(await body(bP), "3 saatten az kaldı")));
  await bP.click('button:has-text("Çekilme isteği gönder")');
  await bP.waitForURL(/cekilme=pending/, { timeout: 15000 });
  await aP.goto(url(m2));
  check("kaptan 'Son dakika' etiketini görür", has(await body(aP), "Son dakika"));
  await aP.screenshot({ path: `${SHOTS}/109-cekilme-son-dakika.png`, fullPage: true });

  // 7) Kaptan kendi adına doğrudan çıkar
  await aP.locator("summary:has-text('Maça gelemeyeceğim')").click();
  await aP.click('button:text-is("Kadrodan çık")');
  await aP.waitForURL(/cekilme=approved(?!-)/, { timeout: 15000 });
  check("kaptan kendini doğrudan kadrodan çıkarır (onay beklemez)", !(await inRoster(m2, aG)));
  const { data: w7 } = await admin.from("match_withdrawals").select("status").eq("match_id", m2).eq("player_id", aG).single();
  check("kaptanın kaydı 'approved'", w7.status === "approved");
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

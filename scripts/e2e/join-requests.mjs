// Katılma isteği + bekleyen istekler sayfası (Parça 6a): Grubu yönet'te Keşfet/istek ayarı, istek → ana sayfa yapılacaklar,
// grup sayfasında "Bekleyen istekler", /istekler'de kabul (üye olur) ve ret, isteyene bildirim.
// Çalıştırma: npm run dev açıkken `node scripts/e2e/join-requests.mjs [ekran-klasörü]`
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const SHOTS = process.argv[2] ?? path.join(os.tmpdir(), "halisaha-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (label, ok) => { console.log(ok ? "✓" : "✗ HATA", label); if (!ok) fails++; };

const users = []; const groupIds = [];
try {
  for (const [i, n] of ["Kaya Kurucu", "İsa İstekli", "Rıza Reddedilen"].entries()) {
    const email = `e2e-test-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    users.push({ id: data.user.id, email, password, name: n });
    await admin.from("profiles").update({ display_name: n, city: "İstanbul", district: "Kadıköy", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
  }
  const [K, I, R] = users;
  const G = (await admin.from("groups").insert({ name: "E2E İstek Topluluğu", kind: "community", created_by: K.id, city: "İstanbul", district: "Kadıköy" }).select("id").single()).data.id;
  groupIds.push(G);

  const browser = await chromium.launch();
  const login = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    return page;
  };
  const body = (p) => p.locator("main").innerText();
  // Kullanıcı adına RPC (6b'de Keşfet düğmesiyle yapılacak)
  const asUser = async (u) => {
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: u.email, password: u.password });
    return c;
  };

  // 1) Varsayılan: topluluk Keşfet'te görünmez → istek alınmaz
  const ci = await asUser(I);
  let r = await ci.rpc("request_join", { p_group: G });
  check("Keşfet'te görünmeyen topluluk istek almaz", !!r.error);

  // 2) Kurucu Grubu yönet'te "Keşfet'te görünsün"ü açar (istek varsayılan açık)
  const KP = await login(K);
  await KP.goto(`${BASE}/g/${G}/players`);
  check("ayar kutuları görünür", (await KP.locator("text=Keşfet'te görünsün").count()) === 1 && (await KP.locator('input[name="requestsOpen"]').isChecked()));
  await KP.locator('input[name="discoverable"]').check();
  await KP.screenshot({ path: `${SHOTS}/join-01-ayar.png`, fullPage: true });
  await KP.click('form:has(input[name="name"]) button:has-text("Kaydet")'); await KP.waitForURL(/saved=1/);
  const { data: g1 } = await admin.from("groups").select("discoverable, join_requests_open").eq("id", G).single();
  check("ayar kaydedildi (görünür, istek açık)", g1.discoverable === true && g1.join_requests_open === true);

  // 3) İki istek
  r = await ci.rpc("request_join", { p_group: G, p_message: "Salı akşamları boşum" });
  check("istek gönderildi", !r.error);
  const cr = await asUser(R);
  r = await cr.rpc("request_join", { p_group: G });
  check("ikinci istek gönderildi", !r.error);

  // 4) Ana sayfa yapılacaklar + grup sayfası
  await KP.goto(BASE + "/"); await KP.waitForLoadState("networkidle");
  check("ana sayfada '2 katılma isteği'", (await body(KP)).includes("2 katılma isteği"));
  await KP.screenshot({ path: `${SHOTS}/join-02-ana-sayfa.png`, fullPage: true });
  await KP.goto(`${BASE}/g/${G}`);
  check("grup sayfasında 'Bekleyen istekler'", (await body(KP)).includes("Bekleyen istekler"));

  // 5) İstekler sayfası: kabul ve ret
  await KP.goto(`${BASE}/g/${G}/istekler`);
  const t = await body(KP);
  check("istekler sayfası iki kişiyi ve mesajı gösterir", t.includes("İsa İstekli") && t.includes("Rıza Reddedilen") && t.includes("Salı akşamları boşum"));
  await KP.screenshot({ path: `${SHOTS}/join-03-istekler.png`, fullPage: true });
  await KP.locator('form:has(input[name="accept"][value="1"])').first().locator("button").click();
  for (let i = 0; i < 40 && !(await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", I.id).maybeSingle()).data; i++) await sleep(500);
  check("kabul edilen üye oldu", !!(await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", I.id).maybeSingle()).data);
  await KP.waitForLoadState("networkidle");
  await KP.locator('form:has(input[name="accept"][value="0"])').first().locator("button").click();
  for (let i = 0; i < 40 && (await admin.from("group_join_requests").select("status").eq("group_id", G).eq("user_id", R.id).single()).data.status === "pending"; i++) await sleep(500);
  check("ret kaydedildi", (await admin.from("group_join_requests").select("status").eq("group_id", G).eq("user_id", R.id).single()).data.status === "declined");
  await KP.waitForLoadState("networkidle"); await KP.waitForSelector("text=Bekleyen istek yok", { timeout: 10000 }).catch(() => null);
  check("istekler bitince 'Bekleyen istek yok'", (await body(KP)).includes("Bekleyen istek yok"));

  // 6) Bildirimler
  let nI = null, nR = null;
  for (let i = 0; i < 15 && !(nI && nR); i++) {
    nI = (await admin.from("notifications").select("title").eq("user_id", I.id).like("title", "%kabul edildi%")).data?.[0];
    nR = (await admin.from("notifications").select("title").eq("user_id", R.id).like("title", "%reddedildi%")).data?.[0];
    if (!(nI && nR)) await sleep(1000);
  }
  check("kabul bildirimi isteyene gitti", !!nI);
  check("ret bildirimi isteyene gitti", !!nR);
  r = await cr.rpc("request_join", { p_group: G });
  check("reddedilen bir hafta tekrar isteyemez", !!r.error);

  // 7) Üye istekler sayfasına giremez
  const IP = await login(I);
  await IP.goto(`${BASE}/g/${G}/istekler`); await IP.waitForURL(new RegExp(`/g/${G}$`), { timeout: 15000 }).catch(() => null);
  check("sıradan üye istekler sayfasından grup sayfasına döner", new URL(IP.url()).pathname === `/g/${G}`);
  await browser.close();
} finally {
  for (const id of groupIds) await admin.from("groups").delete().eq("id", id);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(fails ? `${fails} HATA` : "hepsi geçti");
}

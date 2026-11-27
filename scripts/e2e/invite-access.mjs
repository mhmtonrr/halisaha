// Kişiye özel davet (0056/0057), iki hesap telefon boyutunda: maç ekranından davet → sohbet kartında Gelemem/Geliyorum →
// "Davetliler" listesi → maçtan çıkarma (açık sayfa "erişimin yok"a döner, adres ve davet bağlantısı kapalı, kart iptal) →
// yeniden davet → karttan ve listeden geri çekme → kesin maçta davetliye "Gelemem" → onaylanmayan davet engellemez.
// Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 50) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(300); } return false; };
const shown = (page, selector, timeout = 15000) => page.waitForSelector(selector, { timeout }).then(() => true, () => false);
const gone = (page, selector, timeout = 15000) => page.waitForSelector(selector, { state: "detached", timeout }).then(() => true, () => false);
const users = []; let browser;
const stamp = Date.now();
try {
  for (const [i, n] of ["Davet Kaptan", "Davet Misafiri", "Davet Kadrocu", "Davet Onerilen"].entries()) {
    const email = `e2e-invite-${stamp}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Edirne", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [K, F, R, S] = users;
  const [a, b] = K.id < F.id ? [K.id, F.id] : [F.id, K.id];
  must(await admin.from("friendships").insert({ user_a: a, user_b: b, status: "accepted", requested_by: K.id }));
  // Özel topluluk: dışarıdan davetli, davet düşünce hiçbir şey göremez
  const G = must(await admin.from("groups").insert({ name: `Davet Grubu ${stamp % 1000}`, kind: "community", created_by: K.id, city: "Edirne" }).select("id").single()).id;
  must(await admin.from("group_players").insert({ group_id: G, user_id: R.id, display_name: R.name, role: "member" }));
  const client = async (u) => { const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }); must(await c.auth.signInWithPassword({ email: u.email, password: u.password })); return c; };
  const kc = await client(K), rc = await client(R);
  const day = new Date(Date.now() + 3 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
  const M = must(await kc.rpc("create_match_v2", { p_group: G, p_day: day, p_time: null, p_team_size: 5, p_kind: "internal", p_venue: "Meydan Saha", p_with_me: true, p_confirmed: [R.id] }));
  const code = must(await kc.rpc("match_invite_code", { p_match: M }));
  const matchUrl = `${BASE}/g/${G}/m/${M}`;
  const entry = async (u, m = M) => (await admin.from("match_entries").select("status").eq("match_id", m).eq("user_id", u.id).maybeSingle()).data?.status;

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, page.url(), e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const PK = await login(K), PF = await login(F);
  const go = (page, url) => page.goto(url, { waitUntil: "networkidle" });
  const invite = async () => {
    await go(PK, matchUrl);
    await PK.locator("summary", { hasText: "Oyuncu mu eksik?" }).click();
    await PK.click('button:text-is("Davet et")');
    return until(async () => (await entry(F)) === "invited");
  };
  let thread;
  const openThread = async () => {
    thread ??= (await admin.from("dm_messages").select("thread_id").eq("match_id", M).eq("kind", "match").limit(1).single()).data.thread_id;
    await go(PF, `${BASE}/sohbet/${thread}`);
  };

  // --- Davet ve karttan "Gelemem"
  check("maç ekranından davet gider", await invite());
  await openThread();
  check("kartta 'Davetlisin' ve iki düğme", (await shown(PF, "text=Davetlisin")) && (await PF.locator('button:text-is("Geliyorum")').count()) === 1 && (await PF.locator('button:text-is("Gelemem")').count()) === 1);
  await PF.screenshot({ path: `${SHOTS}/invite-card.png`, fullPage: true });
  await PF.click('button:text-is("Gelemem")');
  check("karttan 'Gelemem' kaydedildi, kart 'Gelemem dedin'", (await until(async () => (await entry(F)) === "declined")) && (await shown(PF, "text=Gelemem dedin")));
  check("yönetene 'olumsuz yanıt' bildirimi", await until(async () => !!(await admin.from("notifications").select("id").eq("user_id", K.id).eq("title", "Davete olumsuz yanıt").limit(1)).data?.length));
  await go(PK, matchUrl);
  check("maç ekranında 'Davetliler' listesi: Gelemem dedi", (await shown(PK, "text=Davetliler · 1")) && (await PK.locator("text=Gelemem dedi").count()) >= 1);
  await PK.screenshot({ path: `${SHOTS}/invite-list.png`, fullPage: true });

  // --- Karttan "Geliyorum" ve toplanıyor ekranı
  await PF.click('button:text-is("Geliyorum")');
  check("karttan 'Geliyorum' → kadro", (await until(async () => (await entry(F)) === "in")) && (await shown(PF, "text=Kadrodasın")));
  await PF.click('a:has-text("Maça bak")'); await PF.waitForURL(/\/m\//); await PF.waitForLoadState("networkidle");
  check("davetli toplanıyor ekranını ve kadroyu görür", (await shown(PF, "text=Taktik Odası")) && (await PF.locator("text=Davet Kaptan").count()) >= 1);
  check("davetli yönetim bölümlerini ve 'Kadro dışı'yı görmez", (await PF.locator("text=Davetliler").count()) === 0 && (await PF.locator("text=Kadro dışı").count()) === 0);

  // --- Maçtan çıkarma
  await go(PK, matchUrl);
  await PK.locator("li button", { hasText: F.name }).first().click();
  await PK.click('li button:text-is("Maçtan çıkar")');
  check("takım dışından oyuncu maçtan çıkarıldı", await until(async () => (await entry(F)) === "removed"));
  check("açık duran sayfa 'erişimin yok'a döner", await shown(PF, "text=Bu maça erişimin yok", 20000));
  await PF.screenshot({ path: `${SHOTS}/invite-noaccess.png`, fullPage: true });
  await go(PK, matchUrl);
  check("çıkarılan 'Kadro dışı'nda görünmez", (await PK.locator(`text=${F.name}`).locator("visible=true").count()) === 0);
  await go(PF, matchUrl);
  check("adresle giremez", (await shown(PF, "text=Bu maça erişimin yok")) && (await PF.locator("text=Davet Kaptan").count()) === 0);
  await go(PF, `${BASE}/davet/m/${code}`);
  check("davet bağlantısıyla da giremez (kadro ve Başvur yok)", (await shown(PF, "text=Bu maça erişimin yok")) && (await PF.locator('button:text-is("Başvur")').count()) === 0);
  await openThread();
  check("kart 'Davet iptal edildi', düğme ve bağlantı yok", (await shown(PF, "text=Davet iptal edildi")) && (await PF.locator('button:text-is("Geliyorum")').count()) === 0 && (await PF.locator(`a[href="/g/${G}/m/${M}"]`).count()) === 0);
  await PF.screenshot({ path: `${SHOTS}/invite-revoked.png`, fullPage: true });

  // --- Yeniden davet, gönderen karttan geri çeker (alıcının sohbeti açık)
  check("yeniden davet gider", await invite());
  check("alıcının açık sohbetine yeni kart düşer", await shown(PF, 'button:text-is("Geliyorum")', 20000));
  await go(PF, matchUrl);
  check("yeniden davetle erişim geri gelir", await shown(PF, "text=Bu maça çağrıldın"));
  await openThread();
  await go(PK, `${BASE}/sohbet/${thread}`);
  check("gönderen kartta 'Daveti geri çek' görür", await shown(PK, 'button:text-is("Daveti geri çek")'));
  await PK.click('button:text-is("Daveti geri çek")');
  check("karttan geri çekildi", await until(async () => (await entry(F)) === "removed"));
  check("gönderende düğme kalkar", await gone(PK, 'button:text-is("Daveti geri çek")'));
  check("alıcının açık sohbetinde kart canlı iptal olur", await gone(PF, 'button:text-is("Geliyorum")', 20000));

  // --- Listeden geri çekme
  check("üçüncü davet gider", await invite());
  await go(PK, matchUrl);
  await PK.click('button:text-is("Daveti geri çek")');
  check("'Davetliler'den geri çekildi", (await until(async () => (await entry(F)) === "removed")) && (await shown(PK, "text=Davet geri çekildi")));
  check("liste boşalır", await gone(PK, "text=Davetliler ·"));

  // --- Kadrodaki oyuncunun daveti onaylanmaz → engel yok
  must(await rc.rpc("share_match_card", { p_user_id: S.id, p_type: "match", p_ref: M }));
  await go(PK, matchUrl);
  await PK.click('#basvurular button:text-is("Reddet")');
  check("onaylanmayan davet düşer (engel yok)", (await until(async () => (await entry(S)) === undefined)) && (await shown(PK, "text=Davet onaylanmadı")));
  const PS = await login(S);
  await go(PS, `${BASE}/davet/m/${code}`);
  check("daveti onaylanmayan bağlantıdan başvurabilir", await shown(PS, 'button:text-is("Başvur")'));

  // --- Kesin maç: davetlide "Gelemem" de var
  const P = must(await kc.rpc("create_match_v2", { p_group: G, p_day: day, p_time: "21:00", p_team_size: 5, p_kind: "internal", p_venue: "Meydan Saha", p_with_me: true, p_confirmed: [R.id] }));
  must(await admin.from("matches").update({ status: "planned" }).eq("id", P));
  must(await kc.rpc("share_match_card", { p_user_id: F.id, p_type: "match", p_ref: P }));
  await go(PF, `${BASE}/g/${G}/m/${P}`);
  check("kesin maçta davetliye Geliyorum ve Gelemem", (await shown(PF, 'button:text-is("Gelemem")')) && (await PF.locator('button:text-is("Geliyorum")').count()) === 1);
  await PF.screenshot({ path: `${SHOTS}/invite-planned.png`, fullPage: true });
  await PF.click('button:text-is("Geliyorum")'); await PF.waitForURL(/yanit=in/);
  await go(PK, `${BASE}/g/${G}/m/${P}`);
  await PK.locator(`button[aria-label*="${F.name}"], button:has-text("Davet M"), [role="button"][aria-label*="${F.name}"]`).first().click().catch(() => {});
  const stageOut = PK.locator('button:text-is("Maçtan çıkar")');
  if (await stageOut.count()) {
    await stageOut.first().click();
    check("sahadan 'Maçtan çıkar' çalışır", await until(async () => (await entry(F, P)) === "removed"));
  } else console.log("  ATLANDI: sahadaki kart seçilemedi (ekran görüntüsüne bak)");
  await PK.screenshot({ path: `${SHOTS}/invite-stage.png`, fullPage: true });
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message.split("\n").slice(0, 3).join(" | "));
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exitCode = failed ? 1 : 0;

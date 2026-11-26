// Gruptan ayrılma: üye ayrılır (geçmişi korunur, gelecekteki kadrodan çıkar), kaptan önce devretmeli, oylaması süren bekler,
// tekrar katılım, tek başına kalan kaptan grubu siler. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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

const names = ["Kaan Kaptan", "Mert Üye", "Ceyda Oylamada"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-leave-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b, c] = users;
  const G = (await admin.from("groups").insert({ name: "E2E Ayrılma Grubu", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G);
  for (const u of [b, c]) await admin.from("group_players").insert({ group_id: G, user_id: u.id, display_name: u.name, position: "MID" });
  const gp = async (u) => (await admin.from("group_players").select("id").eq("group_id", G).eq("user_id", u.id).single()).data.id;
  const [aG, bG, cG] = [await gp(a), await gp(b), await gp(c)];
  const mk = async (status, hours) => (await admin.from("matches").insert({ group_id: G, played_at: new Date(Date.now() + hours * 3600e3).toISOString(), created_by: a.id, kind: "internal", status, team_size: 5, score_a: status === "planned" ? null : 2, score_b: status === "planned" ? null : 1, voting_deadline: status === "voting" ? new Date(Date.now() + 864e5).toISOString() : null }).select("id").single()).data.id;
  const row = (m, p, team) => ({ match_id: m, player_id: p, team, goals: 0, assists: 0, saves: 0, position: null, is_goalkeeper: false });
  const past = await mk("closed", -72), future = await mk("planned", 72), voting = await mk("voting", -2);
  await admin.from("match_players").insert([row(past, aG, "A"), row(past, bG, "B"), row(future, aG, "A"), row(future, bG, "B"), row(voting, cG, "A"), row(voting, aG, "B")]);
  await admin.from("match_results").insert({ match_id: past, player_id: bG, performance: 0.6, match_score: 6.5, votes_received: 2, weight: 1, rating_before: 65, rating_after: 65, is_mvp: false });

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };

  // 1) Kaptan: önce devretmeli
  const aP = await open(a);
  await aP.goto(`${BASE}/g/${G}/players?bolum=ayril`);
  let t = await aP.locator("body").innerText();
  check("kaptan 'önce devret' uyarısını görür, ayrıl düğmesi yok", has(t, "kuruculuğu listeden birine devretmelisin") && !has(t, "Evet, gruptan ayrıl"));
  await aP.screenshot({ path: `${SHOTS}/103-ayrilma-kaptan.png`, fullPage: true });

  // 2) Üye (Mert) ayrılır
  const bP = await open(b);
  await bP.goto(`${BASE}/g/${G}/players?bolum=ayril`);
  await bP.screenshot({ path: `${SHOTS}/104-ayrilma-onay.png`, fullPage: true });
  await bP.click('button:has-text("Evet, gruptan ayrıl")');
  await bP.waitForURL(/left=1/, { timeout: 15000 });
  check("ayrılınca ana sayfada bilgi mesajı", has(await bP.locator("body").innerText(), "Gruptan ayrıldın"));
  const { data: left } = await admin.from("group_players").select("left_at, user_id").eq("id", bG).single();
  check("kayıt silinmedi, left_at dolu, hesap bağı duruyor", !!left?.left_at && left.user_id === b.id);
  const { count: pastRows } = await admin.from("match_players").select("*", { count: "exact", head: true }).eq("player_id", bG).eq("match_id", past);
  const { count: futureRows } = await admin.from("match_players").select("*", { count: "exact", head: true }).eq("player_id", bG).eq("match_id", future);
  check("geçmiş maç kadrosu korunur, gelecekteki maçtan çıkarıldı", pastRows === 1 && futureRows === 0);
  const resp = await bP.goto(`${BASE}/g/${G}`);
  check("ayrılan özel grubu artık açamaz", resp?.status() === 404 || !has(await bP.locator("body").innerText(), "E2E Ayrılma Grubu"));
  await bP.goto(`${BASE}/profil?sekme=istatistik`);
  t = await bP.locator("body").innerText();
  check("ayrılanın profil istatistiği geçmişi korur (1 maç)", /OYNANAN MAÇ\s+(stadium\s+)?1\s+maç/.test(t)); // "Oynanan Maç" kartı: sayı + "maç" (ikon adı metne karışır)
  await bP.goto(`${BASE}/profil?sekme=maclar`);
  t = await bP.locator("body").innerText();
  check("maç geçmişinde grup adı görünür ama bağlantı yok", has(t, "E2E Ayrılma Grubu") && (await bP.locator(`a[href^="/g/${G}/m/"]`).count()) === 0);
  await bP.goto(`${BASE}/profil`);
  t = await bP.locator("body").innerText();
  check("profilde ayrıldığı grup 'takımlarım ve gruplarım' listesinde yok", !has(t, "E2E Ayrılma Grubu"));

  // Kaptan bildirim alır
  let notif = null;
  for (let i = 0; i < 12 && !notif; i++) {
    notif = (await admin.from("notifications").select("title, body, url").eq("user_id", a.id).like("title", "%ayrıldı%").maybeSingle()).data;
    if (!notif) await sleep(1000);
  }
  check("kaptana 'üye ayrıldı' bildirimi gitti", !!notif && notif.body.includes("Mert Üye") && notif.url === `/g/${G}/players?bolum=oyuncular`);

  // Kaptanın üye listesinde Mert yok
  await aP.goto(`${BASE}/g/${G}/players?bolum=oyuncular`);
  t = await aP.locator("body").innerText();
  check("kaptanın üye listesinde ayrılan yok", !has(t, "Mert Üye"));

  // 3) Oylaması süren maçı olan (Ceyda) ayrılamaz
  const cP = await open(c);
  await cP.goto(`${BASE}/g/${G}/players?bolum=ayril`);
  await cP.click('button:has-text("Evet, gruptan ayrıl")');
  await cP.waitForURL(/error=/, { timeout: 15000 });
  await cP.locator("p.text-error").waitFor({ timeout: 10000 });
  check("oylaması süren maçı olan ayrılamaz (açıklayıcı mesaj)", has(await cP.locator("body").innerText(), "Oylaması süren bir maçın var"));
  await cP.screenshot({ path: `${SHOTS}/105-ayrilma-oylama-hatasi.png`, fullPage: true });

  // 4) Mert aynı davet koduyla geri döner (satır yeniden açılır)
  const bClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await bClient.auth.signInWithPassword({ email: b.email, password: b.password });
  const { data: code } = await admin.from("groups").select("invite_code").eq("id", G).single();
  const { error: joinErr } = await bClient.rpc("join_group", { p_invite_code: code.invite_code });
  const { data: back } = await admin.from("group_players").select("left_at, role").eq("id", bG).single();
  check("davet koduyla geri dönünce aynı kayıt yeniden açılır (üye rolü)", !joinErr && back.left_at === null && back.role === "member");

  // 5) Tek başına kalan kaptan grubu siler
  const G2 = (await admin.from("groups").insert({ name: "E2E Tek Üyeli Grup", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G2);
  await aP.goto(`${BASE}/g/${G2}/players?bolum=ayril`);
  check("tek üyeli kaptan 'grubu sil' seçeneğini görür", await aP.locator("summary:has-text('Grubu sil')").isVisible());
  await aP.locator("summary:has-text('Grubu sil')").click();
  await aP.fill('input[name="confirm"]', "yanlış ad");
  await aP.click('button:has-text("Kalıcı olarak sil")');
  await aP.waitForURL(/error=/, { timeout: 15000 });
  await aP.locator("p.text-error").waitFor({ timeout: 10000 });
  check("yanlış adla silinmez", has(await aP.locator("body").innerText(), "adını aynen yazmalısın") && (await admin.from("groups").select("id").eq("id", G2)).data.length === 1);
  await aP.goto(`${BASE}/g/${G2}/players?bolum=ayril`);
  await aP.locator("summary:has-text('Grubu sil')").click();
  await aP.fill('input[name="confirm"]', "e2e tek üyeli grup");
  await aP.screenshot({ path: `${SHOTS}/106-grup-sil.png`, fullPage: true });
  await aP.click('button:has-text("Kalıcı olarak sil")');
  await aP.waitForURL(/deleted=1/, { timeout: 15000 });
  check("doğru adla grup silinir", (await admin.from("groups").select("id").eq("id", G2)).data.length === 0);
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

// Maç ekranı yönetimi (yeniden tasarım 4b): Keşfet ilanı + yabancı başvurusu ve onayı, başka gruba ilan (onaylı),
// davet bağlantısı (/davet/m/<kod>) ile başvuru, dolu kadroda yedek ve yedekten alma, kesin gelen ekleme,
// rakip adı, kesinleştir, ertele, iptal; uygulamadaki takıma teklif + karşı teklif + kabul.
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
const users = []; let browser;
const stamp = Date.now();
try {
  for (const [i, n] of ["Onur Kaptan", "Berk Uye", "Lale Kurucu", "Deniz Yabanci", "Melih Arkadas", "Riza Rakip"].entries()) {
    const email = `e2e-manage-${stamp}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Kırklareli", district: "Lüleburgaz", preferred_position: "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [O, B, L, D, M, R] = users;
  const T = must(await admin.from("groups").insert({ name: `Yonetim Takimi ${stamp % 1000}`, kind: "team", created_by: O.id, city: "Kırklareli", district: "Lüleburgaz" }).select("id").single()).id;
  must(await admin.from("group_players").insert({ group_id: T, user_id: B.id, display_name: B.name, role: "member" }));
  const C = must(await admin.from("groups").insert({ name: `Pazar Grubu ${stamp % 1000}`, kind: "community", created_by: L.id, city: "Kırklareli" }).select("id").single()).id;
  must(await admin.from("group_players").insert({ group_id: C, user_id: O.id, display_name: O.name, role: "member" }));
  const RT = must(await admin.from("groups").insert({ name: `Rakip Aslanlar ${stamp % 1000}`, kind: "team", created_by: R.id, city: "Kırklareli" }).select("id").single()).id;

  // Onur maç ayarlar (RPC, kendi oturumuyla): 5v5 kadro 3, saat belli değil, sadece kendisi
  const asUser = async (u) => { const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }); must(await c.auth.signInWithPassword({ email: u.email, password: u.password })); return c; };
  const oc = await asUser(O);
  const day = new Date(Date.now() + 3 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10);
  const mk = async (cap) => must(await oc.rpc("create_match_v2", { p_group: T, p_day: day, p_time: null, p_team_size: 5, p_kind: "external", p_capacity: cap, p_with_me: true }));
  const MID = await mk(3);
  const url = `${BASE}/g/${T}/m/${MID}`;

  browser = await chromium.launch();
  const login = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", u.name, page.url(), e.message));
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/", { timeout: 30000 }); return page;
  };
  const go = async (p, to) => p.goto(to, { waitUntil: "networkidle" });
  const entry = async (u, mid = MID) => (await admin.from("match_entries").select("status").eq("match_id", mid).eq("user_id", u.id).maybeSingle()).data?.status;
  const PO = await login(O);

  // --- Keşfet ilanı
  await go(PO, url);
  check("yöneten maç ekranında 'Adam ara', 'Rakip', 'Maçı kesinleştir', 'Maçı iptal et' görür", (await PO.locator("text=Adam ara").count()) >= 1 && (await PO.locator("text=Maçı kesinleştir").count()) >= 1 && (await PO.locator("text=Maçı iptal et").count()) >= 1);
  await PO.click('summary:has-text("Paylaşılacak yerleri seç")'); await PO.check(`input[name="targets"][value="kesfet"]`);
  await PO.click('label:has-text("Forvet")');
  await PO.click('form:has(input[name="targets"]) button:text-is("Ekle")'); await PO.waitForURL(/ok=ilan/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("Keşfet ilanı açıldı", (await PO.locator("text=Keşfet (herkese açık)").count()) >= 1);
  await PO.screenshot({ path: `${SHOTS}/manage-owner.png`, fullPage: true });

  // --- Başka gruba ilan (Onur orada sıradan üye → Lale'nin onayına)
  await PO.click('summary:has-text("Paylaşılacak yerleri seç")'); await PO.check(`input[name="targets"][value="${C || "kesfet"}"]`);
  await PO.click('form:has(input[name="targets"]) button:text-is("Ekle")'); await PO.waitForSelector("text=onay bekliyor", { timeout: 20000 }).catch(() => null);
  check("gruba ilan onay bekliyor", (await PO.locator("text=onay bekliyor").count()) >= 1);
  const PL = await login(L);
  await go(PL, `${BASE}/g/${C}`);
  check("grubun kurucusu grup sayfasında 'Bekleyen istekler'i görür", (await PL.locator("text=Bekleyen istekler").count()) === 1);
  await go(PL, `${BASE}/g/${C}/istekler`);
  check("istekler sayfasında ilan onayı sekmesi", (await PL.locator("text=İlan onayı").count()) === 1 && (await PL.locator("text=maçı için adam arıyor").count()) === 1);
  await PL.screenshot({ path: `${SHOTS}/manage-istekler.png`, fullPage: true });
  await PL.click('button:has-text("Grupta yayınla")'); for (let i = 0; i < 40 && (await admin.from("match_listings").select("status").eq("match_id", MID).eq("target_group_id", C).single()).data.status !== "active"; i++) await new Promise((r) => setTimeout(r, 500));
  check("ilan grupta yayında", (await admin.from("match_listings").select("status").eq("match_id", MID).eq("target_group_id", C).single()).data.status === "active");
  await go(PL, url);
  check("grup üyesi (kurucu) ilan sayesinde maç ekranını görür ve başvurabilir", (await PL.locator("text=Bu maça adam aranıyor").count()) === 1);

  // --- Yabancı Keşfet ilanından başvurur, Onur kadroya alır
  const PD = await login(D);
  await go(PD, url);
  check("yabancı maç ekranını açabilir, kadroyu görür", (await PD.locator("text=Bu maça adam aranıyor").count()) === 1);
  await PD.selectOption('select[aria-label="Mevki"]', "FWD"); await PD.fill('input[aria-label="Başvuru notu"]', "Forvet oynarım");
  await PD.click('button:has-text("Başvur")'); await PD.waitForURL(/ok=basvuru/); await PD.waitForLoadState("networkidle"); await PD.locator("main").waitFor();
  check("başvuru onay bekliyor", (await entry(D)) === "pending");
  await PD.screenshot({ path: `${SHOTS}/manage-applicant.png`, fullPage: true });
  await go(PO, url);
  check("yöneten başvuruyu notuyla görür", (await PO.locator("text=Forvet oynarım").count()) === 1);
  await PO.click('button:has-text("Kadroya al")'); await PO.waitForURL(/ok=basvuru-in/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("başvuru kabul → kadro (2/3)", (await entry(D)) === "in");

  // --- Bağlantı: Melih /davet/m/<kod> → başvurur → kabul (son yer)
  const code = must(await oc.rpc("match_invite_code", { p_match: MID }));
  const PM = await login(M);
  await go(PM, `${BASE}/davet/m/${code}`);
  check("bağlantıyı açan kadroyu ve sayacı görür", (await PM.locator("text=2/3").count()) >= 1 && (await PM.locator("text=Deniz Yabanci").count()) === 1);
  await PM.screenshot({ path: `${SHOTS}/manage-invite-link.png`, fullPage: true });
  await PM.click('button:has-text("Başvur")'); await PM.waitForURL(/ok=basvuru/); await PM.waitForLoadState("networkidle"); await PM.locator("main").waitFor();
  check("bağlantıyla başvuru onay bekliyor", (await entry(M)) === "pending" && (await PM.locator("text=Başvurun gönderildi").count()) === 1);
  await go(PO, url);
  await PO.click('button:has-text("Kadroya al")'); await PO.waitForURL(/ok=basvuru-in/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("kadro doldu (3/3)", (await admin.from("matches").select("roster_count").eq("id", MID).single()).data.roster_count === 3);

  // --- Dolu kadro: Berk 'Geliyorum (yedek)' → yedek; Onur Deniz'i çıkarır, Berk'i yedekten alır
  const PB = await login(B);
  await go(PB, url);
  await PB.click('button:has-text("Geliyorum")'); await PB.waitForURL(/yanit=reserve/); await PB.waitForLoadState("networkidle"); await PB.locator("main").waitFor();
  check("dolu kadroda üye yedeğe düşer", (await entry(B)) === "reserve");
  await go(PO, url);
  await PO.click(`button[aria-label="${D.name} kadrodan çıkar"]`); await PO.waitForURL(/ok=cikarildi/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  await PO.click('li:has-text("Berk Uye") button:has-text("Kadroya al")'); await PO.waitForURL(/ok=eklendi/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("yer açılınca yedek kadroya alındı", (await entry(B)) === "in" && (await entry(D)) === "left");

  // --- Rakip adı, kesinleştir, ertele
  await PO.click('button:text-is("Uygulamada yok")'); await PO.fill('input[aria-label="Rakip adı"]', "Yıldızspor"); await PO.click('form:has(input[name="opponent"]) button:text-is("Kaydet")'); await PO.waitForURL(/ok=rakip/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  await PO.fill('input[aria-label="Maç saati"]', "21:00");
  await PO.click('button:has-text("Maçı kesinleştir")'); await PO.waitForURL(/ok=kesin/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  const k = (await admin.from("matches").select("status, opponent_name, time_tbd").eq("id", MID).single()).data;
  check("maç kesinleşti (rakip yazılı, saat belli)", k.status === "planned" && k.opponent_name === "Yıldızspor" && k.time_tbd === false);
  await PO.click("summary:has-text('Ertele')");
  await PO.fill('input[aria-label="Yeni saat"]', "22:00");
  await PO.click('form:has(input[aria-label="Yeni saat"]) button:has-text("Ertele")'); await PO.waitForURL(/ok=ertelendi/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  const e = (await admin.from("matches").select("played_at, free_withdraw_until").eq("id", MID).single()).data;
  check("ertelendi: yeni saat ve 24 saat serbest çekilme", new Date(e.played_at).toISOString().slice(11, 16) === "19:00" && !!e.free_withdraw_until);
  await new Promise((r) => setTimeout(r, 2500));
  const tagsOf = async (u) => (must(await admin.from("notifications").select("title").eq("user_id", u.id)) ?? []).map((n) => n.title);
  check("kadroya 'Maç kesinleşti' ve 'Maç saati değişti' bildirimleri", (await tagsOf(B)).some((t) => t.includes("kesinleşti")) && (await tagsOf(B)).some((t) => t.includes("saati değişti")));
  check("başvurana kabul bildirimi", (await tagsOf(D)).some((t) => t.includes("Başvurun kabul edildi")));
  await PO.screenshot({ path: `${SHOTS}/manage-planned.png`, fullPage: true });

  // --- İptal (toplanan başka maç)
  const M2 = await mk(5);
  await go(PO, `${BASE}/g/${T}/m/${M2}`);
  await PO.click("summary:has-text('Maçı iptal et')");
  await PO.fill('input[aria-label="İptal sebebi"]', "Saha kapalı");
  await PO.click('form:has(input[aria-label="İptal sebebi"]) button:has-text("İptal et")'); await PO.waitForURL(/ok=iptal/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("toplanan maç iptal edildi, silinmedi, sebep görünür", (await admin.from("matches").select("status").eq("id", M2).single()).data.status === "cancelled" && (await PO.locator("text=Saha kapalı").count()) >= 1);

  // --- Uygulamadaki takıma teklif → karşı teklif → kabul
  const M3 = await mk(5);
  await go(PO, `${BASE}/g/${T}/m/${M3}`);
  await PO.selectOption('select[aria-label="İl"] >> nth=-1', "");
  await PO.fill('input[aria-label="Takım ara"]', "Rakip Aslanlar");
  await PO.locator('button:has-text("Rakip Aslanlar")').first().click();
  await PO.click('button:has-text("Teklif gönder")'); await PO.waitForURL(/ok=teklif/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  check("teklif gönderildi, sıra rakipte", (await PO.locator("text=Sıra rakipte").count()) === 1);
  const PR = await login(R);
  await go(PR, `${BASE}/g/${RT}/teklifler`);
  await PR.click("summary:has-text('Karşı teklif yap')");
  await PR.fill('input[aria-label="Önerilen saat (boşsa belli değil)"]', "20:30");
  await PR.click('button:has-text("Karşı teklifi gönder")'); await PR.waitForURL(/teklifler/); await PR.waitForLoadState("networkidle"); await PR.locator("main").waitFor();
  for (let i = 0; i < 40 && (await admin.from("match_challenges").select("awaiting_group_id").eq("from_match_id", M3).single()).data.awaiting_group_id !== T; i++) await new Promise((r) => setTimeout(r, 500));
  check("rakip karşı teklif yaptı, sıra gönderende", (await admin.from("match_challenges").select("awaiting_group_id").eq("from_match_id", M3).single()).data.awaiting_group_id === T);
  await go(PO, `${BASE}/g/${T}/m/${M3}`);
  check("gönderen maç ekranında karşı teklifi görür", (await PO.locator("text=Rakip karşı teklif yaptı").count()) === 1);
  await PO.click('form:has(input[name="challengeId"]) button:has-text("Kabul et")'); await PO.waitForURL(/ok=teklif-kabul/); await PO.waitForLoadState("networkidle"); await PO.locator("main").waitFor();
  const lm = (await admin.from("matches").select("opponent_group_id, time_tbd, challenge_id").eq("id", M3).single()).data;
  const rm = (await admin.from("matches").select("status").eq("challenge_id", lm.challenge_id).eq("group_id", RT).maybeSingle()).data;
  check("maç rakiple bağlandı, saat karşı tekliften, rakibe toplanan maç açıldı", lm.opponent_group_id === RT && lm.time_tbd === false && rm?.status === "gathering");
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message.split("\n")[0]);
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exitCode = failed ? 1 : 0;

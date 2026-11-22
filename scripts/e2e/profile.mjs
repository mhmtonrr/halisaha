// Profil: sekmeler (Genel/İstatistik/Maçlar/Ayarlar), tüm gruplardaki istatistik, başkasının profili ve görünürlük ayarı.
// "Gruplarımdaki kartlarım" bölümü kalktı. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
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

const names = ["Ali Atak", "Barış Bek", "Cem Yabancı"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-profile-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: "FWD", shirt_number: 9, bio: "Golcü", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  const [a, b, c] = users;
  // Özel grup G (Ali kurucu, Barış üye) ve herkese açık takım T (Ali kaptan)
  const G = (await admin.from("groups").insert({ name: "E2E Özel Grup", created_by: a.id }).select("id").single()).data.id;
  const T = (await admin.from("groups").insert({ name: "E2E Takım", kind: "team", city: "İstanbul", color: "#e11d48", created_by: a.id }).select("id").single()).data.id;
  groupIds.push(G, T);
  await admin.from("group_players").insert({ group_id: G, user_id: b.id, display_name: b.name, position: "MID" });
  const gp = async (g, u) => (await admin.from("group_players").select("id").eq("group_id", g).eq("user_id", u.id).single()).data.id;
  const aG = await gp(G, a), bG = await gp(G, b), aT = await gp(T, a);

  const mkMatch = async (group, kind, sA, sB, status, hoursAgo) => (await admin.from("matches").insert({
    group_id: group, played_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(), created_by: a.id, kind, status,
    opponent_name: kind === "external" ? "Rakip FK" : null, team_size: 5, score_a: sA, score_b: sB,
    voting_deadline: new Date(Date.now() + 864e5).toISOString(),
  }).select("id").single()).data.id;
  const row = (m, p, team, goals, assists, pos) => ({ match_id: m, player_id: p, team, goals, assists, saves: 0, position: pos, is_goalkeeper: false });
  const res = (m, p, score, mvp) => ({ match_id: m, player_id: p, performance: score / 10, match_score: score, votes_received: 3, weight: 1, rating_before: 65, rating_after: 66, is_mvp: mvp });

  // Özel grupta 2 maç: Ali takım A kazandı (2 gol), sonra kaybetti; Takımda rakibe karşı 1 galibiyet (oylamada)
  const g1 = await mkMatch(G, "internal", 3, 2, "closed", 72);
  const g2 = await mkMatch(G, "internal", 1, 2, "closed", 48);
  const t1 = await mkMatch(T, "external", 4, 1, "voting", 3);
  await admin.from("match_players").insert([row(g1, aG, "A", 2, 1, "FWD"), row(g1, bG, "B", 0, 0, "MID"), row(g2, aG, "A", 1, 0, "FWD"), row(g2, bG, "B", 1, 1, "MID"), row(t1, aT, "A", 3, 0, "FWD")]);
  await admin.from("match_results").insert([res(g1, aG, 8.5, true), res(g1, bG, 5.5, false), res(g2, aG, 6.0, false), res(g2, bG, 7.5, true)]);
  await admin.from("match_no_shows").insert({ match_id: g2, user_id: b.id }).then(() => {}, () => {});

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const text = (p) => p.locator("body").innerText();
  // Başlıklar CSS ile BÜYÜK harfe çevrildiğinden karşılaştırma Türkçe küçük harfe göre yapılır
  const has = (t, x) => t.toLocaleLowerCase("tr").includes(x.toLocaleLowerCase("tr"));

  // 1) Kendi profilim
  const aP = await open(a);
  await aP.goto(`${BASE}/profil`);
  let t = await text(aP);
  check("'Gruplarımdaki kartlarım' bölümü yok", !has(t, "Gruplarımdaki kartlarım"));
  check("dört sekme (Genel, İstatistik, Maçlar, Ayarlar)", ["Genel", "İstatistik", "Maçlar", "Ayarlar"].every((x) => has(t, x)));
  check("kartta plaka kodu ve yetenek kısaltmaları", has(t, "34") && ["HIZ", "ŞUT", "PAS", "DRİ", "DEF", "FİZ"].every((x) => has(t, x)));
  check("takımlarım ve gruplarım listesi", has(t, "E2E Özel Grup") && has(t, "E2E Takım"));
  await aP.screenshot({ path: `${SHOTS}/95-profil-genel.png`, fullPage: true });

  await aP.click('a[role="tab"]:has-text("İstatistik")');
  await aP.waitForURL(/sekme=istatistik/);
  t = await text(aP);
  check("istatistik: 3 maç (özel grup 2 + takım 1, oylamadaki dahil)", /3\s*\n?\s*Maç/.test(t));
  check("istatistik: 6 gol toplamı (2+1+3)", /6\s*\n?\s*Gol/.test(t));
  check("istatistik: takım ve gruplara göre döküm", has(t, "Takım ve gruplara göre") && has(t, "E2E Özel Grup") && has(t, "E2E Takım"));
  check("istatistik: rakibe karşı / kendi aramızda", has(t, "Rakip takıma karşı") && has(t, "Kendi aramızda"));
  check("istatistik: güvenilirlik", has(t, "Güvenilirlik"));
  await aP.screenshot({ path: `${SHOTS}/96-profil-istatistik.png`, fullPage: true });

  await aP.click('a[role="tab"]:has-text("Maçlar")');
  await aP.waitForURL(/sekme=maclar/);
  t = await text(aP);
  check("maçlar: üç maç, rakip adı ve skorlar", has(t, "Rakip FK") && has(t, "4-1") && has(t, "3-2") && has(t, "1-2"));
  check("maçlar: oylamadaki maç 'oylamada' etiketli", has(t, "oylamada"));
  await aP.screenshot({ path: `${SHOTS}/97-profil-maclar.png`, fullPage: true });

  await aP.click('a[role="tab"]:has-text("Ayarlar")');
  await aP.waitForURL(/sekme=ayarlar/);
  t = await text(aP);
  check("ayarlar: profil formu, görünürlük ve bildirimler", has(t, "Ad soyad") && has(t, "İstatistiklerini kim görsün?") && has(t, "Bildirimler"));
  check("ayarlar: varsayılan 'Sadece takım arkadaşlarım' seçili", await aP.locator('input[name="visibility"][value="teammates"]').isChecked());
  await aP.screenshot({ path: `${SHOTS}/98-profil-ayarlar.png`, fullPage: true });

  // 2) Takım arkadaşı (Barış) Ali'nin profilini görür; yabancı (Cem) göremez
  const bP = await open(b);
  await bP.goto(`${BASE}/oyuncu/${a.id}?sekme=istatistik`);
  t = await text(bP);
  check("takım arkadaşı istatistikleri görür", has(t, "Takım ve gruplara göre") && !has(t, "🔒"));
  await bP.goto(`${BASE}/oyuncu/${a.id}?sekme=maclar`);
  t = await text(bP);
  check("üye olduğu özel grubun adı görünür", has(t, "E2E Özel Grup"));
  check("başkasının profilinde 'Ayarlar' sekmesi yok", !(await bP.locator('a[role="tab"]:has-text("Ayarlar")').count()));

  const cP = await open(c);
  await cP.goto(`${BASE}/oyuncu/${a.id}`);
  t = await text(cP);
  check("yabancı kartı ve yetenekleri görür", has(t, "ALİ ATAK") && has(t, "HIZ") && has(t, "Takımları") && has(t, "E2E Takım"));
  check("yabancı özel grubu listede görmez", !has(t, "E2E Özel Grup"));
  await cP.goto(`${BASE}/oyuncu/${a.id}?sekme=istatistik`);
  t = await text(cP);
  check("yabancı için istatistik kilitli", has(t, "🔒") && !has(t, "Takım ve gruplara göre"));
  await cP.screenshot({ path: `${SHOTS}/99-profil-kilitli.png`, fullPage: true });
  await cP.goto(`${BASE}/oyuncu/${a.id}?sekme=maclar`);
  check("yabancı için maç geçmişi kilitli", has(await text(cP), "🔒"));

  // 3) Ali herkese açık yapar → yabancı görür, özel grubun adı hâlâ gizli
  await aP.locator('input[name="visibility"][value="public"]').check();
  await aP.click('button:has-text("Görünürlüğü kaydet")');
  await aP.waitForURL(/saved=1/);
  const { data: prof } = await admin.from("profiles").select("stats_visibility").eq("id", a.id).single();
  check("ayar kaydedildi (public)", prof?.stats_visibility === "public");
  await cP.goto(`${BASE}/oyuncu/${a.id}?sekme=istatistik`);
  check("herkese açıkken yabancı istatistikleri görür", has(await text(cP), "Takım ve gruplara göre"));
  await cP.goto(`${BASE}/oyuncu/${a.id}?sekme=maclar`);
  t = await text(cP);
  check("maç geçmişinde özel grup adı 'Özel grup' olarak gizli", has(t, "Özel grup") && !has(t, "E2E Özel Grup") && has(t, "E2E Takım"));
  check("özel grup maçı yabancı için bağlantı değil, takım maçı bağlantı", (await cP.locator(`a[href^="/g/${G}/m/"]`).count()) === 0 && (await cP.locator(`a[href^="/g/${T}/m/"]`).count()) === 1);
  await cP.screenshot({ path: `${SHOTS}/100-profil-acik-maclar.png`, fullPage: true });

  // 4) Kendi profilime /oyuncu/ ile gidince /profil'e döner; geçersiz kimlik 404
  await aP.goto(`${BASE}/oyuncu/${a.id}`);
  check("kendi /oyuncu adresi /profil'e yönlenir", aP.url().includes("/profil"));
  const bad = await cP.goto(`${BASE}/oyuncu/abc`);
  check("geçersiz kimlik 404", bad?.status() === 404);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  for (const g of groupIds) await admin.from("groups").delete().eq("id", g);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

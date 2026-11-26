// Oylama → maç özeti → sonuç ekranı → takım puan tablosu. Grup içi maç (sekmeler, cihazda taslak, zorunlu puan) ve
// takım maçları (puan tablosu, ▲▼ / YENİ, istatistik sayfası). Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split(/\r?\n/).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const names = ["Ali Atak", "Barış Bek", "Cem Orta", "Deniz Kaleci"];
const users = []; const groupIds = []; let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-voting-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const data = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } }));
    users.push({ id: data.user.id, email, password, name: n });
    must(await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", onboarded_at: new Date().toISOString() }).eq("id", data.user.id));
  }
  const [a, b, c, d] = users;

  const mkGroup = async (name, kind) => {
    const g = must(await admin.from("groups").insert({ name, kind, created_by: a.id, city: "İstanbul", district: "Kadıköy" }).select("id").single()).id;
    groupIds.push(g);
    for (const u of [b, c, d]) must(await admin.from("group_players").insert({ group_id: g, user_id: u.id, display_name: u.name, position: u === d ? "GK" : "MID" }));
    const gp = {};
    for (const [k, u] of Object.entries({ a, b, c, d })) gp[k] = must(await admin.from("group_players").select("id").eq("group_id", g).eq("user_id", u.id).single()).id;
    return { g, gp };
  };
  /** Oylamadaki maç; rows: [oyuncu, takım, gol, asist, kurtarış] */
  const mkMatch = async (g, kind, daysAgo, score, rows) => {
    const m = must(await admin.from("matches").insert({ group_id: g, played_at: new Date(Date.now() - daysAgo * 864e5 - 3600e3).toISOString(), created_by: a.id, kind, opponent_name: kind === "external" ? "Yıldızspor" : null, status: "voting", voting_deadline: new Date(Date.now() + 864e5).toISOString(), team_size: 5, score_a: score[0], score_b: score[1] }).select("id").single()).id;
    must(await admin.from("match_players").insert(rows.map(([player_id, team, goals, assists, saves]) => ({ match_id: m, player_id, team, goals, assists, saves, is_goalkeeper: saves > 0, position: saves > 0 ? "GK" : "MID" }))));
    return m;
  };
  /** Servis anahtarıyla oylar: her oy veren herkese, hedefe göre sabit puan */
  const seedVotes = async (m, voters, targets, scoreFor, mvp) => {
    must(await admin.from("votes").insert(voters.flatMap((v) => targets.filter((t) => t !== v).map((t) => ({ match_id: m, voter_id: v, target_id: t, score: scoreFor(t) })))));
    if (mvp) must(await admin.from("mvp_votes").insert(voters.filter((v) => v !== mvp).map((v) => ({ match_id: m, voter_id: v, target_id: mvp }))));
  };

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => { console.log("  [sayfa hatası]", e.message); failed++; });
    await page.goto(BASE + "/login", { waitUntil: "networkidle" }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const text = async (loc) => (await loc.innerText()).toLocaleLowerCase("tr");

  console.log("1) Grup içi maç: oylama ekranı");
  const G = await mkGroup("E2E Oylama Grubu", "community");
  const { gp } = G;
  const m1 = await mkMatch(G.g, "internal", 0, [3, 2], [[gp.a, "A", 1, 0, 0], [gp.b, "A", 2, 1, 0], [gp.c, "B", 2, 0, 0], [gp.d, "B", 0, 0, 3]]);
  const url1 = `${BASE}/g/${G.g}/m/${m1}`;
  const A = await open(a);
  await A.goto(url1, { waitUntil: "networkidle" });
  const vs = A.locator('section[aria-label="Oylama"]');
  const row = (n) => A.locator("[data-vote-row]", { hasText: n });
  const send = A.locator('button:has-text("Oylarımı gönder")');
  check("başlıkta süre, oy veren ve ilerleme", /kaldı/.test(await text(vs)) && (await text(vs)).includes("0/4") && (await text(vs)).includes("0/3"));
  check("kendim listede yok, 3 oyuncu", (await A.locator("[data-vote-row]").count()) === 3 && (await row("Ali Atak").count()) === 0);
  check("sekmeler: takımın ve rakipler", (await vs.locator('[role="tab"]').count()) === 2);
  check("puanlar boş başlar", (await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').count()) === 0);
  check("eksikken gönder kapalı", await send.isDisabled());
  check("satırda gol/asist", (await row("Barış Bek").innerText()).includes("2 gol · 1 asist"));
  const summary = A.locator('section[aria-label="Maç özeti"]');
  const sum = await text(summary);
  check("maç özeti: skor ve katkılar", ["2 gol", "1 asist", "3 kurtarış", "barış bek", "deniz kaleci"].every((x) => sum.includes(x)));

  await row("Barış Bek").locator('[role="radio"]').nth(8).click(); // 9
  await row("Barış Bek").locator('button:has-text("MVP")').click();
  check("ilerleme 1/3", (await text(vs)).includes("1/3"));
  check("taslak notu görünür", await A.locator("text=Taslak saklandı").isVisible());
  await A.evaluate(() => window.scrollTo(0, 0));
  const bar = await send.boundingBox(), nav = await A.locator("nav").last().boundingBox();
  check("sabit gönder düğmesi ekranda, alt menünün üstünde", !!bar && !!nav && bar.y >= 0 && bar.y + bar.height <= nav.y);
  check("oylamada yatay taşma yok", await noOverflow(A));
  await A.screenshot({ path: `${SHOTS}/v1-oylama-ekran.png` });
  await shot(A, "v2-oylama-tam");

  console.log("2) Cihazda taslak");
  await A.goto(BASE + "/", { waitUntil: "networkidle" });
  await A.goto(url1, { waitUntil: "networkidle" });
  await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  check("sayfadan çıkıp dönünce puan geri geldi", (await row("Barış Bek").locator('[role="radio"]').nth(8).getAttribute("aria-checked")) === "true");
  check("MVP seçimi geri geldi", (await row("Barış Bek").locator('button:has-text("MVP")').getAttribute("aria-pressed")) === "true");
  await A.reload({ waitUntil: "networkidle" });
  await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  check("yenilemede de korunur", (await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').count()) === 1);

  console.log("3) Sunucu eksik puanı reddeder");
  await send.evaluate((el) => { el.disabled = false; el.click(); });
  await A.waitForURL(/error=/, { timeout: 15000 });
  await A.waitForLoadState("networkidle");
  await A.locator("text=tüm oyuncuları puanlamalısın").waitFor({ timeout: 10000 }).catch(() => {});
  await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  check("eksik puan hatası", await A.locator("text=tüm oyuncuları puanlamalısın").isVisible());
  check("hiç oy yazılmadı", must(await admin.from("votes").select("score").eq("match_id", m1)).length === 0);
  check("hatadan sonra taslak duruyor", (await A.locator('[data-vote-row] [role="radio"][aria-checked="true"]').count()) === 1);

  console.log("4) Gönder ve güncelle");
  const rateAll = async (page, n) => {
    for (const tab of await page.locator('section[aria-label="Oylama"] [role="tab"]').all()) {
      await tab.click();
      for (const r of await page.locator("[data-vote-row]:visible").all()) {
        if ((await r.locator('[role="radio"][aria-checked="true"]').count()) === 0) await r.locator('[role="radio"]').nth(n - 1).click();
      }
    }
  };
  await rateAll(A, 7);
  check("hepsi puanlanınca gönder açık", await send.isEnabled());
  await send.click(); await A.waitForURL(/voted=1/, { timeout: 20000 }); await A.waitForLoadState("networkidle");
  const mine = must(await admin.from("votes").select("target_id, score").eq("match_id", m1).eq("voter_id", gp.a));
  check("3 oy yazıldı (Barış 9, diğerleri 7)", mine.length === 3 && mine.find((v) => v.target_id === gp.b)?.score === 9 && mine.filter((v) => v.score === 7).length === 2);
  check("MVP oyu yazıldı", must(await admin.from("mvp_votes").select("target_id").eq("match_id", m1).eq("voter_id", gp.a))[0]?.target_id === gp.b);
  // Taslak, yenilenen form ekrana gelince silinir (geliştirme sunucusunda birkaç saniye sürebilir)
  await A.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith("hs-oy-")), null, { timeout: 15000 }).catch(() => {});
  const draftKeys = () => A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hs-oy-")));
  check("gönderince taslak silindi", (await draftKeys()).length === 0);
  check("başlık 'Oylarını güncelle', 1/4 oy verdi", (await text(vs)).includes("oylarını güncelle") && (await text(vs)).includes("1/4"));
  await send.waitFor(); check("gönderdikten sonra düğme takılı kalmadı", await send.isEnabled());
  await row("Barış Bek").waitFor({ state: "attached" });
  await vs.locator('[role="tab"]').first().click();
  await row("Barış Bek").locator('[role="radio"]').nth(7).click(); // 8
  await A.waitForTimeout(300);
  check("değişiklik yeniden taslak olur", (await draftKeys()).length === 1);
  await row("Barış Bek").locator('[role="radio"]').nth(8).click(); // geri 9
  await A.waitForTimeout(300);
  check("kayıtlı değere dönünce taslak silinir", (await draftKeys()).length === 0);

  console.log("5) Herkes oy verince sonuç (grup)");
  const all1 = [gp.a, gp.b, gp.c, gp.d];
  await seedVotes(m1, [gp.b, gp.c], all1, (t) => (t === gp.b ? 9 : 6), gp.b);
  const D = await open(d);
  await D.goto(url1, { waitUntil: "networkidle" });
  await rateAll(D, 6);
  await D.locator('button:has-text("Oylarımı gönder")').click();
  await D.waitForURL(/voted=1/, { timeout: 30000 }); await D.waitForLoadState("networkidle");
  await A.goto(url1, { waitUntil: "networkidle" });
  const res = A.locator('section[aria-label="Maç sonuçları"]').first();
  const rt = await text(res);
  check("maç kapandı: maçın adamı, senin sonucun, sıralama", ["maçın adamı", "senin sonucun", "performans sıralaması"].every((x) => rt.includes(x)));
  check("sıralamada 4 oyuncu", (await res.locator("ol > li").count()) === 4);
  check("kapanınca da maç özeti var", (await summary.count()) === 1);
  check("grupta puan tablosu sekmesi yok", (await res.locator('[role="tab"]').count()) === 0);
  check("sonuçta yatay taşma yok", await noOverflow(A));
  await shot(A, "v3-sonuc-grup");

  console.log("6) Takım: puan tablosu ve ▲▼");
  const T = await mkGroup("E2E Oylama Takımı", "team");
  const p = T.gp;
  const close = async (m) => { must(await admin.from("matches").update({ voting_deadline: new Date(Date.now() - 1000).toISOString() }).eq("id", m)); await A.goto(`${BASE}/g/${T.g}/m/${m}`, { waitUntil: "networkidle" }); };
  const t1 = await mkMatch(T.g, "external", 3, [2, 1], [[p.a, "A", 1, 1, 0], [p.b, "A", 1, 0, 0], [p.c, "A", 0, 0, 4]]);
  await seedVotes(t1, [p.a, p.b, p.c], [p.a, p.b, p.c], (t) => (t === p.a ? 9 : t === p.b ? 7 : 4), p.a);
  await close(t1);
  const t2 = await mkMatch(T.g, "external", 1, [4, 0], [[p.a, "A", 1, 0, 0], [p.b, "A", 3, 0, 0], [p.c, "A", 0, 2, 0], [p.d, "A", 0, 0, 5]]);
  await seedVotes(t2, [p.a, p.b, p.c, p.d], [p.a, p.b, p.c, p.d], (t) => (t === p.b ? 10 : t === p.a ? 4 : 7), p.b);
  await close(t2);
  check("iki takım maçı da kapandı", must(await admin.from("matches").select("status").in("id", [t1, t2])).every((m) => m.status === "closed"));
  const tres = A.locator('section[aria-label="Maç sonuçları"]').first();
  check("takımda sekmeler: Bu maç / Puan tablosu", (await tres.locator('[role="tab"]').count()) === 2);
  check("tek takımlı rakip maçı özeti: rakip adı", (await text(summary)).includes("yıldızspor"));
  await shot(A, "v4-sonuc-takim");
  await tres.locator('[role="tab"]', { hasText: "Puan tablosu" }).click();
  const table = tres.locator("ol > li:visible");
  check("tabloda 4 oyuncu", (await table.count()) === 4);
  const rows = (await table.allInnerTexts()).map((t) => t.split(/\s*\n\s*|\t/).filter(Boolean));
  console.log("    tablo:", rows.map((r) => r.join(" ")).join(" | "));
  const of = (n) => rows.find((r) => r.includes(n));
  const tail = (n) => of(n)?.slice(of(n).indexOf(n) + 1) ?? [];
  // M G G/M A K MVP RTG
  check("Barış: 2 maç, 4 gol, maç başı 2", tail("Barış Bek").slice(0, 3).join(",") === "2,4,2");
  check("Cem: 2 asist, 4 kurtarış", tail("Cem Orta")[3] === "2" && tail("Cem Orta")[4] === "4");
  check("Deniz ilk maçında YENİ", of("Deniz Kaleci")?.includes("YENİ"));
  check("sıra rating'e göre azalan", rows.map((r) => Number(r.at(-1))).every((v, i, arr) => i === 0 || arr[i - 1] >= v));
  check("yükselen/düşen oku var", rows.some((r) => r.some((x) => /^[▲▼]\d/.test(x))));
  check("puan tablosunda yatay taşma yok", await noOverflow(A));
  check("seçili sekme Puan tablosu", (await tres.locator('[role="tab"][aria-selected="true"]').innerText()) === "Puan tablosu");
  await A.mouse.move(0, 0); await A.waitForTimeout(600);
  await shot(A, "v5-puan-tablosu");

  console.log("7) Takım istatistikleri sayfası");
  await A.goto(`${BASE}/g/${T.g}/istatistik`, { waitUntil: "networkidle" });
  const st = A.locator('section[aria-label="Puan tablosu"]');
  check("istatistikte puan tablosu, 4 oyuncu", (await st.locator("ol > li").count()) === 4);
  const body = await text(A.locator("main"));
  check("eski Liderler listeleri yok", !body.includes("liderler") && !body.includes("gol krallığı"));
  check("karne ve rakipler duruyor", body.includes("galibiyet %") && body.includes("yıldızspor"));
  check("istatistikte yatay taşma yok", await noOverflow(A));
  await shot(A, "v6-istatistik");
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e?.message ?? e);
  failed++;
} finally {
  await browser?.close();
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failed ? 1 : 0);
}

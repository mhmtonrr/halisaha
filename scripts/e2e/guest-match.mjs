// Misafir oyuncu sadece maç ekranından eklenir: maç kadrosuna girer, "Oyuncular" sayfasında ekleme formu yoktur.
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
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const users = []; let gid, browser;
try {
  for (const [i, n] of ["Kaan Kaptan", "Mert Oyuncu"].entries()) {
    const email = `e2e-guest-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", onboarded_at: new Date().toISOString(), preferred_position: "MID" }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password });
  }
  const { data: g } = await admin.from("groups").insert({ name: "E2E Misafir Takımı", kind: "team", city: "İstanbul", created_by: users[0].id }).select("id").single();
  gid = g.id;
  await admin.from("group_players").insert({ group_id: gid, user_id: users[1].id, display_name: "Mert Oyuncu", position: "DEF" });
  const { data: m } = await admin.from("matches").insert({ group_id: gid, played_at: new Date(Date.now() + 86400000).toISOString(), created_by: users[0].id, kind: "external", opponent_name: "Rakip FK", team_size: 7 }).select("id").single();
  const { data: gps } = await admin.from("group_players").select("id").eq("group_id", gid);
  await admin.from("match_players").insert(gps.map((x) => ({ match_id: m.id, player_id: x.id, team: "A" })));

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [cap, member] = [await open(users[0]), await open(users[1])];

  // "Oyuncular" sayfasında artık misafir ekleme formu yok
  await cap.goto(`${BASE}/g/${gid}/players`);
  check("Oyuncular sayfasında 'Misafir oyuncu ekle' yok", (await cap.locator("text=Misafir oyuncu ekle").count()) === 0);

  // Maç ekranında kaptan misafir ekler
  await cap.goto(`${BASE}/g/${gid}/m/${m.id}`);
  await cap.click('button:text-is("Misafir")');
  check("maç ekranında misafir ekleme formu var", (await cap.locator('input[name="name"]').count()) === 1);
  await cap.fill('input[name="name"]', "Zeki Misafir");
  await cap.selectOption('select[name="position"]', "GK");
  // Sayfa zıplamasın: gönderimden önce kaydırma konumunu al, sonra aynı yerde kalmalı
  // Düğmeyi görünür yap (tıklama otomatik kaydırma yapmasın), ölçüm o konumdan başlar
  await cap.locator('button:has-text("Misafiri ekle")').scrollIntoViewIfNeeded();
  const y0 = await cap.evaluate(() => window.scrollY);
  await cap.evaluate(() => { window.__same = 1; });
  await cap.click('button:has-text("Misafiri ekle")');
  await cap.locator("text=Zeki Misafir kadroya eklendi").waitFor({ timeout: 10000 });
  check("onay mesajı yerinde göründü", true);
  const y1 = await cap.evaluate(() => window.scrollY);
  // Kadro kartı büyüyünce tarayıcı konumu birkaç yüz piksel içinde kaydırabilir; başa (0) atmamalı
  check(`sayfa başa atmadı (kaydırma ${y0} → ${y1})`, y0 > 100 && y1 >= y0 - 10 && y1 < y0 + 200);
  check("sayfa yenilenmedi, adres değişmedi", (await cap.evaluate(() => window.__same === 1)) && !cap.url().includes("misafir="));
  check("form temizlendi, açık kaldı", (await cap.locator('input[name="name"]').inputValue()) === "");
  const { data: guest } = await admin.from("group_players").select("id, user_id, position").eq("group_id", gid).eq("display_name", "Zeki Misafir").maybeSingle();
  check("misafir grupta hesapsız oyuncu olarak var", !!guest && guest.user_id === null && guest.position === "GK");
  const { data: mp } = await admin.from("match_players").select("team, position, is_goalkeeper").eq("match_id", m.id).eq("player_id", guest.id).maybeSingle();
  check("misafir bu maçın kadrosunda, kaleci", !!mp && mp.team === "A" && mp.position === "GK" && mp.is_goalkeeper);
  check("maç ekranında misafir kadroda görünüyor (yerinde güncellendi)", (await cap.locator("text=Zeki M.").count()) > 0);
  await cap.screenshot({ path: `${SHOTS}/50-misafir-maca-eklendi.png`, fullPage: true });

  // Misafir "Oyuncular" sayfasında kayıtlı kalır (geçmiş aktarımı için) ama oradan eklenmez
  await cap.goto(`${BASE}/g/${gid}/players`);
  check("misafir Oyuncular listesinde 'Misafir' rozetiyle durur", (await cap.locator("text=Zeki Misafir").count()) > 0 && (await cap.locator("text=Misafir").count()) > 0);
  check("Oyuncular sayfasında yine ekleme formu yok", (await cap.locator('form:has(input[name="name"]):has-text("Ekle")').count()) === 0);

  // Misafir asıl kadroda görünmez; "Misafirler" sekmesinde durur
  await cap.goto(`${BASE}/g/${gid}`);
  check("takım başlığında oyuncu sayısı sadece gerçek üyeler (2, misafir hariç)", (await cap.locator("text=İstanbul · 2 oyuncu").count()) > 0);
  check("kadro sıralamasında misafir yok", (await cap.locator("text=Zeki Misafir").count()) === 0);
  check("'Misafirler · 1' sekmesi var", (await cap.locator('[role="tab"]:has-text("Misafirler · 1")').count()) === 1);
  await cap.click('[role="tab"]:has-text("Misafirler · 1")');
  await cap.waitForURL(/sekme=misafir/);
  check("misafir sekmesinde misafir ve istatistiği görünür", (await cap.locator("text=Zeki Misafir").count()) > 0 && (await cap.locator("text=Kadro sıralaması").count()) === 0);
  await cap.screenshot({ path: `${SHOTS}/51-misafir-sekmesi.png`, fullPage: true });
  await cap.goto(`${BASE}/g/${gid}/kadro`);
  check("kadro sayfasında misafir kartı yok", (await cap.locator("text=Zeki").count()) === 0 && (await cap.locator('[role="tab"]:has-text("Misafirler")').count()) === 1);
  await cap.goto(`${BASE}/g/${gid}/kadro?sekme=misafir`);
  check("kadro misafir sekmesinde misafir kartı var", (await cap.locator("text=Zeki").count()) > 0);
  await cap.goto(`${BASE}/g/${gid}/players`);
  check("Oyuncular sayfasında üye listesi ile misafir bölümü ayrı", (await cap.locator("text=Misafirler · 1").count()) > 0);

  // Kısa isim ve normal oyuncu
  await cap.goto(`${BASE}/g/${gid}/m/${m.id}`);
  await cap.click('button:text-is("Misafir")');
  await cap.fill('input[name="name"]', "A");
  await cap.click('button:has-text("Misafiri ekle")');
  check("1 harfli isim reddedilir (tarayıcı doğrulaması: form gönderilmedi)", (await admin.from("group_players").select("id", { count: "exact", head: true }).eq("group_id", gid).is("user_id", null)).count === 1);
  await member.goto(`${BASE}/g/${gid}/m/${m.id}`);
  check("normal oyuncu misafir formunu görmez", (await member.locator('button:text-is("Misafir")').count()) === 0);

  // Doğrudan istek: yetkisiz oyuncu RLS'e takılır, misafir yetim kalmaz
  const before = (await admin.from("group_players").select("id", { count: "exact", head: true }).eq("group_id", gid)).count;
  const { error: rlsErr } = await (async () => {
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: users[1].email, password: users[1].password });
    return c.from("group_players").insert({ group_id: gid, display_name: "Sızma Denemesi" });
  })();
  const after = (await admin.from("group_players").select("id", { count: "exact", head: true }).eq("group_id", gid)).count;
  check("normal oyuncu doğrudan misafir ekleyemez (RLS)", !!rlsErr && before === after);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (gid) await admin.from("groups").delete().eq("id", gid);
  await removeTestUsers(admin, users.map((u) => u.id));
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

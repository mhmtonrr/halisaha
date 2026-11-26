// Takımlar arası maç teklifi: teklif → kabul → kadro → skor eşleşmesi → oylama → sonuç → istatistik.
// Canlı Supabase'e karşı çalışır; test kullanıcıları ve takımlarını sonunda siler.
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
const log = (...a) => console.log("•", ...a);
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };

const names = ["Ali Kaptan", "Ayşe Oyuncu", "Berk Kaptan", "Buse Oyuncu", "Can Yabancı"];
const users = []; const groupIds = [];
let browser;
try {
  for (const [i, n] of names.entries()) {
    const email = `e2e-challenge-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", district: "Kadıköy", preferred_position: i % 2 ? "DEF" : "MID", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  // Takımları servis anahtarıyla kur (kurucu tetikleyiciyle kaptan olur), oyuncuları ekle
  const mkTeam = async (name, color, captain, member) => {
    const { data: t, error } = await admin.from("groups").insert({ name, kind: "team", city: "İstanbul", district: "Kadıköy", color, created_by: captain.id }).select("id").single();
    if (error) throw error;
    groupIds.push(t.id);
    await admin.from("group_players").insert({ group_id: t.id, user_id: member.id, display_name: member.name, position: "DEF" });
    return t.id;
  };
  const teamA = await mkTeam("E2E Kartallar", "#e11d48", users[0], users[1]);
  const teamB = await mkTeam("E2E Aslanlar", "#0ea5e9", users[2], users[3]);
  log("iki takım kuruldu:", teamA.slice(0, 8), teamB.slice(0, 8));
  // Ayşe ayrıca bir toplulukta da: rating'i tüm gruplarında aynı olmalı
  const { data: comm } = await admin.from("groups").insert({ name: "E2E Mahalle", kind: "community", created_by: users[0].id }).select("id").single();
  groupIds.push(comm.id);
  await admin.from("group_players").insert({ group_id: comm.id, user_id: users[1].id, display_name: users[1].name });

  browser = await chromium.launch();
  const open = async (u, scale = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale });
    const page = await ctx.newPage(); page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const [A1, A2, B1, B2, X] = [await open(users[0], 2), await open(users[1]), await open(users[2], 2), await open(users[3]), await open(users[4])];

  // 1) Yabancı: takım sayfasında "Maç teklif et" görür ama gönderemez (takımı yok)
  await X.goto(`${BASE}/g/${teamB}`);
  check("takımı olmayan ziyaretçi 'Maç teklif et' görür", (await X.locator("text=Maç teklif et").count()) > 0);
  await X.goto(`${BASE}/g/${teamB}/teklif`);
  check("takımı olmayan için form yerine 'takım kur' çağrısı", (await X.locator("text=Takım kur").count()) > 0 && (await X.locator('button:has-text("Teklifi gönder")').count()) === 0);
  await X.goto(`${BASE}/g/${teamB}/teklifler`); await X.waitForURL(new RegExp(`/g/${teamB}$`));
  check("üye olmayan teklif kutusuna giremez", true);

  // 2) Kartal kaptanı teklif gönderir
  await A1.goto(`${BASE}/g/${teamB}/teklif`); await shot(A1, "30-teklif-formu");
  await A1.selectOption('select[name="size"]', "5");
  await A1.fill('input[name="venue"]', "Petroller Halısaha"); await A1.fill('input[name="fee"]', "Saha yarı yarıya");
  await A1.fill('textarea[name="message"]', "Cuma akşamı 7'ye 7 yapalım mı?");
  await A1.click('button:has-text("Teklifi gönder")'); await A1.waitForURL(/teklifler\?sent=1/);
  check("teklif gönderildi, onay mesajı var", (await A1.locator("text=Teklif gönderildi").count()) > 0);
  check("gönderilen listede 'Yanıt bekliyor'", (await A1.locator("text=Yanıt bekliyor").count()) > 0);
  await shot(A1, "31-gonderilen");
  // aynı takıma 4. teklif
  const { data: ch } = await admin.from("match_challenges").select("id, status").eq("from_group_id", teamA);
  check("tek teklif kaydı, pending", ch.length === 1 && ch[0].status === "pending");

  // 3) Aslan oyuncusu teklifi görür ama yanıtlayamaz; kaptan ana sayfada kart görür
  await B2.goto(`${BASE}/g/${teamB}/teklifler`);
  check("oyuncu gelen teklifi görür", (await B2.locator("text=E2E Kartallar").count()) > 0);
  check("oyuncuda Kabul/Reddet düğmesi yok", (await B2.locator('button:has-text("Kabul et")').count()) === 0);
  await B1.goto(BASE + "/");
  check("kaptanın ana sayfasında teklif kartı", (await B1.locator("text=maç teklifi yanıtını bekliyor").count()) > 0);
  await shot(B1, "32-anasayfa-teklif");
  await B1.goto(`${BASE}/g/${teamB}`);
  check("takım sayfasında 'yeni' rozeti", (await B1.locator("text=1 yeni").count()) > 0);

  // 4) Kabul
  await B1.goto(`${BASE}/g/${teamB}/teklifler`); await shot(B1, "33-gelen-teklif");
  await B1.click('button:has-text("Kabul et")'); await B1.waitForURL(/\/m\/[0-9a-f-]+\?kabul=1/);
  const mB = B1.url().match(/\/m\/([0-9a-f-]+)/)[1];
  check("kabulde maç ekranına yönlendi, kadro uyarısı", (await B1.locator("text=Şimdi kadronu belirle").count()) > 0);
  const { data: ms } = await admin.from("matches").select("id, group_id, kind, status, opponent_name, opponent_group_id, challenge_id, team_size").eq("challenge_id", ch[0].id);
  check("kişi sayısı (5) iki maça da yazıldı", ms.length === 2 && ms.every((m) => m.team_size === 5));
  check("iki takımda da external maç oluştu", ms.length === 2 && ms.every((m) => m.kind === "external" && m.status === "planned"));
  const mA = ms.find((m) => m.group_id === teamA).id;
  await shot(B1, "34-mac-bos-kadro");
  await B1.goto(`${BASE}/`);
  check("ana sayfada yaklaşan maç kartı (rakibe karşı, kadro 0/5)", (await B1.locator("body").innerText()).includes("0/5"));
  await shot(B1, "34b-ana-sayfa-yaklasan");

  // 5) Kadrolar (her takım kendininkini "Kadro dışı" listesinden alır)
  for (const [page, gid, mid] of [[B1, teamB, mB], [A1, teamA, mA]]) {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`, { waitUntil: "networkidle" });
    const add = page.locator('button:text-is("Kadroya ekle")');
    for (let left = await add.count(); left > 0; left--) {
      await add.first().click();
      await page.waitForFunction((n) => [...document.querySelectorAll("button")].filter((b) => b.textContent === "Kadroya ekle").length < n, left, { timeout: 20000 });
      // Satır iyimser güncellemeyle hemen kaybolur; sunucu kaydı bitene kadar bekle
      await page.locator('section[aria-busy="true"]').waitFor({ state: "detached", timeout: 20000 });
      await page.waitForLoadState("networkidle");
    }
  }
  const { data: rosters } = await admin.from("match_players").select("match_id").in("match_id", [mA, mB]);
  check("her maçta 2 oyuncu", rosters.filter((r) => r.match_id === mA).length === 2 && rosters.filter((r) => r.match_id === mB).length === 2);

  const gp = async (uid, gid) => (await admin.from("group_players").select("id").eq("user_id", uid).eq("group_id", gid).single()).data.id;
  // 5b) Diziliş sahnesi: A1 fareyle sürükle-bırak, B1 dokunarak (seç + yerleştir)
  const openStage = async (page, gid, mid) => {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`, { waitUntil: "networkidle" });
    return page.locator("#dizilis");
  };
  const lineupJson = async (page) => JSON.parse(await page.locator('#dizilis input[name="lineup"]').inputValue());
  const box = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const [idAli, idAyse, idBerk] = [await gp(users[0].id, teamA), await gp(users[1].id, teamA), await gp(users[2].id, teamB)];
  const radios = '[role="radiogroup"][aria-label="Diziliş seç"] [role="radio"]';
  const slot = (page, n) => page.locator(`#dizilis [data-drop="slot:${n}"]`);
  const saveLineup = async (page) => { await page.locator('#dizilis button:text-is("Kaydet")').click(); await page.waitForURL(/dizilis=1/); await page.waitForLoadState("networkidle"); };

  let stage = await openStage(A1, teamA, mA);
  check("sahnede 5 kişilik dizilişler (2-2, 1-2-1…)", (await stage.locator(radios).count()) === 4 && (await stage.locator(`${radios}:has-text("2-2")`).count()) === 1);
  await stage.locator(`${radios}:has-text("1-2-1")`).click();
  let lu = await lineupJson(A1);
  check("diziliş seçilince otomatik yerleşti (ikisi de sahada)", Object.values(lu).filter((v) => v !== null).length === 2);
  await shot(A1, "40a-dizilis-sahnesi");
  // Saha ekranda tam görünsün (fare koordinatları görünür alanda kalmalı); yerleşme animasyonu bitsin
  const center = async (page) => { await slot(page, 2).first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(900); };
  await center(A1);
  // Ali'nin kartını boş forvet yerine (slot 4) sürükle
  const token = (name) => A1.locator(`#dizilis [aria-label="${name} kartı"]`);
  const drag = async (name, to) => {
    const from = await box(token(name)), t = await box(slot(A1, to).first());
    await A1.mouse.move(from.x, from.y); await A1.mouse.down();
    await A1.mouse.move(from.x + 15, from.y - 15, { steps: 4 }); await A1.mouse.move(t.x, t.y, { steps: 10 }); await A1.mouse.up();
    await A1.waitForTimeout(700);
  };
  await drag("Ali Kaptan", 4);
  lu = await lineupJson(A1);
  check("sürükle-bırak: Ali forvet yerine (4) geçti", lu[idAli] === 4);
  // Ayşe'yi Ali'nin üzerine bırak → yer değiştirirler (takas)
  await drag("Ayşe Oyuncu", 4);
  lu = await lineupJson(A1);
  check("dolu yere bırakınca takas: Ayşe 4'e, Ali Ayşe'nin eski yerine", lu[idAyse] === 4 && lu[idAli] !== null && lu[idAli] !== 4);
  await saveLineup(A1);
  const { data: lA } = await admin.from("match_players").select("player_id, slot, position, is_goalkeeper").eq("match_id", mA);
  const { data: mrow } = await admin.from("matches").select("formation_a").eq("id", mA).single();
  check("kayıt: formasyon 1-2-1, iki oyuncunun yeri yazıldı", mrow.formation_a === "1-2-1" && lA.every((r) => r.slot !== null) && lA.find((r) => r.player_id === idAyse).slot === 4);
  check("sahaya dizilen oyuncunun mevkisi yerin rolü oldu (slot 4 = FWD)", lA.find((r) => r.player_id === idAyse).position === "FWD");
  check("kaleye dizilen oyuncu kaleci işaretlendi", lA.filter((r) => r.slot === 0).every((r) => r.is_goalkeeper && r.position === "GK"));

  stage = await openStage(B1, teamB, mB);
  await stage.locator(`${radios}:has-text("2-2")`).click();
  await center(B1);
  // dokunarak: kartı seç, sonra boş yere dokun
  await stage.locator('[aria-label="Berk Kaptan kartı"]').click();
  await slot(B1, 3).first().click();
  lu = await lineupJson(B1);
  check("dokunarak yerleştirme: Berk 3. yere geçti", lu[idBerk] === 3);
  await saveLineup(B1);
  const { data: mB2 } = await admin.from("matches").select("formation_a").eq("id", mB).single();
  check("B takımı diziliş kaydetti (2-2)", mB2.formation_a === "2-2");

  // Normal oyuncu düzenleyemez, herkes iki sahayı görür
  const bothSides = async (page, gid, mid, first, firstF, second, secondF) => {
    const s = await openStage(page, gid, mid);
    await s.locator(`[role="tab"]:has-text("${first}")`).click();
    const a = (await s.innerText()).includes(firstF);
    await s.locator(`[role="tab"]:has-text("${second}")`).click();
    return a && (await s.innerText()).includes(secondF);
  };
  check("oyuncu iki takımın dizilişini görür", await bothSides(A2, teamA, mA, "E2E Kartallar", "1-2-1", "E2E Aslanlar", "2-2"));
  check("rakip sahada rakip oyuncuların kartları", (await A2.locator('#dizilis [aria-label="Buse Oyuncu kartı"]').count()) === 1);
  check("oyuncuda diziliş düzenleme yok", (await A2.locator(radios).count()) === 0 && (await A2.locator('#dizilis input[name="lineup"]').count()) === 0);
  check("yabancı da dizilişleri görür (takımlar herkese açık)", await bothSides(X, teamB, mB, "E2E Aslanlar", "2-2", "E2E Kartallar", "1-2-1"));
  await shot(X, "40b-dizilisler-gorunum");

  // 6) Ortak ekran
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("planlanmış maçta sonuç formunda 'gelmedi' kutusu var", (await A1.locator('input[name="noshow"]').count()) > 0);
  await shot(A1, "35-ortak-mac-planli");
  await A2.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("oyuncuda skor formu yok", (await A2.locator('button:has-text("Skoru kaydet")').count()) === 0);

  // 6b) Geri oku geldiği sayfaya döner (sabit üst sayfaya değil)
  await A1.goto(BASE + "/"); await A1.goto(`${BASE}/g/${teamA}/teklifler`); await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  await A1.click('a[aria-label="Geri"]'); await A1.waitForURL(`${BASE}/g/${teamA}/teklifler`);
  check("geri oku maç ekranından teklifler sayfasına döndü (geldiği yer)", true);
  await A1.click('a[aria-label="Geri"]'); await A1.waitForURL(BASE + "/");
  check("bir sonraki geri ana sayfaya döndü", true);

  // 7) Skor: uyuşmazlık → düzeltme → eşleşme
  const submitScore = async (page, gid, mid, a, b, goals) => {
    await page.goto(`${BASE}/g/${gid}/m/${mid}`);
    const form = page.locator('form:has(input[name="scoreA"])').first();
    if (!(await form.locator('input[name="scoreA"]').isVisible())) await page.locator("summary:has-text('Skoru ve istatistikleri')").click();
    await page.fill('input[name="scoreA"]', String(a)); await page.fill('input[name="scoreB"]', String(b));
    for (const [pid, n] of goals ?? []) await page.fill(`input[name="goals_${pid}"]`, String(n));
    await page.locator('button:has-text("Skoru kaydet")').click(); await page.waitForURL(/skor=/);
    return new URL(page.url()).searchParams.get("skor");
  };
  check("ilk skor: rakip bekleniyor", (await submitScore(A1, teamA, mA, 4, 2, [[idAli, 3], [idAyse, 1]])) === "waiting");
  check("bekleme bilgisi görünüyor", (await A1.locator("text=Rakibin skor girmesi bekleniyor").count()) > 0);
  check("skor düzeltme ekranında 'gelmedi' kutusu yok (sadece planlanmış maçta)", (await A1.locator('input[name="noshow"]').count()) === 0);
  await shot(A1, "36-skor-bekleniyor");
  check("uyuşmayan skor: mismatch", (await submitScore(B1, teamB, mB, 2, 3)) === "mismatch");
  check("uyuşmazlık metni iki skoru gösterir", (await B1.locator("text=Skorlar uyuşmuyor").count()) > 0);
  await shot(B1, "37-skor-uyusmuyor");
  const { data: mid1 } = await admin.from("matches").select("status").in("id", [mA, mB]);
  check("uyuşmazken oylama açılmadı", mid1.every((m) => m.status === "played"));
  check("düzeltilmiş skor: settled", (await submitScore(B1, teamB, mB, 2, 4, [[idBerk, 2]])) === "settled");
  const { data: mid2 } = await admin.from("matches").select("status, voting_deadline").in("id", [mA, mB]);
  check("iki maç da oylamada, süre var", mid2.every((m) => m.status === "voting" && m.voting_deadline));

  // 8) Çapraz oylama: sahadaki herkes kendi dışındaki herkese oy verir (iki takım tek havuz)
  const [a1, a2, b1, b2] = [await gp(users[0].id, teamA), await gp(users[1].id, teamA), await gp(users[2].id, teamB), await gp(users[3].id, teamB)];
  const vote = (m, v, t, s) => ({ match_id: m, voter_id: v, target_id: t, score: s });
  // a2 arayüzden oy verir, diğer üçü servis anahtarıyla
  await admin.from("votes").insert([
    vote(mA, a1, a2, 8), vote(mA, a1, b1, 6), vote(mA, a1, b2, 7),
    vote(mB, b1, b2, 6), vote(mB, b1, a1, 8), vote(mB, b1, a2, 5),
    vote(mB, b2, b1, 9), vote(mB, b2, a1, 6), vote(mB, b2, a2, 7),
  ]);
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("bağlı maçta elle 'oylamayı kapat' düğmesi yok", (await A1.locator('button:has-text("Oylamayı şimdi kapat")').count()) === 0);
  check("oy oranı açıklaması görünür (%60 / %40)", (await A1.locator("text=%60").count()) > 0 && (await A1.locator("text=%40").count()) > 0);
  await A2.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("oy formunda rakip takım oyuncuları da var", (await A2.locator("text=Rakip takım · E2E Aslanlar").count()) > 0 && (await A2.locator("[data-vote-row]").count()) === 3);
  const summary = A2.locator('section[aria-label="Maç özeti"]');
  const sum = (await summary.innerText()).toLocaleLowerCase("tr");
  check("maç özetinde iki takımın golleri", ["ali kaptan", "3 gol", "ayşe oyuncu", "1 gol", "berk kaptan", "2 gol", "e2e kartallar", "e2e aslanlar"].every((x) => sum.includes(x)));
  check("oylamada karşılaşma kartı yok (isimler maç özetinde)", (await A2.getByText("Buse O.", { exact: true }).count()) === 0 && (await A2.getByText("VS", { exact: true }).count()) === 0);
  await A2.waitForLoadState("networkidle");
  const send = A2.locator('button:has-text("Oylarımı gönder")');
  check("iki sekme, eksikken gönder kapalı", (await A2.locator('[aria-label="Oylama"] [role="tab"]').count()) === 2 && (await send.isDisabled()));
  await shot(A2, "36b-capraz-oy-formu");
  for (const tab of await A2.locator('[aria-label="Oylama"] [role="tab"]').all()) {
    await tab.click();
    for (const row of await A2.locator("[data-vote-row]:visible").all()) await row.locator('[role="radio"]').nth(6).click();
  }
  await A2.click('button:has-text("Oylarımı gönder")'); await A2.waitForURL(/voted=1/);
  const { data: a2votes } = await admin.from("votes").select("target_id").eq("voter_id", a2).eq("match_id", mA);
  check("a2'nin 3 oyu (takım arkadaşı + 2 rakip) kendi maçına yazıldı", a2votes.length === 3 && a2votes.some((v) => v.target_id === b1) && a2votes.some((v) => v.target_id === b2));
  // Herkes oy verdi → iki maç birlikte kapanır
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  const { data: closed } = await admin.from("matches").select("status").in("id", [mA, mB]);
  check("herkes oy verince iki maç birlikte kapandı", closed.every((m) => m.status === "closed"));
  const { data: res } = await admin.from("match_results").select("match_id, is_mvp").in("match_id", [mA, mB]);
  check("iki takımın oyuncuları puanlandı (4 sonuç)", res.length === 4 && res.filter((r) => r.match_id === mA).length === 2);
  check("tek maçın adamı (iki takım arasından)", res.filter((r) => r.is_mvp).length <= 1);

  // 9) Sonuç: iki takımın puanları, rakip puanlar kendi kartlarını etkilemez
  await A1.goto(`${BASE}/g/${teamA}/m/${mA}`);
  check("sonuç ekranında rakip takımın oyuncu puanları", (await A1.locator("text=Rakip takım sonuçları · E2E Aslanlar").count()) > 0 && (await A1.locator("text=Berk Kaptan").count()) > 0);
  const results = A1.locator('section[aria-label="Maç sonuçları"]');
  check("iki takımın sonuç bölümü, ikisinde de puan tablosu sekmesi", (await results.count()) === 2 && (await results.locator('[role="tab"]:has-text("Puan tablosu")').count()) === 2);
  check("kendi sonuçlarımda 'Senin sonucun', rakipte yok", (await results.nth(0).innerText()).toLocaleLowerCase("tr").includes("senin sonucun") && !(await results.nth(1).innerText()).toLocaleLowerCase("tr").includes("senin sonucun"));
  for (const [i, own, other] of [[0, "Ayşe Oyuncu", "Buse Oyuncu"], [1, "Buse Oyuncu", "Ayşe Oyuncu"]]) {
    await results.nth(i).locator('[role="tab"]:has-text("Puan tablosu")').click();
    const t = await results.nth(i).locator("ol:visible").innerText();
    check(`puan tablosu ${i + 1}: sadece kendi kadrosu`, t.includes(own) && !t.includes(other) && (await results.nth(i).locator("ol > li:visible").count()) === 2);
  }
  check("sonuç ekranında yatay taşma yok", await A1.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(A1, "38-ortak-mac-sonuc");
  const { data: ratedA } = await admin.from("user_ratings").select("user_id").in("user_id", users.slice(0, 4).map((u) => u.id));
  check("4 oyuncunun da rating'i yazıldı", ratedA.length === 4);
  const { data: mine } = await admin.from("user_ratings").select("overall, matches_played").eq("user_id", users[1].id);
  check("oyuncunun tek genel rating satırı var (grup başına kopya yok)", mine.length === 1 && mine[0].matches_played === 1);

  // 10) İstatistik: Kartallar 4-2 kazandı
  await X.goto(`${BASE}/g/${teamA}/istatistik`);
  check("istatistik herkese açık: 1 maç, 1 galibiyet", (await X.locator("text=Takım istatistikleri").count()) > 0 && (await X.locator("text=Galibiyet %").count()) > 0 && (await X.locator("text=%100").count()) > 0);
  check("rakipler listesinde Aslanlar", (await X.locator("text=E2E Aslanlar").count()) > 0);
  await shot(X, "39-istatistik-kartallar");
  await X.goto(`${BASE}/g/${teamB}/istatistik`);
  check("Aslanlar: 1 mağlubiyet, rakip Kartallar", (await X.locator("text=E2E Kartallar").count()) > 0 && (await X.locator("text=%0").count()) > 0);
  await shot(X, "40-istatistik-aslanlar");

  // 11) Kapanmış maç iptal edilemez
  const { error: cancelErr } = await admin.rpc("cancel_challenge", { p_challenge_id: ch[0].id });
  log("(servis anahtarıyla iptal, yetki kontrolü auth.uid yok → bekleneni:)", cancelErr?.message ?? "hata yok");
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (groupIds.length) await admin.from("groups").delete().in("id", groupIds);
  await removeTestUsers(admin, users.map((u) => u.id));
  const { count } = await admin.from("groups").select("id", { count: "exact", head: true }).in("id", groupIds);
  log(`temizlik: ${users.length} kullanıcı, ${groupIds.length} takım silindi (kalan takım: ${count})`);
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

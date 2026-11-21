// Üye çağrısı: üye çağrı açar → kontenjan dolunca maç hemen kurulur; süre bitince %70 varsa eksik kadroyla kurulur,
// yoksa iptal olur. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
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

const users = []; let gid, browser;
try {
  for (const [i, n] of ["Kaan Kurucu", "Mert Üye", "Can Üye"].entries()) {
    const email = `e2e-mpoll-${Date.now()}-${i}@example.com`, password = "Sifre-" + Math.random().toString(36).slice(2, 8) + "9";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "İstanbul", onboarded_at: new Date().toISOString(), preferred_position: i === 1 ? "GK" : "MID" }).eq("id", data.user.id);
    users.push({ id: data.user.id, email, password, name: n });
  }
  gid = (await admin.from("groups").insert({ name: "E2E Çağrı Grubu", created_by: users[0].id }).select("id").single()).data.id;
  await admin.from("group_players").insert([1, 2].map((i) => ({ group_id: gid, user_id: users[i].id, display_name: users[i].name })));
  const gpOf = async (u) => (await admin.from("group_players").select("id").eq("group_id", gid).eq("user_id", u.id).single()).data.id;
  const mkGuests = async (n, prefix) => (await admin.from("group_players").insert(Array.from({ length: n }, (_, i) => ({ group_id: gid, display_name: `${prefix}${i + 1}`, position: i % 4 === 0 ? "DEF" : "MID" }))).select("id")).data.map((g) => g.id);
  const respond = (pollId, playerIds, t0 = Date.now()) =>
    admin.from("poll_responses").insert(playerIds.map((id, i) => ({ poll_id: pollId, player_id: id, answer: "yes", responded_at: new Date(t0 + i * 1000).toISOString() })));

  browser = await chromium.launch();
  const open = async (u) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("pageerror", (e) => console.log("  [sayfa hatası]", e.message));
    await page.goto(BASE + "/login"); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
    await page.click('form button:has-text("Giriş yap")'); await page.waitForURL(BASE + "/");
    return page;
  };
  const [admP, memP, mem2P] = [await open(users[0]), await open(users[1]), await open(users[2])];

  // 1) Üye grup sayfasında çağrı açabilir; maç kuramaz
  await memP.goto(`${BASE}/g/${gid}`);
  check("üye 'Maç çağrısı aç' düğmesini görür", (await memP.locator("text=Maç çağrısı aç").count()) > 0);
  check("üye 'Maç kur' düğmesini görmez", (await memP.locator("text=Doğrudan maç").count()) === 0);
  await memP.click("text=Maç çağrısı aç"); await memP.waitForURL(/cagri\/yeni/);
  check("üye formunda kişi sayısı ve kurallar var", (await memP.locator('select[name="size"]').count()) === 1 && (await memP.locator("text=Nasıl işler?").count()) > 0);
  await memP.selectOption('select[name="size"]', "5"); // 5v5 → kontenjan 10
  await memP.fill('input[name="venue"]', "Çağrı Sahası");
  await memP.screenshot({ path: `${SHOTS}/70-uye-cagri-formu.png`, fullPage: true });
  await memP.click('button:has-text("Çağrıyı aç")'); await memP.waitForURL(/cagri\/[0-9a-f-]{36}$/);
  const pollUrl = memP.url(); const pollId = pollUrl.split("/").pop();
  const { data: p1 } = await admin.from("match_polls").select("auto_match, team_size, capacity, status, deadline, starts_at").eq("id", pollId).single();
  check("çağrı otomatik, 5v5 → kontenjan 10", p1.auto_match && p1.team_size === 5 && p1.capacity === 10 && p1.status === "open");
  check("çağrıyı açan otomatik 'geliyorum'", (await admin.from("poll_responses").select("answer").eq("poll_id", pollId)).data.length === 1);
  check("sayfada otomatik maç kuralları ve gereken kişi sayısı", (await memP.locator("text=Otomatik maç").count()) > 0 && (await memP.locator("text=daha gerekli").count()) > 0);
  await memP.screenshot({ path: `${SHOTS}/71-uye-cagri-sayfasi.png`, fullPage: true });

  // 2) İkinci açık çağrı reddedilir
  await memP.goto(`${BASE}/g/${gid}/cagri/yeni`);
  await memP.click('button:has-text("Çağrıyı aç")');
  await memP.waitForURL(/error=/);
  await memP.waitForLoadState("networkidle");
  const errText = await memP.locator("main").innerText();
  check("ikinci açık çağrı reddedildi (mesaj gösterilir)", errText.includes("Zaten açık bir çağrın var"));
  if (!errText.includes("Zaten açık")) console.log("    sayfa metni:", errText.slice(0, 200).replace(/\n/g, " | "), "| adres:", memP.url());

  // 3) Yetkili otomatik çağrıda onay düğmesi görmez, iptal edebilir
  await admP.goto(pollUrl);
  check("otomatik çağrıda 'Onayla' düğmeleri yok", (await admP.locator('button:has-text("Onayla")').count()) === 0);
  check("yetkili çağrıyı iptal edebilir (düğme var)", (await admP.locator('button:has-text("Çağrıyı iptal et")').count()) === 1);

  // 4) Kontenjan dolunca maç HEMEN kurulur: 8 misafir + açan + Can'ın yanıtı = 10
  const guests1 = await mkGuests(8, "Dolgu");
  await respond(pollId, guests1);
  await mem2P.goto(pollUrl);
  await mem2P.click('button:has-text("Geliyorum")');
  await mem2P.locator("text=Maça git").waitFor({ timeout: 15000 });
  const { data: p1b } = await admin.from("match_polls").select("status, match_id").eq("id", pollId).single();
  check("kontenjan dolunca çağrı maça dönüştü", p1b.status === "converted" && !!p1b.match_id);
  const { data: m1 } = await admin.from("matches").select("kind, status, team_size, created_by, venue").eq("id", p1b.match_id).single();
  const { data: r1 } = await admin.from("match_players").select("team").eq("match_id", p1b.match_id);
  check("maç kendi aramızda, 5v5, çağrıyı açanın adına, saha aktarıldı", m1.kind === "internal" && m1.team_size === 5 && m1.created_by === users[1].id && m1.venue === "Çağrı Sahası");
  check("10 kişi dengeli bölündü (5-5)", r1.length === 10 && r1.filter((x) => x.team === "A").length === 5);
  await mem2P.screenshot({ path: `${SHOTS}/72-cagri-maca-donustu.png`, fullPage: true });

  // 5) Süre bitince %70: 7/10 → kurulur
  const startsAt = new Date(Date.now() + 2 * 864e5).toISOString();
  const mkAutoPoll = async (yesIds, deadlineOffsetMs) => {
    const { data } = await admin.from("match_polls").insert({ group_id: gid, created_by: users[1].id, starts_at: startsAt, capacity: 10, team_size: 5, auto_match: true, deadline: new Date(Date.now() + deadlineOffsetMs).toISOString() }).select("id").single();
    await respond(data.id, yesIds);
    return data.id;
  };
  const g2 = await mkGuests(7, "Yedek");
  const pollOk = await mkAutoPoll(g2, 60_000); // süre henüz dolmadı
  await admP.goto(`${BASE}/g/${gid}`);
  check("süre dolmadan 7/10 beklemede (maç kurulmadı)", (await admin.from("match_polls").select("status").eq("id", pollOk).single()).data.status === "open");
  await admin.from("match_polls").update({ deadline: new Date(Date.now() - 60_000).toISOString() }).eq("id", pollOk);
  await admP.goto(`${BASE}/g/${gid}`);
  const { data: pOk } = await admin.from("match_polls").select("status, match_id").eq("id", pollOk).single();
  check("süre bitince 7/10 (%70) ile maç kuruldu", pOk.status === "converted" && !!pOk.match_id);
  check("eksik kadro: 7 oyuncu bölündü", (await admin.from("match_players").select("team").eq("match_id", pOk.match_id)).data.length === 7);

  // 6) Süre bitince 6/10 → iptal
  const g3 = await mkGuests(6, "Az");
  const pollNo = await mkAutoPoll(g3, -60_000);
  await admP.goto(`${BASE}/g/${gid}`);
  const { data: pNo } = await admin.from("match_polls").select("status, match_id").eq("id", pollNo).single();
  check("süre bitince 6/10 yetersiz → çağrı iptal, maç yok", pNo.status === "closed" && !pNo.match_id);
  check("iptal sohbete yazıldı", (await admin.from("group_messages").select("id").eq("group_id", gid).eq("poll_id", pollNo).like("body", "%iptal oldu%")).data.length === 1);
  await admP.goto(`${BASE}/g/${gid}/cagri/${pollNo}`);
  check("iptal olan çağrı sayfasında 'maç kurulmadı' notu", (await admP.locator("text=maç kurulmadı").count()) > 0);

  // 7) Çağrıyı açan kendi çağrısını iptal eder
  await memP.goto(`${BASE}/g/${gid}/cagri/yeni`);
  await memP.click('button:has-text("Çağrıyı aç")'); await memP.waitForURL(/cagri\/[0-9a-f-]{36}$/);
  const pollCancel = memP.url().split("/").pop();
  await memP.click('button:has-text("Çağrıyı iptal et")');
  await memP.locator("text=Çağrı kapandı").waitFor({ timeout: 10000 });
  check("açan kişi çağrıyı iptal etti", (await admin.from("match_polls").select("status").eq("id", pollCancel).single()).data.status === "closed");

  // 8) Takımda üye çağrı açamaz
  const tid = (await admin.from("groups").insert({ name: "E2E Çağrı Takımı", kind: "team", city: "İstanbul", created_by: users[0].id }).select("id").single()).data.id;
  await admin.from("group_players").insert({ group_id: tid, user_id: users[1].id, display_name: users[1].name });
  await memP.goto(`${BASE}/g/${tid}`);
  check("takımda üye 'Maç çağrısı aç' görmez", (await memP.locator("text=Maç çağrısı aç").count()) === 0);
  await memP.goto(`${BASE}/g/${tid}/cagri/yeni`);
  check("takımda üye çağrı formuna giremez (geri yönlendirilir)", !memP.url().includes("cagri/yeni"));
  await admin.from("groups").delete().eq("id", tid);
} catch (e) {
  failed++;
  console.log("  ✗ ÇÖKTÜ:", e.message);
} finally {
  await browser?.close();
  if (gid) await admin.from("groups").delete().eq("id", gid);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  console.log("• temizlendi");
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm e2e kontrolleri geçti");
process.exit(failed ? 1 : 0);

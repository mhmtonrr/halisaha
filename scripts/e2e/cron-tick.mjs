// Zamanlanmış işler (/api/cron/tick): yedekten otomatik kadro, saati geçen toplanan maç iptal, skor hatırlatması,
// maç günü bildirimi; anahtarsız çağrı reddedilir, ikinci çağrı aynı hatırlatmayı tekrar göndermez.
// Sunucu .env.local'daki CRON_SECRET ile çalışmalı. Canlı Supabase'e karşı çalışır; test verisini sonunda siler.
import { createRequire } from "module";
import fs from "fs";
import { removeTestUsers } from "./cleanup.mjs";
const PROJ = process.cwd();
const require = createRequire(PROJ + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(PROJ + "/.env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = "http://localhost:3000";
let failed = 0;
const check = (label, cond) => { console.log(cond ? "  ✓" : "  ✗ HATA:", label); if (!cond) failed++; };
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const users = [];
try {
  if (!env.CRON_SECRET) throw new Error(".env.local içinde CRON_SECRET yok");
  for (const [i, n] of ["Cron Kaptan", "Cron Oyuncu", "Cron Yedek"].entries()) {
    const email = `e2e-cron-${Date.now()}-${i}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: "Sifre-" + Math.random().toString(36).slice(2, 8) + "9", email_confirm: true, user_metadata: { full_name: n } });
    if (error) throw error;
    await admin.from("profiles").update({ city: "Kırklareli", onboarded_at: new Date().toISOString() }).eq("id", data.user.id);
    users.push(data.user.id);
  }
  const [A, B, C] = users;
  const T = must(await admin.from("groups").insert({ name: "Cron Takimi", kind: "team", created_by: A, city: "Kırklareli" }).select("id").single()).id;
  const gp = {};
  for (const u of [B, C]) must(await admin.from("group_players").insert({ group_id: T, user_id: u, display_name: u === B ? "Cron Oyuncu" : "Cron Yedek" }));
  for (const r of must(await admin.from("group_players").select("id, user_id").eq("group_id", T))) gp[r.user_id] = r.id;
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const mk = async (fields) => must(await admin.from("matches").insert({ group_id: T, created_by: A, kind: "external", opponent_name: "Rakip", team_size: 5, ...fields }).select("id").single()).id;

  // M1: kesin, 2 saat sonra, kapasite 2; kadroda A, yedekte C → C alınmalı
  const M1 = await mk({ played_at: at(2 * 3600e3), capacity: 2, status: "planned" });
  must(await admin.from("match_players").insert({ match_id: M1, player_id: gp[A], team: "A" }));
  must(await admin.from("match_entries").insert({ match_id: M1, user_id: C, status: "reserve", source: "member", queued_at: new Date().toISOString() }));
  // M2: toplanıyor, saati 5 dk önce geçti, kadroda B → iptal + B'ye bildirim
  const M2 = await mk({ played_at: at(-5 * 60e3), capacity: 5, status: "gathering" });
  must(await admin.from("match_players").insert({ match_id: M2, player_id: gp[B], team: "A" }));
  // M3: kesin, 3 saat önce oynandı, skor yok → kaptana skor hatırlatması
  const M3 = await mk({ played_at: at(-3 * 3600e3), capacity: 5, status: "planned" });
  // M4: 3 gün önce oynanmış, skor girilmemiş kesin maç → sonuçsuz kapanır, yönetene haber
  const M4 = await mk({ played_at: at(-3 * 86400e3), capacity: 5, status: "planned" });

  const tick = (auth) => fetch(BASE + "/api/cron/tick", { method: "POST", headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  check("anahtarsız çağrı reddedilir (401)", (await tick(null)).status === 401);
  check("yanlış anahtar reddedilir (401)", (await tick("yanlis")).status === 401);
  const res = await tick(env.CRON_SECRET);
  const body = await res.json().catch(() => ({}));
  check(`anahtarlı çağrı çalışır (${res.status} ${JSON.stringify(body)})`, res.status === 200);

  const entry = must(await admin.from("match_entries").select("status").eq("match_id", M1).eq("user_id", C).single());
  check("3 saat kala yedek otomatik kadroya alındı", entry.status === "in");
  const tags = async (uid) => (must(await admin.from("notifications").select("tag").eq("user_id", uid)) ?? []).map((n) => n.tag);
  check("yedeğe 'Kadroya alındın' bildirimi", (await tags(C)).includes(`promoted:${M1}`));
  check("saati geçen toplanan maç iptal", must(await admin.from("matches").select("status, cancel_reason").eq("id", M2).single()).status === "cancelled");
  check("iptal kadroya bildirildi", (await tags(B)).includes(`match-cancel:${M2}`));
  check("2 gün skorsuz maç sonuçsuz kapandı", must(await admin.from("matches").select("status").eq("id", M4).single()).status === "no_result");
  check("kaptana 'sonuçsuz kapandı' bildirimi", (await tags(A)).includes(`match-no-result:${M4}`));
  check("kaptana skor hatırlatması", (await tags(A)).includes(`score-reminder:1:${M3}`));
  const istHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const sameDay = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10) === new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  if (istHour >= 10 && sameDay) check("maç günü kadroya 'Bugün maç var'", (await tags(A)).includes(`today:${M1}`));
  else console.log("  - ATLANDI: 'Bugün maç var' (saat 10'dan önce veya maç yarına sarkıyor)");

  await tick(env.CRON_SECRET);
  const again = (await tags(A)).filter((t) => t === `score-reminder:1:${M3}`).length;
  check("ikinci çağrı aynı hatırlatmayı tekrar göndermez", again === 1);
} catch (e) {
  console.log("  ✗ ÇÖKTÜ:", e.message);
  failed++;
} finally {
  await removeTestUsers(admin, users);
}
console.log(failed ? `\n${failed} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
process.exitCode = failed ? 1 : 0;

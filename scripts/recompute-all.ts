// Tüm oyuncuların genel ratingini ve maç sonuçlarını baştan hesaplar (formül değişince / geçişte).
// Kullanım:
//   NODE_USE_ENV_PROXY=1 npx vite-node --config scripts/recompute.vite.config.mjs scripts/recompute-all.ts
// Önce mevcut ratinglerin yedeğini /tmp'ye (veya ilk argümana) yazar, sonra farkları listeler.
import fs from "node:fs";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
Object.assign(process.env, env);

const { createClient } = await import("@supabase/supabase-js");
const { recomputeAll } = await import("@/lib/finalize");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type R = { player_id: string; overall: number; matches_played: number };
const snapshot = async () => {
  const rows: R[] = [];
  // Hesap sahipleri user_ratings'te (anahtar user_id), misafirler player_ratings'te (anahtar group_players.id)
  for (const [table, key] of [["user_ratings", "user_id"], ["player_ratings", "player_id"]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(table).select(`${key}, overall, matches_played`).order(key).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []).map((d: Record<string, number | string>) => ({ player_id: d[key] as string, overall: d.overall as number, matches_played: d.matches_played as number })));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
};

const backup = process.argv[2] ?? "/tmp/ratings-before.json";
const before = await snapshot();
fs.writeFileSync(backup, JSON.stringify(before));
console.log(`yedek: ${before.length} satır → ${backup}`);

await recomputeAll();

const after = new Map((await snapshot()).map((r) => [r.player_id, r]));
let changed = 0;
for (const b of before) {
  const a = after.get(b.player_id);
  if (!a || a.overall !== b.overall || a.matches_played !== b.matches_played) {
    changed++;
    console.log(`  değişti ${b.player_id.slice(0, 8)}: ${b.overall}/${b.matches_played} → ${a?.overall}/${a?.matches_played}`);
  }
}
console.log(`sonra: ${after.size} satır, ${changed} değişiklik`);

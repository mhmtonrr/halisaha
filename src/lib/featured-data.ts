import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchIn } from "@/lib/fetch-in";
import { one } from "@/lib/data";
import { findTeams, type TeamSummary } from "@/lib/teams-data";
import { loadCandidates, loadCandidatesByIds } from "@/lib/players-data";
import { searchCandidates, type PlayerCandidate } from "@/lib/player-search";

/** Ana sayfadaki "öne çıkanlar": herkese aynı gösterilir, bu yüzden bölge başına 5 dakika önbelleğe alınır */

/** Öne çıkması için en az bu kadar puanlı maç (tek maçlık yıldız çıkmasın) */
const FEATURED_MIN_MATCHES = 3;
/** Bölgede bu kadar oyuncu/takım yoksa Türkiye geneli gösterilir */
const MIN_REGIONAL = 3;

export interface MvpEntry {
  player: PlayerCandidate;
  team: { id: string; name: string; color: string | null };
  opponent: string | null;
  playedAt: string;
  score: string;
}
export interface RiserEntry {
  player: PlayerCandidate;
  delta: number;
  matches: number;
}
export interface Featured {
  /** true ise bölgede yeterli kayıt yoktu, Türkiye geneli gösteriliyor */
  playersNational: boolean;
  teamsNational: boolean;
  players: PlayerCandidate[];
  teams: TeamSummary[];
  mvps: MvpEntry[];
  risers: RiserEntry[];
}

const DAY = 864e5;

/** Son 7 günde kapanan, herkese açık TAKIM maçlarının MVP'leri (özel grup maçları sızmasın) */
async function weeklyMvps(admin: SupabaseClient, city: string | null): Promise<MvpEntry[]> {
  type M = {
    played_at: string;
    status: string;
    kind: string | null;
    opponent_name: string | null;
    score_a: number | null;
    score_b: number | null;
    groups: { id: string; name: string; kind: string; color: string | null } | { id: string; name: string; kind: string; color: string | null }[] | null;
  };
  const { data, error } = await admin
    .from("match_results")
    .select("player_id, matches!inner(played_at, status, kind, opponent_name, score_a, score_b, groups!matches_group_id_fkey(id, name, kind, color))")
    .eq("is_mvp", true)
    .gte("matches.played_at", new Date(Date.now() - 7 * DAY).toISOString())
    .limit(300);
  if (error) throw error;
  const rows = (data ?? [])
    .map((r) => ({ playerId: r.player_id as string, m: one(r.matches as M | M[] | null) }))
    .filter((r): r is { playerId: string; m: M } => !!r.m && r.m.status === "closed" && one(r.m.groups)?.kind === "team")
    .sort((a, b) => b.m.played_at.localeCompare(a.m.played_at));
  if (!rows.length) return [];

  const { data: gps, error: e2 } = await admin.from("group_players").select("id, user_id").in("id", rows.map((r) => r.playerId));
  if (e2) throw e2;
  const userOf = new Map((gps ?? []).filter((g) => g.user_id).map((g) => [g.id as string, g.user_id as string]));
  const people = new Map((await loadCandidatesByIds(admin, [...new Set(userOf.values())])).map((c) => [c.userId, c]));

  const seen = new Set<string>();
  const out: MvpEntry[] = [];
  for (const r of rows) {
    const uid = userOf.get(r.playerId);
    const player = uid ? people.get(uid) : undefined;
    if (!uid || !player || seen.has(uid) || (city && player.city !== city)) continue;
    const g = one(r.m.groups)!;
    seen.add(uid);
    out.push({
      player,
      team: { id: g.id, name: g.name, color: g.color },
      opponent: r.m.kind === "external" ? r.m.opponent_name : null,
      playedAt: r.m.played_at,
      score: r.m.score_a !== null && r.m.score_b !== null ? `${r.m.score_a}-${r.m.score_b}` : "",
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** Son 30 günde rating'i en çok artanlar (en az 2 puanlı maç) */
async function risingStars(admin: SupabaseClient, city: string | null): Promise<RiserEntry[]> {
  type M = { played_at: string };
  const { data, error } = await admin
    .from("match_results")
    .select("player_id, rating_before, rating_after, matches!inner(played_at)")
    .gte("matches.played_at", new Date(Date.now() - 30 * DAY).toISOString())
    .limit(3000);
  if (error) throw error;
  const rows = (data ?? []) as { player_id: string; rating_before: number; rating_after: number; matches: M | M[] }[];
  if (!rows.length) return [];

  const playerIds = [...new Set(rows.map((r) => r.player_id))];
  const gps = await fetchIn<{ id: string; user_id: string | null }>(playerIds, (part, from, to) =>
    admin.from("group_players").select("id, user_id").in("id", part).range(from, to),
  );
  const userOf = new Map(gps.filter((g) => g.user_id).map((g) => [g.id, g.user_id as string]));
  const agg = new Map<string, { delta: number; matches: number }>();
  for (const r of rows) {
    const uid = userOf.get(r.player_id);
    if (!uid) continue;
    const a = agg.get(uid) ?? { delta: 0, matches: 0 };
    a.delta += r.rating_after - r.rating_before;
    a.matches += 1;
    agg.set(uid, a);
  }
  const top = [...agg.entries()].filter(([, a]) => a.matches >= 2 && a.delta > 0).sort((a, b) => b[1].delta - a[1].delta).slice(0, 30);
  const people = new Map((await loadCandidatesByIds(admin, top.map(([u]) => u))).map((c) => [c.userId, c]));
  return top
    .flatMap(([uid, a]) => {
      const player = people.get(uid);
      return player && (!city || player.city === city) ? [{ player, delta: a.delta, matches: a.matches }] : [];
    })
    .slice(0, 8);
}

async function compute(city: string | null): Promise<Featured> {
  const admin = createAdminClient();
  const [regional, regionalTeams, mvps, risers] = await Promise.all([
    city ? loadCandidates(admin, { city }) : Promise.resolve([] as PlayerCandidate[]),
    findTeams(admin, { city: city ?? undefined, limit: 8 }),
    weeklyMvps(admin, city),
    risingStars(admin, city),
  ]);
  const pick = (list: PlayerCandidate[]) => searchCandidates(list, { minMatches: FEATURED_MIN_MATCHES }, "rating").slice(0, 8);
  let players = pick(regional);
  let playersNational = !city;
  if (players.length < MIN_REGIONAL && city) {
    players = pick(await loadCandidates(admin, {}));
    playersNational = true;
  }
  let teams = regionalTeams.filter((t) => t.rated);
  let teamsNational = !city;
  if (teams.length < MIN_REGIONAL && city) {
    teams = (await findTeams(admin, { limit: 8 })).filter((t) => t.rated);
    teamsNational = true;
  }
  return { playersNational, teamsNational, players, teams, mvps, risers };
}

/** Aramada görünme ayarı değişince hemen yenilenir (actions.ts) */
export const FEATURED_TAG = "featured";

const cached = unstable_cache(compute, ["featured-v1"], { revalidate: 300, tags: [FEATURED_TAG] });

/** `city` boşsa Türkiye geneli */
export const loadFeatured = (city: string | null) => cached(city);

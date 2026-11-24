import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchIn } from "@/lib/fetch-in";
import { one } from "@/lib/data";
import { findTeams, type TeamSummary } from "@/lib/teams-data";
import { loadCandidates, loadCandidatesByIds } from "@/lib/players-data";
import type { PlayerCandidate } from "@/lib/player-search";
import { FEATURED_MIN_ITEMS, levelChain, pickSection, rankFeaturedPlayers, type FeaturedLevel, type Section } from "@/lib/featured-rules";

/**
 * Ana sayfadaki "öne çıkanlar": herkese aynı gösterilir. Havuzlar (bölgedeki oyuncular/takımlar, Türkiye geneli MVP ve
 * yükselenler) 5 dakika önbellekte; seçilen kademede (ilçe/il/Türkiye) yeterli kayıt yoksa bir üst kademeye çıkılır.
 */

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
  players: Section<PlayerCandidate>;
  teams: Section<TeamSummary>;
  mvps: Section<MvpEntry>;
  risers: Section<RiserEntry>;
}

const DAY = 864e5;
const LIST = 8;

/** Son 7 günde kapanan, herkese açık TAKIM maçlarının MVP'leri (özel grup maçları sızmasın); Türkiye geneli */
async function weeklyMvps(): Promise<MvpEntry[]> {
  const admin = createAdminClient();
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
    if (!uid || !player || seen.has(uid)) continue;
    const g = one(r.m.groups)!;
    seen.add(uid);
    out.push({
      player,
      team: { id: g.id, name: g.name, color: g.color },
      opponent: r.m.kind === "external" ? r.m.opponent_name : null,
      playedAt: r.m.played_at,
      score: r.m.score_a !== null && r.m.score_b !== null ? `${r.m.score_a}-${r.m.score_b}` : "",
    });
  }
  return out;
}

/** Son 30 günde rating'i en çok artanlar (en az 2 puanlı maç); Türkiye geneli */
async function risingStars(): Promise<RiserEntry[]> {
  const admin = createAdminClient();
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
  const top = [...agg.entries()].filter(([, a]) => a.matches >= 2 && a.delta > 0).sort((a, b) => b[1].delta - a[1].delta).slice(0, 100);
  const people = new Map((await loadCandidatesByIds(admin, top.map(([u]) => u))).map((c) => [c.userId, c]));
  return top.flatMap(([uid, a]) => {
    const player = people.get(uid);
    return player ? [{ player, delta: a.delta, matches: a.matches }] : [];
  });
}

/** Bölgedeki aramaya açık oyuncular (maçı olmayanlar dahil), öne çıkan sırasıyla (ilk 50) */
async function playersPool(city: string | null, district: string | null): Promise<PlayerCandidate[]> {
  const list = await loadCandidates(createAdminClient(), { city: city ?? undefined, district: district ?? undefined });
  return rankFeaturedPlayers(list).slice(0, 50);
}

/** Bölgedeki puanı oluşmuş takımlar (ilk 20) */
async function teamsPool(city: string | null, district: string | null): Promise<TeamSummary[]> {
  const teams = await findTeams(createAdminClient(), { city: city ?? undefined, district: district ?? undefined, limit: 40 });
  return teams.filter((t) => t.rated).slice(0, 20);
}

/** Aramada görünme ayarı değişince hemen yenilenir (actions.ts) */
export const FEATURED_TAG = "featured";
const opts = { revalidate: 300, tags: [FEATURED_TAG] };
const cachedMvps = unstable_cache(weeklyMvps, ["featured-mvps-v2"], opts);
const cachedRisers = unstable_cache(risingStars, ["featured-risers-v2"], opts);
const cachedPlayers = unstable_cache(playersPool, ["featured-players-v3"], opts);
const cachedTeams = unstable_cache(teamsPool, ["featured-teams-v2"], opts);

const same = (a: string | null, b: string | null) => (a ?? "").toLocaleLowerCase("tr") === (b ?? "").toLocaleLowerCase("tr");

/**
 * Seçilen kademe için öne çıkanlar. `level` kullanıcının bölgesine göre: ilçe (il + ilçe), il, Türkiye.
 * Her bölüm ayrı ayrı yeterli kayıt bulana kadar üst kademeye çıkar.
 */
export async function loadFeatured(city: string | null, district: string | null, level: FeaturedLevel): Promise<Featured> {
  const chain = levelChain(level, city, district);
  const region = (l: FeaturedLevel) => (l === "tr" ? { c: null, d: null } : l === "il" ? { c: city, d: null } : { c: city, d: district });
  const inRegion = (p: PlayerCandidate, l: FeaturedLevel) => {
    const r = region(l);
    return (!r.c || same(p.city, r.c)) && (!r.d || same(p.district, r.d));
  };
  const [mvpsAll, risersAll] = await Promise.all([cachedMvps(), cachedRisers()]);

  // Oyuncular: seçilen bölgede kayıtlı biri varsa orada kalınır (çok maçlılar önce, maçı olmayanlar sonda);
  // üst kademeye sadece bölgede hiç oyuncu yoksa çıkılır (eskiden 3 puanlı kişi yoksa çıkılıyordu: kayıtlı oyuncu varken "yeterli kayıt yok")
  const players = await pickSection(
    chain,
    async (l) => {
      const r = region(l);
      return rankFeaturedPlayers(await cachedPlayers(r.c, r.d)).slice(0, LIST);
    },
    1,
  );

  const [teams, mvps, risers] = await Promise.all([
    pickSection(chain, async (l) => (await cachedTeams(region(l).c, region(l).d)).slice(0, LIST), FEATURED_MIN_ITEMS),
    pickSection(chain, async (l) => mvpsAll.filter((m) => inRegion(m.player, l)).slice(0, LIST), FEATURED_MIN_ITEMS),
    pickSection(chain, async (l) => risersAll.filter((r) => inRegion(r.player, l)).slice(0, LIST), FEATURED_MIN_ITEMS),
  ]);
  return { players, teams, mvps, risers };
}

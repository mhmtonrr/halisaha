import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_OVERALL,
  computeRatings,
  type MatchInput,
  type Team,
} from "@/lib/rating";

const PAGE = 1000;

/** Supabase tek seferde en fazla 1000 satır döndürür; hepsini sayfa sayfa çeker. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Bir grubun kapanmış tüm maçlarını puanlama motorunun beklediği biçimde yükler. */
export async function loadClosedMatches(
  admin: SupabaseClient,
  groupId: string,
): Promise<MatchInput[]> {
  const matches = await fetchAll<{
    id: string;
    played_at: string;
    score_a: number | null;
    score_b: number | null;
  }>((from, to) =>
    admin
      .from("matches")
      .select("id, played_at, score_a, score_b")
      .eq("group_id", groupId)
      .eq("status", "closed")
      .order("id")
      .range(from, to),
  );

  const players = await fetchAll<{ match_id: string; player_id: string; team: Team }>(
    (from, to) =>
      admin
        .from("match_players")
        .select("match_id, player_id, team, matches!inner(group_id, status)")
        .eq("matches.group_id", groupId)
        .eq("matches.status", "closed")
        .order("match_id")
        .order("player_id")
        .range(from, to),
  );

  const votes = await fetchAll<{
    match_id: string;
    voter_id: string;
    target_id: string;
    score: number;
  }>((from, to) =>
    admin
      .from("votes")
      .select("match_id, voter_id, target_id, score, matches!inner(group_id, status)")
      .eq("matches.group_id", groupId)
      .eq("matches.status", "closed")
      .order("match_id")
      .order("voter_id")
      .order("target_id")
      .range(from, to),
  );

  const mvps = await fetchAll<{ match_id: string; voter_id: string; target_id: string }>(
    (from, to) =>
      admin
        .from("mvp_votes")
        .select("match_id, voter_id, target_id, matches!inner(group_id, status)")
        .eq("matches.group_id", groupId)
        .eq("matches.status", "closed")
        .order("match_id")
        .order("voter_id")
        .range(from, to),
  );

  const byMatch = new Map<string, MatchInput>(
    matches.map((m) => [
      m.id,
      {
        id: m.id,
        playedAt: m.played_at,
        scoreA: m.score_a ?? 0,
        scoreB: m.score_b ?? 0,
        players: [],
        votes: [],
        mvpVotes: [],
      },
    ]),
  );
  for (const p of players)
    byMatch.get(p.match_id)?.players.push({ playerId: p.player_id, team: p.team });
  for (const v of votes)
    byMatch.get(v.match_id)?.votes.push({
      voterId: v.voter_id,
      targetId: v.target_id,
      score: v.score,
    });
  for (const v of mvps)
    byMatch.get(v.match_id)?.mvpVotes!.push({
      voterId: v.voter_id,
      targetId: v.target_id,
    });

  return [...byMatch.values()];
}

/**
 * Oylamayı kapatır, maç sonuçlarını ve gruptaki herkesin rating'ini yeniden hesaplar.
 * Aynı anda iki istek gelirse sadece biri hesaplar. true: bu çağrı kapattı.
 */
export async function finalizeMatch(matchId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: claimed, error: claimError } = await admin
    .from("matches")
    .update({ status: "closed" })
    .eq("id", matchId)
    .eq("status", "voting")
    .select("id, group_id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return false;

  try {
    const all = await loadClosedMatches(admin, claimed.group_id);
    const before = computeRatings(all.filter((m) => m.id !== matchId)).ratings;
    const { ratings: after, matchResults } = computeRatings(all);
    const result = matchResults.find((r) => r.matchId === matchId);

    if (result) {
      const { error } = await admin.from("match_results").upsert(
        result.players.map((p) => ({
          match_id: matchId,
          player_id: p.playerId,
          performance: p.performance,
          match_score: p.matchScore,
          votes_received: p.votesReceived,
          weight: p.weight,
          rating_before: before.get(p.playerId)?.overall ?? DEFAULT_OVERALL,
          rating_after: after.get(p.playerId)?.overall ?? DEFAULT_OVERALL,
          is_mvp: p.playerId === result.mvpId,
        })),
      );
      if (error) throw error;
    }

    const rows = [...after.values()].map((r) => ({
      player_id: r.playerId,
      overall: r.overall,
      raw: r.raw,
      confidence: r.confidence,
      matches_played: r.matchesPlayed,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("player_ratings").upsert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    return true;
  } catch (e) {
    await admin.from("matches").update({ status: "voting" }).eq("id", matchId);
    throw e;
  }
}

/** Süresi dolmuş oylamaları kapatır (sayfa açıldığında tetiklenir, cron gerektirmez). */
export async function finalizeExpired(groupId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("matches")
    .select("id")
    .eq("group_id", groupId)
    .eq("status", "voting")
    .lt("voting_deadline", new Date().toISOString());
  for (const m of data ?? []) await finalizeMatch(m.id);
}

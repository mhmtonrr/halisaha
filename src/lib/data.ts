import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_OVERALL } from "@/lib/rating";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export const POSITION_LABEL: Record<Position, string> = {
  GK: "KL",
  DEF: "DEF",
  MID: "OS",
  FWD: "FV",
};

export interface GroupPlayer {
  id: string;
  display_name: string;
  user_id: string | null;
  role: "admin" | "member";
  position: Position | null;
  overall: number;
  matches_played: number;
  confidence: number;
}

export interface PlayerStats {
  played: number;
  goals: number;
  assists: number;
  saves: number;
  mvps: number;
  wins: number;
}

const emptyStats = (): PlayerStats => ({
  played: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  mvps: 0,
  wins: 0,
});

type RatingRow = { overall: number; matches_played: number; confidence: number };

/** Supabase 1-1 ilişkileri bazen nesne bazen dizi döndürür. */
export function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export async function getGroupPlayers(
  supabase: SupabaseClient,
  groupId: string,
): Promise<GroupPlayer[]> {
  const { data, error } = await supabase
    .from("group_players")
    .select(
      "id, display_name, user_id, role, position, player_ratings(overall, matches_played, confidence)",
    )
    .eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((p) => {
    const r = one(p.player_ratings as RatingRow | RatingRow[] | null);
    return {
      id: p.id,
      display_name: p.display_name,
      user_id: p.user_id,
      role: p.role,
      position: p.position,
      overall: r?.overall ?? DEFAULT_OVERALL,
      matches_played: r?.matches_played ?? 0,
      confidence: r?.confidence ?? 0,
    };
  });
}

/** Kapanmış maçlardan oyuncu başına toplam istatistikler. */
export async function getGroupStats(
  supabase: SupabaseClient,
  groupId: string,
): Promise<Map<string, PlayerStats>> {
  const [{ data: rows }, { data: results }] = await Promise.all([
    supabase
      .from("match_players")
      .select(
        "player_id, team, goals, assists, saves, matches!inner(group_id, status, score_a, score_b)",
      )
      .eq("matches.group_id", groupId)
      .eq("matches.status", "closed")
      .limit(10000),
    supabase
      .from("match_results")
      .select("player_id, is_mvp, matches!inner(group_id)")
      .eq("matches.group_id", groupId)
      .eq("is_mvp", true)
      .limit(10000),
  ]);

  const stats = new Map<string, PlayerStats>();
  const get = (id: string) => {
    if (!stats.has(id)) stats.set(id, emptyStats());
    return stats.get(id)!;
  };
  type M = { score_a: number | null; score_b: number | null };
  for (const r of rows ?? []) {
    const s = get(r.player_id);
    const m = one(r.matches as M | M[]);
    s.played += 1;
    s.goals += r.goals;
    s.assists += r.assists;
    s.saves += r.saves;
    if (m) {
      const a = m.score_a ?? 0;
      const b = m.score_b ?? 0;
      if ((r.team === "A" && a > b) || (r.team === "B" && b > a)) s.wins += 1;
    }
  }
  for (const r of results ?? []) get(r.player_id).mvps += 1;
  return stats;
}

export function statsFor(stats: Map<string, PlayerStats>, id: string) {
  return stats.get(id) ?? emptyStats();
}

const TZ = "Europe/Istanbul";

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** <input type="datetime-local"> değerini Türkiye saatiyle yorumlar (UTC+3, yaz saati yok). */
export function parseLocalDateTime(value: string) {
  return new Date(`${value}:00+03:00`).toISOString();
}

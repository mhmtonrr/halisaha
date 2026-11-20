import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { computeAttributes, recentForm, totals, type Attribute, type MatchRecord, type PlayerTotals } from "@/lib/attributes";

export type Position = "GK" | "DEF" | "MID" | "FWD";
export const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

/** Kart üzerindeki kısa etiket */
export const POSITION_LABEL: Record<Position, string> = {
  GK: "KL",
  DEF: "DEF",
  MID: "OS",
  FWD: "FV",
};

export const POSITION_NAME: Record<Position, string> = {
  GK: "Kaleci",
  DEF: "Defans",
  MID: "Orta saha",
  FWD: "Forvet",
};

export type Foot = "L" | "R" | "B";
export const FOOT_NAME: Record<Foot, string> = { L: "Sol", R: "Sağ", B: "İki ayak" };

export interface GroupPlayer {
  id: string;
  display_name: string;
  user_id: string | null;
  role: "captain" | "admin" | "member";
  position: Position | null;
  overall: number;
  matches_played: number;
  confidence: number;
  // Profil (misafirlerde boş)
  secondary_positions: Position[];
  preferred_foot: Foot | null;
  shirt_number: number | null;
  bio: string | null;
  city: string | null;
  district: string | null;
}

type RatingRow = { overall: number; matches_played: number; confidence: number };
type ProfileRow = {
  secondary_positions: Position[] | null;
  preferred_foot: Foot | null;
  shirt_number: number | null;
  bio: string | null;
  city: string | null;
  district: string | null;
};

/** Supabase 1-1 ilişkileri bazen nesne bazen dizi döndürür. */
export function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export async function getGroupPlayers(supabase: SupabaseClient, groupId: string): Promise<GroupPlayer[]> {
  const { data, error } = await supabase
    .from("group_players")
    .select(
      "id, display_name, user_id, role, position, player_ratings(overall, matches_played, confidence), profiles(secondary_positions, preferred_foot, shirt_number, bio, city, district)",
    )
    .eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((p) => {
    const r = one(p.player_ratings as RatingRow | RatingRow[] | null);
    const prof = one(p.profiles as ProfileRow | ProfileRow[] | null);
    return {
      id: p.id,
      display_name: p.display_name,
      user_id: p.user_id,
      role: p.role,
      position: p.position,
      overall: r?.overall ?? DEFAULT_OVERALL,
      matches_played: r?.matches_played ?? 0,
      confidence: r?.confidence ?? 0,
      secondary_positions: prof?.secondary_positions ?? [],
      preferred_foot: prof?.preferred_foot ?? null,
      shirt_number: prof?.shirt_number ?? null,
      bio: prof?.bio ?? null,
      city: prof?.city ?? null,
      district: prof?.district ?? null,
    };
  });
}

/** Kapanmış maçlardan oyuncu başına maç kayıtları (yeniden eskiye). */
export async function getGroupHistory(
  supabase: SupabaseClient,
  groupId: string,
): Promise<Map<string, MatchRecord[]>> {
  type M = {
    played_at: string;
    score_a: number | null;
    score_b: number | null;
    kind: "internal" | "external";
    opponent_name: string | null;
  };
  const [{ data: rows, error }, { data: results, error: rError }] = await Promise.all([
    supabase
      .from("match_players")
      .select(
        "match_id, player_id, team, goals, assists, saves, position, matches!inner(group_id, status, played_at, score_a, score_b, kind, opponent_name)",
      )
      .eq("matches.group_id", groupId)
      .eq("matches.status", "closed")
      .limit(10000),
    supabase
      .from("match_results")
      .select("match_id, player_id, match_score, weight, is_mvp, matches!inner(group_id)")
      .eq("matches.group_id", groupId)
      .limit(10000),
  ]);
  if (error) throw error;
  if (rError) throw rError;

  const res = new Map((results ?? []).map((r) => [`${r.match_id}:${r.player_id}`, r]));
  const history = new Map<string, MatchRecord[]>();
  for (const r of rows ?? []) {
    const m = one(r.matches as M | M[]);
    if (!m) continue;
    const us = r.team === "A" ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const them = r.team === "A" ? (m.score_b ?? 0) : (m.score_a ?? 0);
    const result = res.get(`${r.match_id}:${r.player_id}`);
    const list = history.get(r.player_id) ?? [];
    list.push({
      matchId: r.match_id,
      playedAt: m.played_at,
      goals: r.goals,
      assists: r.assists,
      saves: r.saves,
      outcome: us > them ? "win" : us < them ? "loss" : "draw",
      matchScore: result?.match_score ?? null,
      weight: result?.weight ?? 0,
      mvp: result?.is_mvp ?? false,
      kind: m.kind ?? "internal",
      opponentName: m.opponent_name,
      position: r.position,
    });
    history.set(r.player_id, list);
  }
  for (const list of history.values()) list.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  return history;
}

export interface PlayerSummary extends GroupPlayer {
  totals: PlayerTotals;
  attributes: Attribute[];
  form: number | null;
  history: MatchRecord[];
}

/** Oyuncular + istatistikler + kart özellikleri, tek seferde. */
export async function getGroupSummaries(supabase: SupabaseClient, groupId: string): Promise<PlayerSummary[]> {
  const [players, history] = await Promise.all([
    getGroupPlayers(supabase, groupId),
    getGroupHistory(supabase, groupId),
  ]);
  return players.map((p) => {
    const h = history.get(p.id) ?? [];
    return {
      ...p,
      history: h,
      totals: totals(h),
      attributes: computeAttributes(h, p.position === "GK"),
      form: recentForm(h),
    };
  });
}

/** Sıralama: önce maçı olanlar, sonra rating, sonra isim */
export function byRanking(a: GroupPlayer, b: GroupPlayer) {
  return (
    Number(b.matches_played > 0) - Number(a.matches_played > 0) ||
    b.overall - a.overall ||
    a.display_name.localeCompare(b.display_name, "tr")
  );
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

/** Bugün (veya geçtiyse yarın) 21:00, Türkiye saati, datetime-local biçiminde */
export function defaultKickoff() {
  const nowTr = new Date(Date.now() + 3 * 3600 * 1000);
  const d = new Date(Date.UTC(nowTr.getUTCFullYear(), nowTr.getUTCMonth(), nowTr.getUTCDate(), 21));
  if (nowTr.getUTCHours() >= 21) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 16);
}

/** ISO zamanı Türkiye saatiyle datetime-local biçimine çevirir */
export function toLocalInput(iso: string) {
  return new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 16);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { one } from "@/lib/data";

export type GroupKind = "community" | "team";
export type Role = "captain" | "admin" | "member";

export const ROLE_LABEL: Record<GroupKind, Record<Role, string>> = {
  team: { captain: "Kaptan", admin: "Yetkili", member: "Oyuncu" },
  community: { captain: "Kurucu", admin: "Yetkili", member: "Üye" },
};

/** Takım renkleri: koyu zeminde okunur, birbirinden ayırt edilir */
export const TEAM_COLORS = [
  "#e11d48", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#f5f5f4",
];

/** Takım rating'i: kadronun en iyi 7 oyuncusunun ortalaması (halısahada sahaya çıkan sayı) */
export const TEAM_RATING_TOP = 7;
export function teamRating(overalls: number[]): number {
  if (overalls.length === 0) return DEFAULT_OVERALL;
  const top = [...overalls].sort((a, b) => b - a).slice(0, TEAM_RATING_TOP);
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
}

export interface TeamSummary {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  color: string | null;
  description: string | null;
  members: number;
  rating: number;
  /** Rating'i maç oynamış oyunculardan hesaplanmış mı */
  rated: boolean;
}

type GPRow = { user_id: string | null; player_ratings: { overall: number; matches_played: number } | { overall: number; matches_played: number }[] | null };

function summarize(g: {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  color: string | null;
  description: string | null;
  group_players: GPRow[];
}): TeamSummary {
  const ratings = g.group_players.map((p) => one(p.player_ratings));
  return {
    id: g.id,
    name: g.name,
    city: g.city,
    district: g.district,
    color: g.color,
    description: g.description,
    members: g.group_players.length,
    rating: teamRating(ratings.map((r) => r?.overall ?? DEFAULT_OVERALL)),
    rated: ratings.some((r) => (r?.matches_played ?? 0) > 0),
  };
}

const TEAM_SELECT =
  "id, name, city, district, color, description, group_players(user_id, player_ratings(overall, matches_played))";

/** Bölgedeki takımlar, rating'e göre sıralı */
export async function findTeams(
  supabase: SupabaseClient,
  filter: { city?: string; district?: string; q?: string; limit?: number },
): Promise<TeamSummary[]> {
  let query = supabase.from("groups").select(TEAM_SELECT).eq("kind", "team");
  if (filter.city) query = query.eq("city", filter.city);
  if (filter.district) query = query.ilike("district", filter.district.trim());
  if (filter.q) query = query.ilike("name", `%${filter.q.trim().replace(/[%_]/g, "")}%`);
  const { data, error } = await query.limit(500);
  if (error) throw error;
  return (data ?? [])
    .map(summarize)
    .sort((a, b) => Number(b.rated) - Number(a.rated) || b.rating - a.rating || a.name.localeCompare(b.name, "tr"))
    .slice(0, filter.limit ?? 100);
}

export interface Membership {
  playerId: string;
  role: Role;
  overall: number;
  matchesPlayed: number;
  group: TeamSummary & { kind: GroupKind };
}

/** Kullanıcının üye olduğu takımlar ve gruplar */
export async function getMemberships(supabase: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("group_players")
    .select(
      `id, role, player_ratings(overall, matches_played), groups(kind, ${TEAM_SELECT})`,
    )
    .eq("user_id", userId);
  if (error) throw error;
  type G = Parameters<typeof summarize>[0] & { kind: GroupKind };
  return (data ?? [])
    .map((m) => {
      const g = one(m.groups as G | G[] | null);
      const r = one(m.player_ratings as { overall: number; matches_played: number } | { overall: number; matches_played: number }[] | null);
      if (!g) return null;
      return {
        playerId: m.id,
        role: m.role as Role,
        overall: r?.overall ?? DEFAULT_OVERALL,
        matchesPlayed: r?.matches_played ?? 0,
        group: { ...summarize(g), kind: g.kind },
      };
    })
    .filter((m): m is Membership => !!m);
}

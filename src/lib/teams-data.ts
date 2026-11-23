import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { one } from "@/lib/data";
import { loadUserCards, type UserCard } from "@/lib/user-cards";

export type GroupKind = "community" | "team";
export type Role = "captain" | "admin" | "organizer" | "member";

export const ROLE_LABEL: Record<GroupKind, Record<Role, string>> = {
  team: { captain: "Kaptan", admin: "Yetkili", organizer: "Organizatör", member: "Oyuncu" },
  community: { captain: "Kurucu", admin: "Yetkili", organizer: "Organizatör", member: "Üye" },
};

/** Maç ve maç çağrısı açabilir mi? (veritabanındaki can_create_match ile aynı) */
export function canCreateMatch(role: string | null | undefined): boolean {
  return role === "captain" || role === "admin" || role === "organizer";
}

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
  /** Hızlı kurulmuş geçici takım (0037) */
  temporary: boolean;
  /** Dağıtılmış (arşivli) takım */
  archived: boolean;
  rating: number;
  /** Rating'i maç oynamış oyunculardan hesaplanmış mı */
  rated: boolean;
}

type GPRow = { user_id: string | null; is_loan?: boolean; left_at?: string | null };
type Cards = Map<string, UserCard>;

function summarize(g: {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  color: string | null;
  description: string | null;
  is_temporary?: boolean;
  archived_at?: string | null;
  group_players: GPRow[];
}, cards: Cards): TeamSummary {
  // Asıl kadro: hesabı olan üyeler. Misafirler (user_id boş) takım puanına ve oyuncu sayısına girmez.
  const members = g.group_players.filter((p) => p.user_id && !p.is_loan && !p.left_at);
  const ratings = members.map((p) => cards.get(p.user_id as string)).map((c) => (c && !Number.isNaN(c.overall) ? c : undefined));
  return {
    id: g.id,
    name: g.name,
    city: g.city,
    district: g.district,
    color: g.color,
    description: g.description,
    members: members.length,
    temporary: !!g.is_temporary,
    archived: !!g.archived_at,
    rating: teamRating(ratings.map((r) => r?.overall ?? DEFAULT_OVERALL)),
    rated: ratings.some((r) => (r?.matches_played ?? 0) > 0),
  };
}

const TEAM_SELECT =
  "id, name, city, district, color, description, is_temporary, archived_at, group_players(user_id, is_loan, left_at)";

/** Keşfet ve öne çıkanlarda listelenmek için en az bu kadar hesaplı asıl üye (kullanıcı kararı) */
export const MIN_LISTED_MEMBERS = 5;

/** Bölgedeki takımlar, rating'e göre sıralı. Geçici, dağıtılmış ve MIN_LISTED_MEMBERS'tan az üyeli takımlar listelenmez. */
export async function findTeams(
  supabase: SupabaseClient,
  filter: { city?: string; district?: string; q?: string; limit?: number },
): Promise<TeamSummary[]> {
  let query = supabase.from("groups").select(TEAM_SELECT).eq("kind", "team").eq("is_temporary", false).is("archived_at", null);
  if (filter.city) query = query.eq("city", filter.city);
  if (filter.district) query = query.ilike("district", filter.district.trim());
  if (filter.q) query = query.ilike("name", `%${filter.q.trim().replace(/[%_]/g, "")}%`);
  const { data, error } = await query.limit(500);
  if (error) throw error;
  const cards = await loadUserCards(supabase, (data ?? []).flatMap((g) => (g.group_players as GPRow[]).map((p) => p.user_id)));
  return (data ?? [])
    .map((g) => summarize(g as Parameters<typeof summarize>[0], cards))
    .filter((t) => t.members >= MIN_LISTED_MEMBERS)
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
      `id, role, groups(kind, ${TEAM_SELECT})`,
    )
    .eq("user_id", userId)
    .eq("is_loan", false) // ödünç oyuncu takımın üyesi sayılmaz
    .is("left_at", null); // ayrılmış üye değil
  if (error) throw error;
  type G = Parameters<typeof summarize>[0] & { kind: GroupKind };
  const groups = (data ?? []).map((m) => one(m.groups as G | G[] | null));
  const cards = await loadUserCards(supabase, [userId, ...groups.flatMap((g) => (g?.group_players ?? []).map((p) => p.user_id))]);
  const mine = cards.get(userId);
  return (data ?? [])
    .map((m) => {
      const g = one(m.groups as G | G[] | null);
      const r = mine && !Number.isNaN(mine.overall) ? mine : undefined;
      if (!g) return null;
      return {
        playerId: m.id,
        role: m.role as Role,
        overall: r?.overall ?? DEFAULT_OVERALL,
        matchesPlayed: r?.matches_played ?? 0,
        group: { ...summarize(g, cards), kind: g.kind },
      };
    })
    .filter((m): m is Membership => !!m);
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIn } from "@/lib/fetch-in";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { one, type Foot, type Position } from "@/lib/data";
import { computeProfileStats, type ProfileMatch } from "@/lib/profile-stats";

/**
 * Kişi bazlı profil verisi (tüm grup ve takımlar). Service role ile okunur, çünkü bir kişinin maçları
 * birçok özel gruba dağılmıştır; **görünürlük kontrolü çağıranın sorumluluğundadır** (`canViewStats`).
 */

export type StatsVisibility = "teammates" | "public";

export interface PersonProfile {
  id: string;
  displayName: string;
  /** Kartta görünen ad (isteğe bağlı) */
  cardName: string | null;
  /** Kart fotoğrafı (yoksa null) */
  photoUrl: string | null;
  city: string | null;
  district: string | null;
  position: Position | null;
  secondary: Position[];
  foot: Foot | null;
  shirt: number | null;
  bio: string | null;
  statsVisibility: StatsVisibility;
  /** Oyuncu aramasında ve öne çıkanlarda görünür mü */
  discoverable: boolean;
  /** Boy (cm) ve kilo (kg); girilmediyse null */
  heightCm: number | null;
  weightKg: number | null;
  /** Müsait günler: 0=Pzt ... 6=Paz */
  availableDays: number[];
  /** Hesap geçici donduruldu mu */
  frozen: boolean;
}

export interface PersonGroup {
  groupId: string;
  name: string;
  kind: "community" | "team";
  color: string | null;
  role: "captain" | "admin" | "member";
  isLoan: boolean;
  /** Ayrılmış: maç geçmişi için kayıt durur ama üye değil */
  left: boolean;
}

export interface Person {
  profile: PersonProfile;
  /** Hesabın tüm group_players satırları */
  rowIds: string[];
  groups: PersonGroup[];
  overall: number;
  matchesPlayed: number;
  confidence: number;
  skills: Record<string, number | null>;
}

type G = { name: string; kind: "community" | "team"; color: string | null };

export async function loadPerson(admin: SupabaseClient, userId: string): Promise<Person | null> {
  const [{ data: p }, { data: rows, error }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, card_name, photo_url, city, district, preferred_position, secondary_positions, preferred_foot, shirt_number, bio, stats_visibility, discoverable, height_cm, weight_kg, available_days, frozen_at")
      .eq("id", userId)
      .maybeSingle(),
    admin.from("group_players").select("id, group_id, role, is_loan, left_at, groups(name, kind, color)").eq("user_id", userId),
  ]);
  if (error) throw error;
  if (!p) return null;

  const rowIds = (rows ?? []).map((r) => r.id);
  const [ratings, skills] = rowIds.length
    ? await Promise.all([
        admin.from("player_ratings").select("overall, matches_played, confidence").in("player_id", rowIds),
        admin.from("player_skills").select("skills").in("player_id", rowIds).limit(1),
      ])
    : [{ data: [] }, { data: [] }];
  // Rating genel: her satırda aynı; en çok maçı olanı al
  const rating = (ratings.data ?? []).sort((a, b) => b.matches_played - a.matches_played)[0];

  return {
    profile: {
      id: p.id,
      displayName: p.display_name,
      cardName: p.card_name ?? null,
      photoUrl: p.photo_url ?? null,
      city: p.city,
      district: p.district,
      position: (p.preferred_position ?? null) as Position | null,
      secondary: (p.secondary_positions ?? []) as Position[],
      foot: (p.preferred_foot ?? null) as Foot | null,
      shirt: p.shirt_number,
      bio: p.bio,
      statsVisibility: p.stats_visibility === "public" ? "public" : "teammates",
      discoverable: p.discoverable !== false,
      heightCm: p.height_cm ?? null,
      weightKg: p.weight_kg ?? null,
      availableDays: (p.available_days ?? []) as number[],
      frozen: !!p.frozen_at,
    },
    rowIds,
    groups: (rows ?? []).map((r) => {
      const g = one(r.groups as G | G[] | null);
      return {
        groupId: r.group_id,
        name: g?.name ?? "Grup",
        kind: g?.kind ?? "community",
        color: g?.color ?? null,
        role: r.role as PersonGroup["role"],
        isLoan: !!r.is_loan,
        left: !!r.left_at,
      };
    }),
    overall: rating?.overall ?? DEFAULT_OVERALL,
    matchesPlayed: rating?.matches_played ?? 0,
    confidence: rating?.confidence ?? 0,
    skills: (skills.data?.[0]?.skills ?? {}) as Record<string, number | null>,
  };
}

/** İstatistik görünürlüğü: kendisi, "herkes" ayarı veya ortak (ödünç olmayan) grup/takım */
export async function canViewStats(admin: SupabaseClient, viewerId: string, target: Person): Promise<boolean> {
  if (viewerId === target.profile.id) return true;
  if (target.profile.statsVisibility === "public") return true;
  const { data, error } = await admin
    .from("group_players")
    .select("group_id, user_id")
    .in("user_id", [viewerId, target.profile.id])
    .eq("is_loan", false)
    .is("left_at", null);
  if (error) throw error;
  const mine = new Set((data ?? []).filter((r) => r.user_id === viewerId).map((r) => r.group_id));
  return (data ?? []).some((r) => r.user_id === target.profile.id && mine.has(r.group_id));
}

/** İzleyicinin üye olduğu gruplar: maç bağlantısı ve özel grup adı göstermek için */
export async function viewerGroupIds(admin: SupabaseClient, viewerId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("group_players").select("group_id").eq("user_id", viewerId).is("left_at", null);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.group_id));
}

/** Gelmediği maç sayısı (güvenilirlik) */
export async function countNoShows(admin: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await admin.from("match_no_shows").select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

type M = {
  group_id: string;
  status: "voting" | "closed";
  played_at: string;
  score_a: number | null;
  score_b: number | null;
  kind: "internal" | "external" | null;
  opponent_name: string | null;
  venue: string | null;
};

/** Oylamaya veya kapanışa ulaşmış maçlar (sonuç girilmiş), yeniden eskiye */
export async function loadPersonMatches(admin: SupabaseClient, person: Person): Promise<ProfileMatch[]> {
  if (!person.rowIds.length) return [];
  const groupMeta = new Map(person.groups.map((g) => [g.groupId, g]));
  const [rows, results] = await Promise.all([
    fetchIn<{
      match_id: string;
      player_id: string;
      team: "A" | "B";
      goals: number;
      assists: number;
      saves: number;
      position: string | null;
      matches: M | M[];
    }>(person.rowIds, (part, from, to) =>
      admin
        .from("match_players")
        .select("match_id, player_id, team, goals, assists, saves, position, matches!inner(group_id, status, played_at, score_a, score_b, kind, opponent_name, venue)")
        .in("player_id", part)
        .in("matches.status", ["voting", "closed"])
        .range(from, to),
    ),
    fetchIn<{ match_id: string; player_id: string; match_score: number | null; weight: number | null; is_mvp: boolean | null }>(
      person.rowIds,
      (part, from, to) =>
        admin.from("match_results").select("match_id, player_id, match_score, weight, is_mvp").in("player_id", part).range(from, to),
    ),
  ]);
  const res = new Map(results.map((r) => [`${r.match_id}:${r.player_id}`, r]));

  const out: ProfileMatch[] = [];
  for (const r of rows) {
    const m = one(r.matches);
    if (!m) continue;
    const us = (r.team === "A" ? m.score_a : m.score_b) ?? 0;
    const them = (r.team === "A" ? m.score_b : m.score_a) ?? 0;
    const result = res.get(`${r.match_id}:${r.player_id}`);
    const g = groupMeta.get(m.group_id);
    out.push({
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
      groupId: m.group_id,
      groupName: g?.name ?? "Grup",
      groupKind: g?.kind ?? "community",
      scoreUs: us,
      scoreThem: them,
      venue: m.venue ?? null,
      status: m.status,
    });
  }
  return out.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}

export interface UpcomingMatch {
  matchId: string;
  groupId: string;
  groupName: string;
  groupKind: "community" | "team";
  playedAt: string;
  venue: string | null;
  kind: "internal" | "external";
  opponentName: string | null;
  /** Kadrodaki mevkisi (belirtilmediyse null) */
  position: Position | null;
}

/** Kişinin kadrosunda olduğu, henüz oynanmamış (planned) en yakın maçlar. Sadece kendi profili için çağrılır. */
export async function loadUpcomingMatches(admin: SupabaseClient, person: Person, limit = 5): Promise<UpcomingMatch[]> {
  if (!person.rowIds.length) return [];
  const groupMeta = new Map(person.groups.map((g) => [g.groupId, g]));
  const rows = await fetchIn<{
    match_id: string;
    position: string | null;
    matches: { group_id: string; played_at: string; venue: string | null; kind: "internal" | "external" | null; opponent_name: string | null }
      | { group_id: string; played_at: string; venue: string | null; kind: "internal" | "external" | null; opponent_name: string | null }[];
  }>(person.rowIds, (part, from, to) =>
    admin
      .from("match_players")
      .select("match_id, position, matches!inner(group_id, played_at, venue, kind, opponent_name)")
      .in("player_id", part)
      .eq("matches.status", "planned")
      .gte("matches.played_at", new Date().toISOString())
      .range(from, to),
  );
  const seen = new Set<string>();
  const out: UpcomingMatch[] = [];
  for (const r of rows) {
    const m = one(r.matches);
    if (!m || seen.has(r.match_id)) continue;
    seen.add(r.match_id);
    const g = groupMeta.get(m.group_id);
    out.push({
      matchId: r.match_id,
      groupId: m.group_id,
      groupName: g?.name ?? "Grup",
      groupKind: g?.kind ?? "community",
      playedAt: m.played_at,
      venue: m.venue,
      kind: m.kind ?? "internal",
      opponentName: m.opponent_name,
      position: (r.position ?? null) as Position | null,
    });
  }
  return out.sort((a, b) => a.playedAt.localeCompare(b.playedAt)).slice(0, limit);
}

/** Bir profil sayfası için her şey: görünürlük kontrolü dahil. İstatistik göremiyorsa stats/matches/noShows null. */
export async function loadProfileForViewer(admin: SupabaseClient, viewerId: string, targetId: string) {
  const person = await loadPerson(admin, targetId);
  if (!person) return null;
  const canStats = await canViewStats(admin, viewerId, person);
  const [matches, noShows, viewerGroups, upcoming] = await Promise.all([
    canStats ? loadPersonMatches(admin, person) : Promise.resolve(null),
    canStats ? countNoShows(admin, targetId) : Promise.resolve(null),
    viewerGroupIds(admin, viewerId),
    viewerId === targetId ? loadUpcomingMatches(admin, person) : Promise.resolve([] as UpcomingMatch[]),
  ]);
  return { person, matches, noShows, viewerGroups, upcoming, stats: matches ? computeProfileStats(matches) : null };
}

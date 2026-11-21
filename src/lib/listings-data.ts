import type { SupabaseClient } from "@supabase/supabase-js";
import { one, type Position } from "@/lib/data";

export type ListingStatus = "open" | "filled" | "closed";
export type ApplicationStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export const LISTING_STATUS: Record<ListingStatus, { label: string; tone: "default" | "accent" | "warn" }> = {
  open: { label: "Açık", tone: "warn" },
  filled: { label: "Doldu", tone: "accent" },
  closed: { label: "Kapandı", tone: "default" },
};

export const APPLICATION_STATUS: Record<ApplicationStatus, { label: string; tone: "default" | "accent" | "warn" }> = {
  pending: { label: "Yanıt bekliyor", tone: "warn" },
  accepted: { label: "Kabul edildi", tone: "accent" },
  rejected: { label: "Reddedildi", tone: "default" },
  withdrawn: { label: "Geri çekildi", tone: "default" },
};

export interface ListingTeam {
  id: string;
  name: string;
  color: string | null;
  city: string | null;
  district: string | null;
}

export interface Listing {
  id: string;
  groupId: string;
  matchId: string;
  needed: number;
  positions: Position[];
  minOverall: number | null;
  note: string | null;
  status: ListingStatus;
  createdAt: string;
  team: ListingTeam;
  playedAt: string;
  venue: string | null;
  teamSize: number | null;
  matchStatus: string;
}

const COLS = `id, group_id, match_id, needed, positions, min_overall, note, status, created_at,
  groups!inner(id, name, color, city, district),
  matches(played_at, venue, team_size, status)`;

type Row = {
  id: string;
  group_id: string;
  match_id: string;
  needed: number;
  positions: Position[];
  min_overall: number | null;
  note: string | null;
  status: ListingStatus;
  created_at: string;
  groups: ListingTeam | ListingTeam[] | null;
  matches: { played_at: string; venue: string | null; team_size: number | null; status: string } | { played_at: string; venue: string | null; team_size: number | null; status: string }[] | null;
};

function toListing(r: Row): Listing | null {
  const team = one(r.groups);
  const m = one(r.matches);
  if (!team || !m) return null;
  return {
    id: r.id,
    groupId: r.group_id,
    matchId: r.match_id,
    needed: r.needed,
    positions: r.positions ?? [],
    minOverall: r.min_overall,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    team,
    playedAt: m.played_at,
    venue: m.venue,
    teamSize: m.team_size,
    matchStatus: m.status,
  };
}

/** Açık, gelecekteki maçlar için ilanlar; en yakın tarih önce. Bölge ve takım filtresi isteğe bağlı. */
export async function getOpenListings(
  supabase: SupabaseClient,
  filter: { city?: string; district?: string; groupId?: string; limit?: number } = {},
): Promise<Listing[]> {
  let query = supabase.from("player_listings").select(COLS).eq("status", "open");
  if (filter.groupId) query = query.eq("group_id", filter.groupId);
  if (filter.city) query = query.eq("groups.city", filter.city);
  if (filter.district) query = query.ilike("groups.district", filter.district.trim());
  const { data, error } = await query.limit(200);
  if (error) throw error;
  const now = Date.now();
  return ((data ?? []) as unknown as Row[])
    .map(toListing)
    .filter((l): l is Listing => !!l && l.matchStatus === "planned" && new Date(l.playedAt).getTime() > now)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt))
    .slice(0, filter.limit ?? 50);
}

export async function getListing(supabase: SupabaseClient, id: string): Promise<Listing | null> {
  const { data, error } = await supabase.from("player_listings").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toListing(data as unknown as Row) : null;
}

/** Bir maçın ilanı: önce açık olan, yoksa en son açılan (dolmuş/kapanmış) */
export async function getListingForMatch(supabase: SupabaseClient, matchId: string): Promise<Listing | null> {
  const { data, error } = await supabase
    .from("player_listings")
    .select(COLS)
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  const all = ((data ?? []) as unknown as Row[]).map(toListing).filter((l): l is Listing => !!l);
  return all.find((l) => l.status === "open") ?? all[0] ?? null;
}

export interface Applicant {
  userId: string;
  name: string;
  position: Position | null;
  preferredPosition: Position | null;
  note: string | null;
  status: ApplicationStatus;
  createdAt: string;
  overall: number;
  matchesPlayed: number;
  played: number;
  noShows: number;
}

/** Başvuranlar (sadece ilanın takımının kaptan/yetkilisi görür; rating ve güvenilirlikle) */
export async function getApplicants(supabase: SupabaseClient, listingId: string): Promise<Applicant[]> {
  const { data, error } = await supabase.rpc("listing_applicants", { p_listing: listingId });
  if (error) throw error;
  type R = {
    user_id: string; display_name: string; chosen_position: Position | null; preferred_position: Position | null;
    note: string | null; status: ApplicationStatus; created_at: string; overall: number;
    matches_played: number; played: number; no_shows: number;
  };
  return ((data ?? []) as R[]).map((r) => ({
    userId: r.user_id,
    name: r.display_name,
    position: r.chosen_position,
    preferredPosition: r.preferred_position,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    overall: r.overall,
    matchesPlayed: r.matches_played,
    played: r.played,
    noShows: r.no_shows,
  }));
}

/** Kullanıcının bu ilandaki başvurusu (varsa) */
export async function getMyApplication(supabase: SupabaseClient, listingId: string, userId: string) {
  const { data } = await supabase
    .from("listing_applications")
    .select("status, position, note, created_at")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as { status: ApplicationStatus; position: Position | null; note: string | null; created_at: string } | null;
}

/** Kullanıcının bekleyen ve kabul edilmiş başvuruları (ana sayfa kartları için) */
export async function getMyApplications(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("listing_applications")
    .select("listing_id, status, player_listings(match_id, group_id, groups(name), matches(played_at, status))")
    .eq("user_id", userId)
    .in("status", ["pending", "accepted"])
    .limit(20);
  type R = {
    listing_id: string;
    status: ApplicationStatus;
    player_listings: { match_id: string; group_id: string; groups: { name: string } | { name: string }[] | null; matches: { played_at: string; status: string } | { played_at: string; status: string }[] | null } | { match_id: string; group_id: string; groups: { name: string } | { name: string }[] | null; matches: { played_at: string; status: string } | { played_at: string; status: string }[] | null }[] | null;
  };
  const now = Date.now();
  return ((data ?? []) as unknown as R[]).flatMap((r) => {
    const l = one(r.player_listings);
    const m = one(l?.matches ?? null);
    if (!l || !m || m.status !== "planned" || new Date(m.played_at).getTime() < now) return [];
    return [{ listingId: r.listing_id, status: r.status, matchId: l.match_id, groupId: l.group_id, team: one(l.groups)?.name ?? "Takım", playedAt: m.played_at }];
  });
}

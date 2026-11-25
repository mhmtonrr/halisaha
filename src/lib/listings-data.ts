import type { SupabaseClient } from "@supabase/supabase-js";

/** match_overview (0043) satırı: görebildiğim maçın güvenli özeti (özel grubun tablosu açılmadan) */
export interface MatchOverview {
  match_id: string;
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  group_color: string | null;
  city: string | null;
  district: string | null;
  status: string;
  kind: "internal" | "external";
  played_at: string;
  time_tbd: boolean;
  venue: string | null;
  team_size: number | null;
  capacity: number | null;
  roster_count: number;
  reserve_count: number;
  opponent_name: string | null;
  note: string | null;
  positions: string[];
  my_status: string | null;
  is_member: boolean;
  can_manage: boolean;
}

export async function matchOverview(supabase: SupabaseClient, ids: string[]): Promise<Map<string, MatchOverview>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.rpc("match_overview", { p_ids: [...new Set(ids)] });
  return new Map(((data ?? []) as MatchOverview[]).map((o) => [o.match_id, o]));
}

/**
 * Keşfet "Adam arayan": bölgedeki herkese açık ilanların maçları (yer olanlar), engellediğim kişi/takım hariç.
 * Her satırda başvuru için ilan kimliği de döner.
 */
export async function openListings(supabase: SupabaseClient, city?: string, district?: string): Promise<(MatchOverview & { listing_id: string; created_by: string | null })[]> {
  const [{ data: rows }, { data: blocks }] = await Promise.all([
    supabase.rpc("open_listings", { p_city: city || null, p_district: district || null }),
    supabase.from("user_blocks").select("blocked_user_id, blocked_group_id"),
  ]);
  const list = (rows ?? []) as { listing_id: string; match_id: string }[];
  if (!list.length) return [];
  const ids = list.map((r) => r.match_id);
  const [over, { data: owners }] = await Promise.all([
    matchOverview(supabase, ids),
    supabase.from("matches").select("id, created_by").in("id", ids),
  ]);
  const ownerOf = new Map((owners ?? []).map((m) => [m.id as string, m.created_by as string | null]));
  const blocked = new Set((blocks ?? []).flatMap((b) => [b.blocked_user_id, b.blocked_group_id]).filter(Boolean) as string[]);
  return list
    .flatMap((r) => {
      const o = over.get(r.match_id);
      return o ? [{ ...o, listing_id: r.listing_id, created_by: ownerOf.get(r.match_id) ?? null }] : [];
    })
    .filter((o) => !blocked.has(o.group_id) && !(o.created_by && blocked.has(o.created_by)))
    .sort((a, b) => a.played_at.localeCompare(b.played_at));
}

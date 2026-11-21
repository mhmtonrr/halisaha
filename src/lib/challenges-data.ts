import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/data";

export type ChallengeStatus = "pending" | "accepted" | "declined" | "cancelled";

export const CHALLENGE_STATUS: Record<ChallengeStatus, { label: string; tone: "default" | "accent" | "warn" }> = {
  pending: { label: "Yanıt bekliyor", tone: "warn" },
  accepted: { label: "Kabul edildi", tone: "accent" },
  declined: { label: "Reddedildi", tone: "default" },
  cancelled: { label: "İptal edildi", tone: "default" },
};

export interface TeamRef {
  id: string;
  name: string;
  color: string | null;
  city: string | null;
  district: string | null;
}

export interface Challenge {
  id: string;
  proposedAt: string;
  venue: string | null;
  feeNote: string | null;
  message: string | null;
  teamSize: number;
  status: ChallengeStatus;
  createdAt: string;
  from: TeamRef;
  to: TeamRef;
  /** Kabul edildiyse bu takımın tarafındaki maç */
  myMatchId: string | null;
  /** Karşı taraftaki maçın durumu (kabul edilmişse) */
  matchStatus: string | null;
}

const TEAM_COLS = "id, name, color, city, district";

type Row = {
  id: string;
  proposed_at: string;
  venue: string | null;
  fee_note: string | null;
  message: string | null;
  team_size: number;
  status: ChallengeStatus;
  created_at: string;
  from_group: TeamRef | TeamRef[] | null;
  to_group: TeamRef | TeamRef[] | null;
  matches: { id: string; group_id: string; status: string }[] | null;
};

/** Bir takımın gönderdiği ve aldığı teklifler, en yeni önce */
export async function getChallenges(supabase: SupabaseClient, groupId: string): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from("match_challenges")
    .select(
      `id, proposed_at, venue, fee_note, message, team_size, status, created_at,
       from_group:groups!match_challenges_from_group_id_fkey(${TEAM_COLS}),
       to_group:groups!match_challenges_to_group_id_fkey(${TEAM_COLS}),
       matches(id, group_id, status)`,
    )
    .or(`from_group_id.eq.${groupId},to_group_id.eq.${groupId}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const from = one(r.from_group);
    const to = one(r.to_group);
    if (!from || !to) return [];
    const mine = (r.matches ?? []).find((m) => m.group_id === groupId);
    const theirs = (r.matches ?? []).find((m) => m.group_id !== groupId);
    return [
      {
        id: r.id,
        proposedAt: r.proposed_at,
        venue: r.venue,
        feeNote: r.fee_note,
        message: r.message,
        teamSize: r.team_size,
        status: r.status,
        createdAt: r.created_at,
        from,
        to,
        myMatchId: mine?.id ?? null,
        matchStatus: theirs?.status ?? null,
      },
    ];
  });
}

/** Gelen bekleyen teklif sayısı (takımlar için rozet) */
export async function countIncoming(supabase: SupabaseClient, groupIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!groupIds.length) return counts;
  const { data } = await supabase
    .from("match_challenges")
    .select("to_group_id")
    .in("to_group_id", groupIds)
    .eq("status", "pending");
  for (const r of data ?? []) counts.set(r.to_group_id, (counts.get(r.to_group_id) ?? 0) + 1);
  return counts;
}

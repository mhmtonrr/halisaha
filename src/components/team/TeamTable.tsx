import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerSummary } from "@/lib/data";
import { leagueTable } from "@/lib/team-stats";
import { LeagueTable } from "./LeagueTable";

/** Tüm zamanların takım puan tablosu; `squad` asıl kadronun özetleri (kapanmış maçlar) */
export async function TeamTable({
  supabase,
  groupId,
  squad,
  myId,
}: {
  supabase: SupabaseClient;
  groupId: string;
  squad: PlayerSummary[];
  myId?: string;
}) {
  // Yükseliş/düşüş: takımın son kapanmış maçından önceki sıraya göre
  const last = squad.flatMap((p) => p.history).sort((a, b) => b.playedAt.localeCompare(a.playedAt) || b.matchId.localeCompare(a.matchId))[0];
  const { data: lastResults } = last
    ? await supabase.from("match_results").select("player_id, rating_before, rating_after").eq("match_id", last.matchId)
    : { data: [] as { player_id: string; rating_before: number; rating_after: number }[] };
  const delta = new Map((lastResults ?? []).map((r) => [r.player_id as string, r.rating_after - r.rating_before]));
  const rows = leagueTable(
    squad.map((p) => {
      const inLast = p.history.find((h) => h.matchId === last?.matchId);
      return {
        playerId: p.id,
        name: p.display_name,
        photoUrl: p.photo_url,
        overall: p.overall,
        played: p.totals.played,
        goals: p.totals.goals,
        assists: p.totals.assists,
        saves: p.totals.saves,
        mvps: p.totals.mvps,
        last: inLast ? { goals: inLast.goals, assists: inLast.assists, ratingDelta: delta.get(p.id) ?? 0 } : null,
      };
    }),
  );
  return <LeagueTable groupId={groupId} rows={rows} myId={myId} />;
}

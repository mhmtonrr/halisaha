import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGroupPlayers, type Position } from "@/lib/data";
import { balanceTeams } from "@/lib/teams";
import { decidePoll, minPlayers, pickRoster } from "@/lib/poll-rules";

export type SettleResult = "converted" | "cancelled" | "waiting" | "skipped";

/**
 * Otomatik (üye) çağrısını değerlendirir: kontenjan dolduysa ya da süre bitip yeterli kişi geldiyse dengeli A/B ile
 * maça dönüştürür; süre bitip yetmediyse iptal eder. Aynı anda birden çok çağrı gelirse sadece biri işler (atomik talep).
 * Yetkililerin elle onaylı çağrılarına dokunmaz.
 */
export async function settlePoll(pollId: string): Promise<SettleResult> {
  const admin = createAdminClient();
  const { data: poll, error } = await admin
    .from("match_polls")
    .select("id, group_id, created_by, starts_at, venue, capacity, deadline, status, auto_match, team_size")
    .eq("id", pollId)
    .maybeSingle();
  if (error) throw error;
  if (!poll || !poll.auto_match || poll.status !== "open") return "skipped";

  const { data: responses, error: respError } = await admin
    .from("poll_responses")
    .select("player_id, responded_at")
    .eq("poll_id", pollId)
    .eq("answer", "yes");
  if (respError) throw respError;
  const yes = (responses ?? []).map((r) => ({ id: r.player_id as string, respondedAt: r.responded_at as string }));

  const deadlinePassed = !!poll.deadline && new Date(poll.deadline).getTime() <= Date.now();
  const decision = decidePoll({ yes: yes.length, capacity: poll.capacity, deadlinePassed });
  if (decision === "wait") return "waiting";

  // Atomik talep: sadece "open" olan çağrıyı ilk talep eden işler
  const target = decision === "convert" ? "converted" : "closed";
  const { data: claimed, error: claimError } = await admin
    .from("match_polls")
    .update({ status: target })
    .eq("id", pollId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "skipped";

  if (decision === "cancel") {
    await admin.from("group_messages").insert({
      group_id: poll.group_id,
      kind: "system",
      body: `❌ Maç çağrısı iptal oldu: ${yes.length} kişi geldi, en az ${minPlayers(poll.capacity)} gerekiyordu.`,
      poll_id: poll.id,
    });
    return "cancelled";
  }

  let matchId: string | null = null;
  try {
    const { roster } = pickRoster(yes, poll.capacity);
    const players = await getGroupPlayers(admin, poll.group_id);
    const byId = new Map(players.map((p) => [p.id, p]));
    // Profildeki mevkisi kaleci olanlar kaleci sayılır (elle maç kurma formundaki varsayılanla aynı)
    const candidates = roster.map((r) => {
      const p = byId.get(r.id);
      const position = (p?.position ?? null) as Position | null;
      return { id: r.id, name: p?.display_name, overall: p?.overall ?? 65, isGoalkeeper: position === "GK", position };
    });
    const [best] = balanceTeams(candidates);
    const inA = new Set(best.teamA.map((p) => p.id));

    const { data: match, error: matchError } = await admin
      .from("matches")
      .insert({
        group_id: poll.group_id,
        played_at: poll.starts_at,
        venue: poll.venue,
        created_by: poll.created_by,
        kind: "internal",
        team_size: poll.team_size,
      })
      .select("id")
      .single();
    if (matchError) throw matchError;
    matchId = match.id;

    const { error: rosterError } = await admin.from("match_players").insert(
      candidates.map((c) => ({
        match_id: match.id,
        player_id: c.id,
        team: inA.has(c.id) ? "A" : "B",
        position: c.position,
        is_goalkeeper: c.isGoalkeeper,
      })),
    );
    if (rosterError) throw rosterError;
    await admin.from("match_polls").update({ match_id: match.id }).eq("id", pollId);
    return "converted";
  } catch (e) {
    // Yarım kalmasın: maçı sil, çağrıyı yeniden aç (bir sonraki ziyarette tekrar denenir)
    if (matchId) await admin.from("matches").delete().eq("id", matchId);
    await admin.from("match_polls").update({ status: "open", match_id: null }).eq("id", pollId);
    throw e;
  }
}

/** Süresi dolmuş otomatik çağrıları değerlendirir (sayfa açıldığında tetiklenir, cron gerektirmez) */
export async function settleExpiredPolls(groupId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("match_polls")
    .select("id")
    .eq("group_id", groupId)
    .eq("status", "open")
    .eq("auto_match", true)
    .lt("deadline", new Date().toISOString());
  for (const p of data ?? []) await settlePoll(p.id);
}

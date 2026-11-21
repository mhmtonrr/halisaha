import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";

/**
 * Oylaması önümüzdeki 24 saat içinde kapanacak maçlarda henüz oy vermemiş hesap sahiplerine hatırlatma gönderir.
 * Her kullanıcı her maç için en fazla 1 hatırlatma alır (aynı etiketli bildirim varsa atlanır).
 */
export async function sendVoteReminders(now = Date.now()): Promise<{ matches: number; reminded: number }> {
  const admin = createAdminClient();
  const { data: matches } = await admin
    .from("matches")
    .select("id, group_id, voting_deadline")
    .eq("status", "voting")
    .gt("voting_deadline", new Date(now).toISOString())
    .lt("voting_deadline", new Date(now + 24 * 3600_000).toISOString())
    .limit(500);

  let reminded = 0;
  for (const m of matches ?? []) {
    const [{ data: roster }, { data: votes }] = await Promise.all([
      admin.from("match_players").select("player_id, group_players(user_id)").eq("match_id", m.id),
      admin.from("votes").select("voter_id").eq("match_id", m.id),
    ]);
    const voted = new Set((votes ?? []).map((v) => v.voter_id as string));
    const pending = new Set<string>();
    for (const r of roster ?? []) {
      const gp = Array.isArray(r.group_players) ? r.group_players[0] : r.group_players;
      const uid = (gp as { user_id: string | null } | null | undefined)?.user_id;
      if (uid && !voted.has(r.player_id as string)) pending.add(uid);
    }
    if (!pending.size) continue;

    const tag = `vote-reminder:${m.id}`;
    const { data: already } = await admin.from("notifications").select("user_id").eq("tag", tag).in("user_id", [...pending]);
    for (const a of already ?? []) pending.delete(a.user_id as string);
    if (!pending.size) continue;

    const hoursLeft = (new Date(m.voting_deadline as string).getTime() - now) / 3600_000;
    const { stored } = await notify(pending, "vote", text.voteReminder(m.group_id, m.id, hoursLeft));
    reminded += stored;
  }
  return { matches: matches?.length ?? 0, reminded };
}

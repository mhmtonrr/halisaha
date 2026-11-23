import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";

/**
 * Kadrodan biri çıkınca (çekilme onaylandı): maçı kuran toplama çağrısında yedek varsa organizatöre haber ver.
 * Yedeği kadroya almak organizatörün kararı (kullanıcı kararı); otomatik alınmaz.
 */
export async function notifySpotOpened(admin: SupabaseClient, matchId: string, who: string) {
  const { data: poll } = await admin
    .from("match_polls")
    .select("id, group_id, created_by")
    .eq("match_id", matchId)
    .eq("purpose", "gather")
    .maybeSingle();
  if (!poll) return;
  const { count } = await admin
    .from("poll_responses")
    .select("user_id", { count: "exact", head: true })
    .eq("poll_id", poll.id)
    .eq("status", "reserve");
  if (!count) return;
  await notify([poll.created_by as string], "poll", text.spotOpened(who, poll.group_id as string, poll.id as string, count));
}

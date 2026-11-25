import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds } from "@/lib/recipients";

/**
 * Kadrodan biri çıkınca (çekilme onaylandı, elle çıkarıldı, toplanırken "Gelemem"): maçta yedek varsa maçı yönetenlere
 * (kuran + kaptan/yetkililer) haber ver. Yedeği kadroya almak yönetenin kararı (maça 3 saat kala otomatik: cron).
 */
export async function notifySpotOpened(admin: SupabaseClient, matchId: string, who: string, actorId?: string) {
  const { data: m } = await admin.from("matches").select("group_id, created_by, reserve_count, status").eq("id", matchId).maybeSingle();
  if (!m || !m.reserve_count || !["gathering", "planned"].includes(m.status as string)) return;
  const admins = await groupMemberIds(admin, m.group_id as string, { adminsOnly: true });
  const ids = [...new Set([...admins, ...(m.created_by ? [m.created_by as string] : [])])];
  await notify(ids, "match", text.spotOpened(who, m.group_id as string, matchId, m.reserve_count as number), { excludeUserId: actorId });
}

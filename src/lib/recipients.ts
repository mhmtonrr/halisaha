import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Grubun/takımın hesabı olan asıl üyeleri (misafir ve ödünç oyuncu hariç); `adminsOnly` ile sadece kaptan/yetkililer */
export async function groupMemberIds(admin: SupabaseClient, groupId: string, opts: { adminsOnly?: boolean } = {}): Promise<string[]> {
  let q = admin.from("group_players").select("user_id").eq("group_id", groupId).eq("is_loan", false).not("user_id", "is", null);
  if (opts.adminsOnly) q = q.in("role", ["captain", "admin"]);
  const { data } = await q.limit(2000);
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

/** Maçların kadrosundaki hesap sahipleri (ödünç oyuncular dahil, misafirler hariç) */
export async function matchAccountIds(admin: SupabaseClient, matchIds: string[]): Promise<string[]> {
  if (!matchIds.length) return [];
  const { data } = await admin
    .from("match_players")
    .select("group_players(user_id)")
    .in("match_id", matchIds)
    .limit(2000);
  const ids = new Set<string>();
  for (const r of data ?? []) {
    const gp = Array.isArray(r.group_players) ? r.group_players[0] : r.group_players;
    const uid = (gp as { user_id: string | null } | null | undefined)?.user_id;
    if (uid) ids.add(uid);
  }
  return [...ids];
}

/** Bağlı (takımlar arası) maçta iki maç satırı; değilse sadece kendisi */
export async function linkedMatches(
  admin: SupabaseClient,
  matchId: string,
): Promise<{ id: string; group_id: string; opponent_name: string | null; kind: string }[]> {
  const { data: m } = await admin.from("matches").select("id, group_id, opponent_name, kind, challenge_id").eq("id", matchId).maybeSingle();
  if (!m) return [];
  if (!m.challenge_id) return [m];
  const { data } = await admin.from("matches").select("id, group_id, opponent_name, kind").eq("challenge_id", m.challenge_id);
  return data ?? [m];
}

export async function groupName(admin: SupabaseClient, groupId: string): Promise<string> {
  const { data } = await admin.from("groups").select("name").eq("id", groupId).maybeSingle();
  return data?.name ?? "Takım";
}

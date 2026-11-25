"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds, groupName } from "@/lib/recipients";
import { isValidSize } from "@/lib/formations";
import { matchWhen } from "@/lib/match-rules";
import { callWhen, dayTimeToIso } from "@/lib/call-rules";

// Üye maç önerisi (0037; onayda toplanan maç açılır: 0046). Eski çağrı eylemlerinden (call-actions, 5b'de kalktı) taşındı.

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string) {
  return error?.code === "P0001" && error.message ? error.message : fallback;
}

export async function proposeMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}`;
  const day = str(fd, "day");
  const time = str(fd, "time");
  const startsAt = time ? dayTimeToIso(day, time) : null;
  const { error } = await supabase.rpc("propose_match", {
    p_group: groupId,
    p_play_on: day || null,
    p_starts_at: startsAt,
    p_venue: str(fd, "venue").slice(0, 80) || null,
    p_note: str(fd, "note").slice(0, 300) || null,
  });
  if (error) fail(`${back}?oner=1`, rpcMessage(error, "Öneri gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [ids, name, { data: me }] = await Promise.all([
      groupMemberIds(admin, groupId, { canCreate: true }),
      groupName(admin, groupId),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    await notify(ids, "match", text.proposalReceived(me?.display_name ?? "Bir üye", name, groupId, callWhen({ play_on: day, starts_at: startsAt })), { excludeUserId: user.id });
  });
  revalidatePath(back);
  redirect(`${back}?oneri=gonderildi#oneriler`);
}

export async function decideProposal(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const id = str(fd, "proposalId");
  const accept = str(fd, "accept") === "1";
  const back = `/g/${groupId}`;
  // 0046: onaylanan öneri toplanan maç açar; formatı onaylayan seçer
  const size = Number(fd.get("size"));
  const { data: matchId, error } = await supabase.rpc("decide_proposal", { p_id: id, p_accept: accept, p_team_size: isValidSize(size) ? size : 7 });
  if (error) fail(`${back}#oneriler`, rpcMessage(error, "Karar kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: p }, name] = await Promise.all([
      admin.from("match_proposals").select("proposed_by").eq("id", id).maybeSingle(),
      groupName(admin, groupId),
    ]);
    if (!p) return;
    await notify([p.proposed_by as string], "match", text.proposalDecided(name, groupId, accept, (matchId as string | null) ?? null));
    if (accept && matchId) {
      // Açılan maç gruba duyurulur (öneren ve onaylayan hariç)
      const { data: m } = await admin.from("matches").select("played_at, time_tbd, roster_count, capacity").eq("id", matchId as string).maybeSingle();
      if (!m) return;
      const ids = (await groupMemberIds(admin, groupId, { broadcast: true })).filter((u) => u !== p.proposed_by);
      await notify(ids, "match", text.matchGathering(name, groupId, matchId as string, matchWhen(m.played_at, m.time_tbd), m.roster_count, m.capacity ?? m.roster_count), { excludeUserId: user.id });
    }
  });
  revalidatePath(back);
  redirect(accept && matchId ? `/g/${groupId}/m/${matchId as string}` : `${back}#oneriler`);
}

export async function cancelProposal(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { error } = await supabase.rpc("cancel_proposal", { p_id: str(fd, "proposalId") });
  if (error) fail(`/g/${groupId}#oneriler`, rpcMessage(error, "Öneri geri çekilemedi"));
  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { announceJoin } from "@/lib/membership-notify";
import type { GroupKind } from "@/lib/teams-data";

// Gruba/takıma katılma isteği (0044). Karar: bekleyen istekler sayfası (/g/[id]/istekler).

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string) {
  return error?.code === "P0001" && error.message ? error.message : fallback;
}

/** Kaptan/yetkili isteği kabul eder (kişi üye olur) veya reddeder; isteyene haber gider */
export async function decideJoinRequest(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const requestId = str(fd, "requestId");
  const accept = str(fd, "accept") === "1";
  const back = `/g/${groupId}/istekler`;
  const { error } = await supabase.rpc("decide_join_request", { p_id: requestId, p_accept: accept });
  if (error) fail(back, rpcMessage(error, "Karar kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: r }, { data: g }] = await Promise.all([
      admin.from("group_join_requests").select("user_id").eq("id", requestId).maybeSingle(),
      admin.from("groups").select("name, kind").eq("id", groupId).maybeSingle(),
    ]);
    if (!r || !g) return;
    await notify([r.user_id as string], "invite", text.joinDecided(g.name as string, groupId, g.kind as GroupKind, accept));
    // Diğer yetkililere "yeni üye" (karar veren zaten biliyor)
    if (accept) announceJoin(groupId, r.user_id as string, [user.id]);
  });
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`${back}?sekme=katilma`);
}

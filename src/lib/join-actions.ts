"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { announceJoin } from "@/lib/membership-notify";
import { groupMemberIds } from "@/lib/recipients";
import type { GroupKind } from "@/lib/teams-data";

// Gruba/takıma katılma isteği (0044). Gönderme: Keşfet "Gruplar" ve takım sayfası; karar: bekleyen istekler sayfası (/g/[id]/istekler).

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string) {
  return error?.code === "P0001" && error.message ? error.message : fallback;
}

/** Formdan gelen dönüş adresi (sadece uygulama içi yol) */
function backOf(fd: FormData) {
  const b = str(fd, "back");
  return b.startsWith("/") && !b.startsWith("//") ? b : "/kesfet?sekme=grup";
}
function withParam(path: string, key: string, value: string) {
  const [p, hash] = path.split("#");
  return `${p}${p.includes("?") ? "&" : "?"}${key}=${value}${hash ? `#${hash}` : ""}`;
}

/** Keşfet'ten / takım sayfasından katılma isteği; kaptan ve yetkililere haber gider */
export async function requestJoin(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = backOf(fd);
  const { error } = await supabase.rpc("request_join", { p_group: groupId, p_message: str(fd, "message").slice(0, 200) || null });
  if (error) fail(back, rpcMessage(error, "İstek gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: g }, { data: me }, ids] = await Promise.all([
      admin.from("groups").select("name, kind").eq("id", groupId).maybeSingle(),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      groupMemberIds(admin, groupId, { adminsOnly: true }),
    ]);
    if (!g) return;
    await notify(ids, "invite", text.joinRequested((me?.display_name as string | undefined) ?? "Bir oyuncu", g.name as string, groupId, g.kind as GroupKind), { excludeUserId: user.id });
  });
  revalidatePath(back.split(/[?#]/)[0]);
  redirect(withParam(back, "istek", "gonderildi"));
}

/** Bekleyen kendi isteğini geri al */
export async function cancelJoinRequest(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = backOf(fd);
  const { data: r } = await supabase.from("group_join_requests").select("id").eq("group_id", groupId).eq("user_id", user.id).eq("status", "pending").maybeSingle();
  if (!r) fail(back, "Bekleyen istek bulunamadı");
  const { error } = await supabase.rpc("cancel_join_request", { p_id: r.id });
  if (error) fail(back, rpcMessage(error, "İstek geri alınamadı"));
  revalidatePath(back.split(/[?#]/)[0]);
  redirect(back);
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

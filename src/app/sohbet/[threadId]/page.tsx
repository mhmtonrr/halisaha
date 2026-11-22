import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { DmRoom, type DmMessage, type InviteInfo } from "./DmRoom";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

/** Birebir sohbet (WhatsApp tarzı konuşma ekranı) */
export default async function DmPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { supabase, user } = await requireUser();
  if (!UUID.test(threadId)) notFound();

  const { data: thread } = await supabase
    .from("dm_threads")
    .select("id, user_a, user_b, status, requested_by")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) notFound();
  // Reddedilmiş isteği gönderen artık göremez
  if (thread.status === "declined" && thread.requested_by === user.id) redirect("/sohbet");

  const otherId = thread.user_a === user.id ? thread.user_b : thread.user_a;
  const [{ data: other }, { data: messages }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, photo_url").eq("id", otherId).maybeSingle(),
    supabase
      .from("dm_messages")
      .select("id, author_id, kind, body, invite_id, deleted_at, created_at")
      .eq("thread_id", threadId)
      .order("id", { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  const inviteIds = [...new Set((messages ?? []).map((m) => m.invite_id).filter(Boolean))] as string[];
  const { data: invites } = inviteIds.length
    ? await supabase.from("group_invites").select("id, group_id, group_name, group_kind, status, inviter_id").in("id", inviteIds)
    : { data: [] as InviteInfo[] };

  await supabase.rpc("mark_dm_read", { p_thread_id: threadId });

  return (
    <>
      <LiveRefresh watches={[{ table: "dm_threads", filter: `id=eq.${threadId}` }, { table: "group_invites", filter: `invitee_id=eq.${user.id}` }]} />
      <DmRoom
        threadId={threadId}
        meId={user.id}
        other={{ id: otherId, name: other?.display_name ?? "Oyuncu", photoUrl: other?.photo_url ?? null }}
        status={thread.status as "pending" | "accepted" | "declined"}
        requestedByMe={thread.requested_by === user.id}
        initial={((messages ?? []) as DmMessage[]).reverse()}
        hasMore={(messages?.length ?? 0) === PAGE_SIZE}
        invites={(invites ?? []) as InviteInfo[]}
      />
    </>
  );
}

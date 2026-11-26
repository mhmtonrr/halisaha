import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getMemberships } from "@/lib/teams-data";
import { DmRoom, type DmMessage, type InviteInfo } from "./DmRoom";
import type { LiveMatch } from "./MatchCardView";
import { matchExtras, matchOverview } from "@/lib/listings-data";
import { inList } from "@/lib/live";

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
      .select("id, author_id, kind, body, invite_id, card, match_id, deleted_at, created_at")
      .eq("thread_id", threadId)
      .order("id", { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  const inviteIds = [...new Set((messages ?? []).map((m) => m.invite_id).filter(Boolean))] as string[];
  const { data: invites } = inviteIds.length
    ? await supabase.from("group_invites").select("id, group_id, group_name, group_kind, status, inviter_id").in("id", inviteIds)
    : { data: [] as InviteInfo[] };

  // Kartlar: güncel durum (açık/kapalı) ve görüntüleyenin üye olduğu gruplar
  const msgs = (messages ?? []) as DmMessage[];
  const ids = (k: "match_id") => [...new Set(msgs.map((m) => m[k]).filter(Boolean))] as string[];
  const [over, memberships, extras] = await Promise.all([
    // Maç kartı canlı: sayaç, durum, benim durumum (0043 match_overview; davetli görebilir)
    matchOverview(supabase, ids("match_id")),
    msgs.some((m) => m.kind === "match") ? getMemberships(supabase, user.id) : Promise.resolve([]),
    matchExtras(supabase, ids("match_id")),
  ]);
  const refStatus: Record<string, string> = {};
  const live: Record<string, LiveMatch> = {};
  for (const o of over.values()) {
    refStatus[`match:${o.match_id}`] = o.status;
    live[o.match_id] = { status: o.status, roster: o.roster_count, capacity: o.capacity, myStatus: o.my_status, playedAt: o.played_at, timeTbd: o.time_tbd, opponent: o.opponent_name, color: o.group_color, logo: o.group_logo, ...extras.get(o.match_id) };
  }

  await supabase.rpc("mark_dm_read", { p_thread_id: threadId });

  return (
    <>
      <LiveRefresh
        watches={[
          { table: "dm_threads", filter: `id=eq.${threadId}` },
          { table: "group_invites", filter: `invitee_id=eq.${user.id}` },
          ...(ids("match_id").length ? [{ table: "matches", filter: inList("id", ids("match_id")) }] : []),
        ]}
      />
      <DmRoom
        threadId={threadId}
        meId={user.id}
        other={{ id: otherId, name: other?.display_name ?? "Oyuncu", photoUrl: other?.photo_url ?? null }}
        status={thread.status as "pending" | "accepted" | "declined"}
        requestedByMe={thread.requested_by === user.id}
        initial={((messages ?? []) as DmMessage[]).reverse()}
        hasMore={(messages?.length ?? 0) === PAGE_SIZE}
        invites={(invites ?? []) as InviteInfo[]}
        refStatus={refStatus}
        live={live}
        memberGroupIds={memberships.map((m) => m.group.id)}
      />
    </>
  );
}

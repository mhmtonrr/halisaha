import { requireUser } from "@/lib/supabase/server";
import { getMemberships } from "@/lib/teams-data";
import { inList } from "@/lib/live";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Header } from "@/components/ui";
import { InboxList, type InboxRow } from "./InboxList";

const TZ = "Europe/Istanbul";

function when(iso: string) {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("tr-TR", { timeZone: TZ });
  if (day(d) === day(new Date())) return d.toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(new Date(Date.now() - 86400000))) return "Dün";
  return d.toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "short" });
}

/** Genel sohbet ekranı: takımlar, gruplar ve kişiler tek listede; tanımadıklarından gelen istekler üstte */
export default async function InboxPage() {
  const { supabase, user } = await requireUser();

  const [memberships, groupUnread, dmUnread, { data: threads }] = await Promise.all([
    getMemberships(supabase, user.id),
    supabase.rpc("unread_counts"),
    supabase.rpc("dm_unread_counts"),
    supabase
      .from("dm_threads")
      .select("id, user_a, user_b, status, requested_by, last_message_at, last_author_id, last_body")
      .order("last_message_at", { ascending: false })
      .limit(100),
  ]);

  const gUnread = new Map<string, number>((groupUnread.data ?? []).map((r: { group_id: string; unread: number }) => [r.group_id, r.unread]));
  const dUnread = new Map<string, number>((dmUnread.data ?? []).map((r: { thread_id: string; unread: number }) => [r.thread_id, r.unread]));

  // Grup/takım: son mesaj
  const lastMessages = await Promise.all(
    memberships.map(async (m) => {
      const { data } = await supabase
        .from("group_messages")
        .select("body, kind, created_at, deleted_at")
        .eq("group_id", m.group.id)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),
  );

  // Kişiler
  const visible = (threads ?? []).filter((t) => t.status !== "declined");
  const otherIds = visible.map((t) => (t.user_a === user.id ? t.user_b : t.user_a));
  const { data: people } = otherIds.length
    ? await supabase.from("profiles").select("id, display_name, photo_url").in("id", otherIds)
    : { data: [] as { id: string; display_name: string; photo_url: string | null }[] };
  const personOf = new Map((people ?? []).map((p) => [p.id, p]));

  const groupRows: (InboxRow & { at: string })[] = memberships.map((m, i) => {
    const last = lastMessages[i];
    return {
      key: `g:${m.group.id}`,
      href: `/g/${m.group.id}/sohbet`,
      title: m.group.name,
      preview: last ? (last.deleted_at ? "Bu mesaj silindi" : last.body) : "Henüz mesaj yok",
      at: last?.created_at ?? "1970-01-01T00:00:00Z",
      time: last ? when(last.created_at) : "",
      unread: gUnread.get(m.group.id) ?? 0,
      kind: "group",
      color: m.group.color,
      hint: m.group.kind === "team" ? "Takım" : "Grup",
    };
  });

  const requests: (InboxRow & { at: string })[] = [];
  const dmRows: (InboxRow & { at: string })[] = [];
  for (const t of visible) {
    const otherId = t.user_a === user.id ? t.user_b : t.user_a;
    const p = personOf.get(otherId);
    const incomingRequest = t.status === "pending" && t.requested_by !== user.id;
    const row = {
      key: `d:${t.id}`,
      href: `/sohbet/${t.id}`,
      title: p?.display_name ?? "Oyuncu",
      preview: (t.last_author_id === user.id ? "Sen: " : "") + (t.last_body || "Mesaj yok"),
      at: t.last_message_at,
      time: when(t.last_message_at),
      unread: dUnread.get(t.id) ?? 0,
      kind: "dm" as const,
      photoUrl: p?.photo_url ?? null,
      request: incomingRequest,
      hint: t.status === "pending" && !incomingRequest ? "İstek gönderildi" : undefined,
    };
    (incomingRequest ? requests : dmRows).push(row);
  }

  const rows = [...requests, ...[...groupRows, ...dmRows].sort((a, b) => b.at.localeCompare(a.at))];

  const watches = [
    { table: "dm_threads", filter: `user_a=eq.${user.id}` },
    { table: "dm_threads", filter: `user_b=eq.${user.id}` },
    ...(memberships.length ? [{ table: "group_messages", filter: inList("group_id", memberships.map((m) => m.group.id)) }] : []),
  ];

  return (
    <main>
      <LiveRefresh watches={watches} />
      <Header title="Sohbetler" back="/" />
      <InboxList rows={rows} />
    </main>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getMemberships } from "@/lib/teams-data";
import { inList } from "@/lib/live";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import { Card, Header, cx } from "@/components/ui";

const TZ = "Europe/Istanbul";

function when(iso: string) {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("tr-TR", { timeZone: TZ });
  if (day(d) === day(new Date())) return d.toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(new Date(Date.now() - 86400000))) return "Dün";
  return d.toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "short" });
}

interface Row {
  key: string;
  href: string;
  title: string;
  preview: string;
  at: string;
  unread: number;
  visual: React.ReactNode;
  hint?: string;
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

  const groupRows: Row[] = memberships.map((m, i) => {
    const last = lastMessages[i];
    return {
      key: `g:${m.group.id}`,
      href: `/g/${m.group.id}/sohbet`,
      title: m.group.name,
      preview: last ? (last.deleted_at ? "Bu mesaj silindi" : last.body) : "Henüz mesaj yok",
      at: last?.created_at ?? "1970-01-01T00:00:00Z",
      unread: gUnread.get(m.group.id) ?? 0,
      visual: <TeamBadge name={m.group.name} color={m.group.color} size="sm" />,
      hint: m.group.kind === "team" ? "Takım" : "Grup",
    };
  });

  const requests: Row[] = [];
  const dmRows: Row[] = [];
  for (const t of visible) {
    const otherId = t.user_a === user.id ? t.user_b : t.user_a;
    const p = personOf.get(otherId);
    const name = p?.display_name ?? "Oyuncu";
    const incomingRequest = t.status === "pending" && t.requested_by !== user.id;
    const row: Row = {
      key: `d:${t.id}`,
      href: `/sohbet/${t.id}`,
      title: name,
      preview: (t.last_author_id === user.id ? "Sen: " : "") + (t.last_body || "Mesaj yok"),
      at: t.last_message_at,
      unread: dUnread.get(t.id) ?? 0,
      visual: <Avatar name={name} photoUrl={p?.photo_url} className="h-10 w-10 bg-pitch-700 text-sm" />,
      hint: t.status === "pending" && !incomingRequest ? "İstek gönderildi" : undefined,
    };
    (incomingRequest ? requests : dmRows).push(row);
  }

  const rows = [...groupRows, ...dmRows].sort((a, b) => b.at.localeCompare(a.at));

  const watches = [
    { table: "dm_threads", filter: `user_a=eq.${user.id}` },
    { table: "dm_threads", filter: `user_b=eq.${user.id}` },
    ...(memberships.length ? [{ table: "group_messages", filter: inList("group_id", memberships.map((m) => m.group.id)) }] : []),
  ];

  const renderRow = (r: Row, accent = false) => (
    <Link key={r.key} href={r.href}>
      <Card className={cx("flex items-center gap-3 transition hover:border-accent/50", accent && "border-amber-400/40 bg-amber-400/5")}>
        <div className="shrink-0">{r.visual}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cx("truncate", r.unread ? "font-bold" : "font-medium")}>
              {r.title}
              {r.hint && <span className="ml-2 text-[11px] font-normal text-muted">{r.hint}</span>}
            </span>
            {r.at > "1971" && <span className="shrink-0 text-[11px] text-muted">{when(r.at)}</span>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={cx("truncate text-sm", r.unread ? "text-on-surface" : "text-muted")}>{r.preview}</p>
            {r.unread > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-black text-pitch-950">
                {r.unread > 99 ? "99+" : r.unread}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );

  return (
    <main>
      <LiveRefresh watches={watches} />
      <Header title="Sohbetler" back="/" />

      {requests.length > 0 && (
        <section className="mb-4 space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-amber-300">Mesaj istekleri ({requests.length})</h2>
          {requests.map((r) => renderRow(r, true))}
        </section>
      )}

      {rows.length === 0 && requests.length === 0 ? (
        <Card className="space-y-2 text-center text-sm text-muted">
          <div className="text-3xl">💬</div>
          <p>Henüz sohbetin yok. Bir takıma/gruba katıl ya da Keşfet’ten bir oyuncuya mesaj gönder.</p>
          <Link href="/kesfet" className="text-accent">
            Keşfet ›
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">{rows.map((r) => renderRow(r))}</div>
      )}
    </main>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Card, Header, cx } from "@/components/ui";
import type { NotificationType } from "@/lib/notify-rules";
import { MarkRead } from "./MarkRead";

const ICON: Record<NotificationType, string> = { vote: "🗳️", poll: "📣", match: "⚽", offer: "🤝", listing: "🔎", chat: "💬", dm: "✉️", invite: "🛡️", friend: "👋" };

function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "şimdi";
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d} gün önce` : new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });
}

/** Bildirim kutusu: son 50 bildirim (push izni olmasa da buradan görünür) */
export default async function NotificationsPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, url, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <main>
      <LiveRefresh watches={[{ table: "notifications", filter: `user_id=eq.${user.id}` }]} />
      <MarkRead unread={unread} />
      <Header
        title="Bildirimler"
        back="/"
        right={
          <Link href="/profil?sekme=ayarlar#bildirimler" className="rounded-lg px-2 py-1 text-sm text-accent hover:bg-pitch-800">
            Ayarlar
          </Link>
        }
      />
      {items.length === 0 ? (
        <Card className="space-y-2 text-center text-sm text-muted">
          <div className="text-3xl">🔔</div>
          <p>Henüz bildirimin yok. Oylama, maç çağrısı, teklif ve ilan gelişmeleri burada görünür.</p>
          <Link href="/profil?sekme=ayarlar#bildirimler" className="text-accent">
            Push bildirimlerini aç ›
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Link key={n.id} href={n.url}>
              <Card className={cx("flex items-start gap-3 transition hover:border-accent/50", !n.read_at && "border-accent/40 bg-accent/5")}>
                <span className="text-2xl">{ICON[n.type as NotificationType] ?? "🔔"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cx("truncate", n.read_at ? "font-medium" : "font-bold")}>{n.title.replace(/^[^\p{L}\p{N}]+/u, "")}</span>
                    <span className="shrink-0 text-[11px] text-muted">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{n.body}</p>}
                </div>
                {!n.read_at && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" aria-label="okunmamış" />}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

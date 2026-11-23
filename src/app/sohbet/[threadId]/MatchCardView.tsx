import Link from "next/link";
import { TeamBadge } from "@/components/TeamBadge";
import { cx } from "@/components/ui";

/** Paylaşım anındaki özet (dm_messages.card) */
export interface MatchCard {
  type: "poll" | "match";
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  starts_at: string;
  venue: string | null;
  positions?: string[];
  capacity?: number | null;
  /** Çağrı: toplama veya adam ara */
  purpose?: "gather" | "fill";
  /** Çağrının saati belli değil (starts_at sadece günü gösterir) */
  time_tbd?: boolean;
  opponent?: string | null;
  team_size?: number | null;
}

const title = (card: MatchCard) => (card.type === "match" ? "Maç daveti" : card.purpose === "fill" ? "Adam aranıyor" : "Maç çağrısı");
const POS: Record<string, string> = { GK: "Kaleci", DEF: "Defans", MID: "Orta saha", FWD: "Forvet" };

const when = (iso: string, dayOnly?: boolean) =>
  dayOnly
    ? `${new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" })} · saat belli değil`
    : new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Maça davet kartı: çağrı (toplama / adam ara) veya planlı maç. Alıcı karttan ilgili sayfaya gider; özel grup içeriği üye olmayana açılmaz. */
export function MatchCardView({
  card,
  refId,
  status,
  isMember,
  mine,
  time,
}: {
  card: MatchCard;
  /** Grup/çağrı/maç silindiyse null */
  refId: string | null;
  /** Güncel durum (bilinmiyorsa undefined) */
  status?: string;
  isMember: boolean;
  mine: boolean;
  time: string;
}) {
  const closed = status !== undefined && (card.type === "match" ? status !== "planned" : status === "closed");
  // Saati belli olmayan çağrı gün bitene kadar geçerli
  const expired = new Date(card.starts_at).getTime() + (card.time_tbd ? 24 * 3600_000 : 0) < Date.now();
  const inactive = closed || expired || !refId;

  let href: string | null = null;
  let label = "";
  let note = "";
  if (!refId) {
    note = card.type === "poll" ? "Bu çağrı artık yok." : "Bu maç artık yok.";
  } else if (isMember) {
    href = card.type === "poll" ? `/g/${card.group_id}/cagri/${refId}` : `/g/${card.group_id}/m/${refId}`;
    label = card.type === "poll" ? "Çağrıya yanıt ver" : "Maça bak";
  } else if (card.group_kind === "team") {
    href = `/g/${card.group_id}`;
    label = "Takıma bak";
    note = card.type === "poll" ? "Çağrıya yanıt vermek için takımın oyuncusu olmalısın." : "";
  } else {
    note = "Bu davet grup üyelerine özel; yanıt vermek için üye olmalısın.";
  }

  const details = [
    card.type === "poll" && card.purpose === "fill" && card.capacity ? `${card.capacity} oyuncu aranıyor` : null,
    card.type === "poll" && card.purpose !== "fill" && card.capacity ? `${card.capacity} kişilik kadro` : null,
    card.type === "poll" && card.positions?.length ? card.positions.map((p) => POS[p] ?? p).join(", ") : null,
    card.type === "match" && card.opponent ? `vs ${card.opponent}` : null,
    card.type === "match" && card.team_size ? `${card.team_size} kişilik` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={cx("my-2 flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("w-[88%] max-w-sm overflow-hidden rounded-2xl border bg-pitch-900", inactive ? "border-line opacity-80" : "border-accent/40")}>
        <div className="flex items-center gap-2 bg-accent/10 px-3 py-2">
          <span className="text-base">⚽</span>
          <span className="flex-1 text-xs font-bold uppercase tracking-wide text-accent">{title(card)}</span>
          {inactive && <span className="rounded-full bg-pitch-800 px-2 py-0.5 text-[10px] text-muted">{closed ? "Kapandı" : "Geçti"}</span>}
        </div>
        <div className="space-y-2 px-3 py-3">
          <div className="flex items-center gap-2.5">
            <TeamBadge name={card.group_name} color={null} size="sm" />
            <div className="min-w-0">
              <div className="truncate font-bold">{card.group_name}</div>
              <div className="text-[11px] text-muted">{card.group_kind === "team" ? "Takım" : "Grup"}</div>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-muted">Zaman</dt>
            <dd>{when(card.starts_at, card.time_tbd)}</dd>
            <dt className="text-muted">Saha</dt>
            <dd>{card.venue ?? "Belirtilmedi"}</dd>
          </dl>
          {details.length > 0 && <p className="text-sm text-muted">{details.join(" · ")}</p>}
          {href && !inactive && (
            <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-pitch-950">
              {label} ›
            </Link>
          )}
          {note && !inactive && <p className="text-xs text-muted">{note}</p>}
          {href && inactive && (
            <Link href={href} className="block text-center text-xs text-accent">
              Yine de sayfayı aç ›
            </Link>
          )}
          <div className="text-right text-[10px] text-muted">{time}</div>
        </div>
      </div>
    </div>
  );
}

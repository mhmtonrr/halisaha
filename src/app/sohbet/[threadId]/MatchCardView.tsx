import Link from "next/link";
import { TeamBadge } from "@/components/TeamBadge";
import { cx } from "@/components/ui";

/** Paylaşım anındaki özet (dm_messages.card) */
export interface MatchCard {
  type: "listing" | "poll" | "match";
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  starts_at: string;
  venue: string | null;
  needed?: number;
  positions?: string[];
  min_overall?: number | null;
  capacity?: number;
  opponent?: string | null;
  team_size?: number | null;
}

const TITLE: Record<MatchCard["type"], string> = { listing: "Oyuncu ilanı", poll: "Maç çağrısı", match: "Maç daveti" };
const POS: Record<string, string> = { GK: "Kaleci", DEF: "Defans", MID: "Orta saha", FWD: "Forvet" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Maça davet kartı: ilan / çağrı / planlı maç. Alıcı karttan ilgili sayfaya gider; özel grup içeriği üye olmayana açılmaz. */
export function MatchCardView({
  card,
  refId,
  status,
  isMember,
  mine,
  time,
}: {
  card: MatchCard;
  refId: string;
  /** Güncel durum (bilinmiyorsa undefined) */
  status?: string;
  isMember: boolean;
  mine: boolean;
  time: string;
}) {
  const closed = status !== undefined && (card.type === "match" ? status !== "planned" : status !== "open");
  const expired = new Date(card.starts_at).getTime() < Date.now();
  const inactive = closed || expired;

  let href: string | null = null;
  let label = "";
  let note = "";
  if (card.type === "listing") {
    href = `/ilan/${refId}`;
    label = isMember ? "İlanı gör" : "İlanı aç ve başvur";
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
    card.type === "listing" && card.needed ? `${card.needed} oyuncu aranıyor` : null,
    card.type === "listing" && card.positions?.length ? card.positions.map((p) => POS[p] ?? p).join(", ") : null,
    card.type === "listing" && card.min_overall ? `min. ${card.min_overall} rating` : null,
    card.type === "poll" && card.capacity ? `${card.capacity} kişilik kadro` : null,
    card.type === "match" && card.opponent ? `vs ${card.opponent}` : null,
    card.type === "match" && card.team_size ? `${card.team_size} kişilik` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={cx("my-2 flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("w-[88%] max-w-sm overflow-hidden rounded-2xl border bg-pitch-900", inactive ? "border-line opacity-80" : "border-accent/40")}>
        <div className="flex items-center gap-2 bg-accent/10 px-3 py-2">
          <span className="text-base">⚽</span>
          <span className="flex-1 text-xs font-bold uppercase tracking-wide text-accent">{TITLE[card.type]}</span>
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
            <dd>{when(card.starts_at)}</dd>
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

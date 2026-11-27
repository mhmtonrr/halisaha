import { Icon } from "@/components/Icon";
import Link from "next/link";
import { TeamBadge } from "@/components/TeamBadge";
import { cx } from "@/components/ui";
import { feeText, opponentLabel } from "@/lib/match-rules";

/** Paylaşım anındaki özet (dm_messages.card) */
export interface MatchCard {
  /** Eski çağrı kartları 0047'de silindi; tür hep "match" */
  type: "match";
  group_id: string;
  group_name: string;
  group_kind: "team" | "community";
  starts_at: string;
  venue: string | null;
  capacity?: number | null;
  /** Çağrının saati belli değil (starts_at sadece günü gösterir) */
  time_tbd?: boolean;
  opponent?: string | null;
  team_size?: number | null;
}

const title = () => "Maça davet";

/** Maç kartının güncel hali (match_overview): sayaç, durum, alıcının durumu */
export interface LiveMatch {
  status: string;
  roster: number;
  capacity: number | null;
  myStatus: string | null;
  playedAt: string;
  timeTbd: boolean;
  opponent?: string | null;
  pendingRival?: string | null;
  fee?: number | null;
  color?: string | null;
  logo?: string | null;
  /** Görüntüleyen, karşı tarafın bu maçtaki davetini geri çekebilir */
  canWithdraw?: boolean;
}

const MY: Record<string, string> = {
  in: "Kadrodasın",
  reserve: "Yedektesin",
  invited: "Davetlisin",
  pending: "Katılma isteğin onay bekliyor",
  declined: "Gelemem dedin",
};

const when = (iso: string, dayOnly?: boolean) =>
  dayOnly
    ? `${new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" })} · saat belli değil`
    : new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Kişiye özel maç daveti: alıcı karttan yanıtlar ve maça gider, gönderen daveti geri çeker; iptal edilen kart bağlantısız kalır (0056) */
export function MatchCardView({
  card,
  refId,
  status,
  mine,
  time,
  live,
  revoked,
  busy,
  onAnswer,
  onWithdraw,
}: {
  card: MatchCard;
  /** Grup/çağrı/maç silindiyse null */
  refId: string | null;
  /** Güncel durum (bilinmiyorsa undefined) */
  status?: string;
  mine: boolean;
  time: string;
  /** Maç kartında güncel bilgi (yoksa kart gönderim anındaki kopyayla çizilir) */
  live?: LiveMatch;
  revoked: boolean;
  busy: boolean;
  onAnswer: (accept: boolean) => void;
  onWithdraw: () => void;
}) {
  const closed = status !== undefined && !["planned", "gathering"].includes(status);
  const cancelled = status === "cancelled";
  // Saati belli olmayan çağrı gün bitene kadar geçerli
  const expired = new Date(live?.playedAt ?? card.starts_at).getTime() + ((live?.timeTbd ?? card.time_tbd) ? 24 * 3600_000 : 0) < Date.now();
  const inactive = revoked || closed || expired || !refId;
  const my = !mine && !inactive ? live?.myStatus : undefined;

  let href: string | null = null;
  let label = "";
  let note = "";
  if (!refId) {
    note = "Bu maç artık yok.";
  } else if (!revoked) {
    // Davetli üye olmasa da maçı ve kadroyu görür
    href = `/g/${card.group_id}/m/${refId}`;
    label = "Maça bak";
  }

  const details = [
    // Güncel bilgi varsa o; yoksa gönderim anındaki rakip
    live ? opponentLabel(live.opponent, live.pendingRival) : opponentLabel(card.opponent),
    card.type === "match" && card.team_size ? `${card.team_size}v${card.team_size}` : null,
    live?.fee ? feeText(live.fee) : null,
  ].filter(Boolean) as string[];

  return (
    <div className={cx("my-2 flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("w-[88%] max-w-sm overflow-hidden rounded-2xl border bg-pitch-900", inactive ? "border-line opacity-80" : "border-accent/40")}>
        <div className="flex items-center gap-2 bg-accent/10 px-3 py-2">
          <Icon name="sports_soccer" fill className="text-[18px] text-primary" />
          <span className="flex-1 text-xs font-bold uppercase tracking-wide text-accent">{title()}</span>
          {inactive && <span className="rounded-full bg-pitch-800 px-2 py-0.5 text-[10px] text-muted">{revoked ? "Davet iptal edildi" : cancelled ? "İptal edildi" : closed ? "Kapandı" : "Geçti"}</span>}
        </div>
        <div className="space-y-2 px-3 py-3">
          <div className="flex items-center gap-2.5">
            <TeamBadge id={card.group_id} name={card.group_name} color={live?.color ?? null} logo={live?.logo ?? null} size="sm" />
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
          {live && live.capacity && !inactive && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold tabular-nums">
                  {live.roster}/{live.capacity}
                </span>
                <span className={live.roster < live.capacity ? "text-amber-300" : "text-primary"}>
                  {live.roster < live.capacity ? `${live.capacity - live.roster} kişi aranıyor` : "Kadro tamam"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-pitch-800">
                <div className={cx("h-full rounded-full", live.roster < live.capacity ? "bg-amber-400" : "bg-primary")} style={{ width: `${Math.min(100, Math.round((live.roster / live.capacity) * 100))}%` }} />
              </div>
            </div>
          )}
          {!revoked && live?.myStatus && !mine && MY[live.myStatus] && <p className="text-xs font-semibold text-primary">{MY[live.myStatus]}</p>}
          {(my === "invited" || my === "declined") && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => onAnswer(true)} className={cx("min-h-11 rounded-xl bg-accent px-3 text-sm font-bold text-pitch-950 disabled:opacity-50", my === "declined" && "col-span-2")}>
                Geliyorum
              </button>
              {my === "invited" && (
                <button type="button" disabled={busy} onClick={() => onAnswer(false)} className="min-h-11 rounded-xl bg-pitch-800 px-3 text-sm font-semibold disabled:opacity-50">
                  Gelemem
                </button>
              )}
            </div>
          )}
          {href && !inactive && (
            // Yanıt beklerken asıl eylem "Geliyorum"; maç bağlantısı ikincil
            <Link href={href} className={cx("flex min-h-11 items-center justify-center rounded-xl px-4 text-sm", my === "invited" || my === "declined" ? "border border-line font-semibold text-accent" : "bg-accent font-bold text-pitch-950")}>
              {label} ›
            </Link>
          )}
          {note && <p className="text-xs text-muted">{note}</p>}
          {mine && !inactive && live?.canWithdraw && (
            <button type="button" disabled={busy} onClick={onWithdraw} className="block w-full rounded-lg bg-pitch-800 px-3 py-2 text-xs disabled:opacity-50">
              Daveti geri çek
            </button>
          )}
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

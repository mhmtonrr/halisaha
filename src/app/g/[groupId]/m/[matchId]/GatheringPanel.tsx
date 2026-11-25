import { Icon } from "@/components/Icon";
import { respondMatch } from "@/lib/match-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, cx } from "@/components/ui";

export type EntryStatus = "in" | "reserve" | "declined" | "left" | "invited" | "pending" | "rejected" | null;

const MY_STATUS: Partial<Record<NonNullable<EntryStatus>, { text: string; tone: string }>> = {
  in: { text: "Kadrodasın", tone: "text-primary" },
  reserve: { text: "Yedektesin; yer açılırsa kadroya alınırsın", tone: "text-amber-300" },
  declined: { text: "Gelemem dedin", tone: "text-muted" },
  invited: { text: "Bu maça çağrıldın", tone: "text-primary" },
  pending: { text: "Başvurun onay bekliyor", tone: "text-amber-300" },
  rejected: { text: "Başvurun kabul edilmedi", tone: "text-muted" },
  left: { text: "Kadrodan çıktın", tone: "text-muted" },
};

/**
 * Toplanan (ve kesin) maçın üst şeridi: canlı kadro sayacı, benim durumum, "Geliyorum / Gelemem".
 * canRespond: grup üyesi (duyuru açık) veya maçta kaydı olan (davetli, yedek, kadrodan çıkan...).
 */
export function GatheringPanel({
  groupId,
  matchId,
  status,
  roster,
  reserve,
  capacity,
  myStatus,
  canRespond,
  flash,
}: {
  groupId: string;
  matchId: string;
  status: "gathering" | "planned";
  roster: number;
  reserve: number;
  capacity: number;
  myStatus: EntryStatus;
  canRespond: boolean;
  flash?: string;
}) {
  const missing = Math.max(0, capacity - roster);
  const pct = Math.min(100, Math.round((roster / Math.max(1, capacity)) * 100));
  const mine = myStatus ? MY_STATUS[myStatus] : undefined;
  const waiting = myStatus === "pending" || myStatus === "rejected";
  const inRoster = myStatus === "in";
  // Kesin maçta kadrodan çıkış çekilme isteğiyle (aşağıdaki bölüm); burada sadece katılma
  const showNo = status === "gathering" && (inRoster || myStatus === "reserve" || myStatus === "invited" || myStatus === null);
  const showYes = !inRoster && myStatus !== "reserve";

  return (
    <Card className="mb-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display text-2xl font-bold tabular-nums">
          {roster}/{capacity}
        </div>
        <div className={cx("text-sm font-semibold", missing ? "text-amber-300" : "text-primary")}>
          {missing ? `${missing} kişi aranıyor` : "Kadro tamam"}
          {reserve > 0 && <span className="font-normal text-muted"> · {reserve} yedek</span>}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pitch-800" role="progressbar" aria-valuenow={roster} aria-valuemin={0} aria-valuemax={capacity} aria-label="Kadro doluluğu">
        <div className={cx("h-full rounded-full", missing ? "bg-amber-400" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>

      {flash && (
        <p className="flex items-center gap-1.5 rounded-xl bg-primary/10 p-2.5 text-sm text-primary">
          <Icon name="check_circle" fill className="text-[18px]" />
          {flash === "in" ? "Kadroya girdin." : flash === "reserve" ? "Kadro dolu; yedeğe yazıldın." : "Yanıtın kaydedildi."}
        </p>
      )}
      {mine && !flash && <p className={cx("text-sm font-semibold", mine.tone)}>{mine.text}</p>}

      {canRespond && !waiting && (showYes || showNo) && (
        <div className="grid grid-cols-2 gap-2">
          {showYes && (
            <form action={respondMatch} className={cx(!showNo && "col-span-2")}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="answer" value="yes" />
              <SubmitButton className="w-full" pendingLabel="Kaydediliyor…">
                {missing ? "Geliyorum" : "Geliyorum (yedek)"}
              </SubmitButton>
            </form>
          )}
          {showNo && (
            <form action={respondMatch} className={cx(!showYes && "col-span-2")}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="answer" value="no" />
              <SubmitButton variant="secondary" className="w-full" pendingLabel="Kaydediliyor…">
                Gelemem
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

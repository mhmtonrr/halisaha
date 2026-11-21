import Link from "next/link";
import { closeListing, createListing, decideApplication } from "@/lib/actions";
import { POSITIONS, POSITION_NAME, type Position } from "@/lib/data";
import { APPLICATION_STATUS, LISTING_STATUS, type Applicant, type Listing } from "@/lib/listings-data";
import { reliability } from "@/lib/reliability";
import { Badge, Card, Input, Label, cx } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { ShareLink } from "@/components/ShareLink";
import { SubmitButton } from "@/components/SubmitButton";

const TONE = { good: "text-accent", ok: "text-amber-300", bad: "text-red-300", new: "text-muted" } as const;

/**
 * Takımın maç ekranında "Oyuncu arıyoruz" bölümü (kaptan/yetkili): ilan aç, başvuranları rating, mevki ve
 * güvenilirlikle gör, tek tek kabul/ret. Kabul edilen oyuncu ödünç olarak maç kadrosuna girer.
 */
export function ListingSection({
  groupId,
  matchId,
  listing,
  applicants,
}: {
  groupId: string;
  matchId: string;
  listing: Listing | null;
  applicants: Applicant[];
}) {
  const hidden = (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
    </>
  );

  if (!listing || listing.status === "closed") {
    return (
      <form action={createListing} className="space-y-3">
        {hidden}
        <p className="text-xs text-muted">
          Eksik oyuncun mu var? İlan herkese açık yayınlanır (Keşfet ve takım sayfan), linkini gruplarda paylaşabilirsin. Başvuranları
          rating, mevki ve güvenilirlikleriyle görüp tek tek sen seçersin; seçtiğin oyuncu sadece bu maçın kadrosuna katılır.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label>Kaç oyuncu?</Label>
            <select name="needed" defaultValue="2" className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} oyuncu
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label hint="isteğe bağlı">Min. rating</Label>
            <Input type="number" name="minOverall" min={40} max={99} inputMode="numeric" placeholder="Örn. 60" />
          </label>
        </div>
        <div>
          <Label hint="isteğe bağlı">Aranan mevkiler</Label>
          <div className="flex flex-wrap gap-2">
            {POSITIONS.map((p) => (
              <label key={p} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-checked:border-accent has-checked:bg-accent/10">
                <input type="checkbox" name="positions" value={p} className="accent-accent" />
                {POSITION_NAME[p]}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <Label hint="isteğe bağlı">Not</Label>
          <textarea
            name="note"
            maxLength={300}
            rows={2}
            placeholder="Örn. Cuma akşamı halı saha, kişi başı 150 TL. Kaleci acil lazım!"
            className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </label>
        <SubmitButton className="w-full" pendingLabel="Yayınlanıyor…">
          🔎 İlanı yayınla
        </SubmitButton>
      </form>
    );
  }

  const status = LISTING_STATUS[listing.status];
  const pending = applicants.filter((a) => a.status === "pending");
  const accepted = applicants.filter((a) => a.status === "accepted");
  const past = applicants.filter((a) => a.status === "rejected" || a.status === "withdrawn");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="text-sm">
          <b>{listing.needed}</b> oyuncu aranıyor
          {listing.minOverall ? ` · en az ${listing.minOverall} rating` : ""}
        </span>
        {listing.positions.map((p) => (
          <PositionChip key={p} position={p as Position} />
        ))}
      </div>
      {listing.note && <p className="rounded-lg bg-pitch-950 p-2.5 text-sm text-muted">“{listing.note}”</p>}
      <div className="flex gap-2">
        <ShareLink path={`/ilan/${listing.id}`} title={`${listing.team.name}: oyuncu arıyoruz`} />
        {listing.status === "open" && (
          <form action={closeListing}>
            {hidden}
            <input type="hidden" name="listingId" value={listing.id} />
            <SubmitButton variant="secondary" className="min-h-9 px-3 text-sm" pendingLabel="Kapatılıyor…">
              İlanı kapat
            </SubmitButton>
          </form>
        )}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        Başvurular · {pending.length} bekliyor{accepted.length > 0 ? ` · ${accepted.length} alındı` : ""}
      </div>
      {pending.length === 0 && accepted.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-3 text-center text-sm text-muted">Henüz başvuru yok.</p>
      )}
      {pending.map((a) => {
        const rel = reliability(a.played, a.noShows);
        return (
          <Card key={a.userId} className="space-y-2 p-3">
            <div className="flex items-center gap-3">
              <OvrBadge overall={a.overall} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link href={`/oyuncu/${a.userId}`} className="truncate font-semibold hover:underline">
                    {a.name}
                  </Link>
                  <PositionChip position={a.position ?? a.preferredPosition} />
                </div>
                <div className={cx("text-xs", TONE[rel.tone])}>{rel.label}</div>
              </div>
            </div>
            {a.note && <p className="rounded-lg bg-pitch-950 p-2 text-sm text-muted">“{a.note}”</p>}
            <div className="grid grid-cols-2 gap-2">
              {(["accept", "reject"] as const).map((answer) => (
                <form key={answer} action={decideApplication}>
                  {hidden}
                  <input type="hidden" name="listingId" value={listing.id} />
                  <input type="hidden" name="userId" value={a.userId} />
                  <input type="hidden" name="answer" value={answer} />
                  <SubmitButton
                    variant={answer === "accept" ? "primary" : "secondary"}
                    className="min-h-10 w-full text-sm"
                    pendingLabel="…"
                    disabled={answer === "accept" && listing.status !== "open"}
                  >
                    {answer === "accept" ? "Kadroya al" : "Reddet"}
                  </SubmitButton>
                </form>
              ))}
            </div>
          </Card>
        );
      })}
      {accepted.map((a) => (
        <div key={a.userId} className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
          <OvrBadge overall={a.overall} className="h-8 w-8 text-xs" />
          <Link href={`/oyuncu/${a.userId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            {a.name}
          </Link>
          <Badge tone="accent">{APPLICATION_STATUS.accepted.label} · ödünç</Badge>
        </div>
      ))}
      {past.length > 0 && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer py-1">Reddedilen / geri çekilen · {past.length}</summary>
          <ul className="mt-1 space-y-1">
            {past.map((a) => (
              <li key={a.userId} className="flex items-center justify-between rounded-lg px-2 py-1">
                <Link href={`/oyuncu/${a.userId}`} className="hover:underline">
                  {a.name}
                </Link>
                <Badge>{APPLICATION_STATUS[a.status].label}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { POSITION_NAME, POSITIONS, type Position } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";
import { InviteBox } from "./InviteBox";
import {
  cancelMatch,
  closeListing,
  confirmMatch,
  counterChallenge,
  createListing,
  cancelInvite, decideApplication,
  rescheduleMatch,
  respondReschedule,
  unconfirmMatch,
} from "@/lib/match-manage-actions";

// Yeniden tasarım 4b: maç ekranının yönetim bölümleri (sadece maçı yönetene; misafir işleri kaptan/yetkiliye)


export interface EntryRow {
  userId: string | null;
  playerId: string | null;
  name: string;
  status: string;
  source: string;
  position: Position | null;
  note: string | null;
  overall: number;
}

const SOURCE: Record<string, string> = {
  listing: "ilandan",
  link: "bağlantıyla",
  invite: "kadrodan biri çağırdı",
  member: "üye",
  organizer: "yetkili yazdı",
  guest: "misafir",
};

function Hidden({ groupId, matchId }: { groupId: string; matchId: string }) {
  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
    </>
  );
}

/** İstanbul gün/saat (form varsayılanı) */
function dayTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString();
  return { day: d.slice(0, 10), time: d.slice(11, 16) };
}

/** Onay bekleyen başvurular (al/reddet) */
export function Applications({ groupId, matchId, entries, full }: { groupId: string; matchId: string; entries: EntryRow[]; full: boolean }) {
  const pending = entries.filter((e) => e.status === "pending");
  return (
    <>
      {pending.length > 0 && (
        <section id="basvurular" className="mb-4 space-y-2">
          <SectionTitle>Başvurular · {pending.length}</SectionTitle>
          {pending.map((e) => (
            <Card key={e.userId} className="space-y-2">
              {/* Başvurular hep hesaplıdır; karar vermeden önce profil incelenir */}
              <Link href={`/oyuncu/${e.userId}`} className="flex items-center gap-3">
                <OvrBadge overall={e.overall} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.name}</div>
                  <div className="truncate text-xs text-muted">
                    {SOURCE[e.source] ?? e.source}
                    {e.position ? ` · ${POSITION_NAME[e.position]}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold text-primary">Profili gör</span>
                <Icon name="chevron_right" className="shrink-0 text-[18px] text-muted" />
              </Link>
              {e.note && <p className="rounded-lg bg-pitch-900 px-3 py-1.5 text-sm text-on-surface-variant">“{e.note}”</p>}
              <div className="grid grid-cols-2 gap-2">
                {(["1", "0"] as const).map((a) => (
                  <form key={a} action={decideApplication}>
                    <Hidden groupId={groupId} matchId={matchId} />
                    <input type="hidden" name="userId" value={e.userId ?? ""} />
                    <input type="hidden" name="accept" value={a} />
                    <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="w-full" pendingLabel="…">
                      {a === "1" ? (full ? "Yedeğe al" : "Kadroya al") : "Reddet"}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </Card>
          ))}
        </section>
      )}

    </>
  );
}

/** Takım dışından davet edilenler: yanıt bekleyen ve "gelemem" diyen; davet geri çekilince maçı göremez */
export function Invitees({ groupId, matchId, entries }: { groupId: string; matchId: string; entries: EntryRow[] }) {
  if (!entries.length) return null;
  return (
    <section className="mb-4">
      <SectionTitle>Davetliler · {entries.length}</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.userId} className="flex min-h-14 items-center gap-2.5 px-3 py-2">
              <Link href={`/oyuncu/${e.userId}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                <OvrBadge overall={e.overall} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted">{e.status === "declined" ? "Gelemem dedi" : "Yanıt bekleniyor"}</span>
                </span>
              </Link>
              <form action={cancelInvite}>
                <Hidden groupId={groupId} matchId={matchId} />
                <input type="hidden" name="userId" value={e.userId ?? ""} />
                <SubmitButton variant="secondary" pendingLabel="…">
                  Daveti geri çek
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Adam ara: Keşfet/grup ilanı, açık ilanlar, paylaşılabilir bağlantı */
export function ListingManage({
  groupId,
  matchId,
  listings,
  targets,
  code,
  full,
}: {
  groupId: string;
  matchId: string;
  listings: { id: string; targetName: string | null; status: string }[];
  targets: { id: string; name: string }[];
  code: string | null;
  full: boolean;
}) {
  const open = listings.filter((l) => l.status === "active" || l.status === "pending");
  const hasPublic = open.some((l) => l.targetName === null);
  const places = [...(hasPublic ? [] : [{ id: "kesfet", name: "Keşfet (herkese açık)" }]), ...targets];
  return (
    <section className="mb-4 space-y-2">
      <SectionTitle>Adam ara</SectionTitle>
      <Card className="space-y-3">
        {open.length > 0 && (
          <ul className="space-y-1.5">
            {open.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-lg bg-pitch-900 px-3 py-2 text-sm">
                <Icon name={l.targetName ? "groups" : "travel_explore"} className="text-[18px] text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  {l.targetName ?? "Keşfet (herkese açık)"}
                  {l.status === "pending" && <span className="text-amber-300"> · onay bekliyor</span>}
                </span>
                <form action={closeListing}>
                  <Hidden groupId={groupId} matchId={matchId} />
                  <input type="hidden" name="listingId" value={l.id} />
                  <button className="text-muted" aria-label="İlanı kapat">
                    <Icon name="close" className="text-[18px]" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {full && <p className="text-xs text-muted">Kadro dolu: ilanlar Keşfet listesinden düşer, yer açılınca geri gelir.</p>}
        {places.length === 0 ? (
          <p className="text-xs text-muted">Paylaşabileceğin her yerde açık ilan var.</p>
        ) : (
          <form action={createListing} className="space-y-2">
            <Hidden groupId={groupId} matchId={matchId} />
            <details className="rounded-xl border border-line bg-pitch-950">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold">
                <Icon name="checklist" className="text-[20px]" />
                Paylaşılacak yerleri seç
                <Icon name="expand_more" className="ml-auto text-[20px] text-muted" />
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {places.map((t) => (
                  <li key={t.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm has-checked:bg-accent/10">
                      <input type="checkbox" name="targets" value={t.id} className="h-4 w-4 accent-accent" />
                      <Icon name={t.id === "kesfet" ? "travel_explore" : "groups"} className="text-[18px] text-primary" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex flex-wrap gap-1.5">
              {POSITIONS.map((p) => (
                <label key={p} className="flex min-h-9 cursor-pointer items-center rounded-full border border-line px-3 text-sm has-checked:border-accent has-checked:bg-accent/10">
                  <input type="checkbox" name="positions" value={p} className="sr-only" />
                  {POSITION_NAME[p]}
                </label>
              ))}
            </div>
            <Input name="note" maxLength={200} placeholder="Not (isteğe bağlı): örn. kaleci şart" aria-label="İlan notu" />
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Paylaşılıyor…">
              Adam ara
            </SubmitButton>
            <p className="text-xs text-muted">İlan seçtiğin yerlerin hepsinde paylaşılır. Gelen istekler senin onayına düşer; yetkili olmadığın grupta ilan önce o grubun onayına gider.</p>
          </form>
        )}
        {code && <InviteBox groupId={groupId} matchId={matchId} code={code} />}
      </Card>
    </section>
  );
}

/** Karşı teklif formu (maç ekranı ve teklifler sayfası) */
export function CounterForm({ groupId, challengeId, back, at }: { groupId: string; challengeId: string; back: string; at: string }) {
  const d = dayTime(at);
  return (
    <details className="rounded-xl border border-line">
      <summary className="flex min-h-10 cursor-pointer items-center px-3 text-sm font-semibold">Karşı teklif yap</summary>
      <form action={counterChallenge} className="space-y-2 p-3 pt-0">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="challengeId" value={challengeId} />
        <input type="hidden" name="back" value={back} />
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" name="day" defaultValue={d.day} required aria-label="Önerilen gün" />
          <Input type="time" name="time" defaultValue={d.time} aria-label="Önerilen saat (boşsa belli değil)" />
        </div>
        <Input name="venue" maxLength={80} placeholder="Saha (isteğe bağlı)" aria-label="Önerilen saha" />
        <SubmitButton variant="secondary" className="w-full" pendingLabel="Gönderiliyor…">
          Karşı teklifi gönder
        </SubmitButton>
      </form>
    </details>
  );
}

/** Kesinleştir (toplanırken), ertele, iptal; bağlı maçta tarih değişikliği rakibin onayına */
export function ScheduleManage({
  groupId,
  matchId,
  status,
  playedAt,
  timeTbd,
  linked,
  confirmed,
  reschedule,
  rosterCount,
  minPlayers,
}: {
  groupId: string;
  matchId: string;
  status: "gathering" | "planned";
  playedAt: string;
  timeTbd: boolean;
  linked: boolean;
  /** Bağlı maçta tarafların kadro onayı */
  confirmed: { mine: boolean; rival: boolean };
  reschedule: { challengeId: string; at: string; tbd: boolean; awaitingMe: boolean } | null;
  rosterCount: number;
  minPlayers: number;
}) {
  const d = dayTime(playedAt);
  return (
    <section className="mb-4 space-y-2">
      {reschedule && (
        <Card className="space-y-2 border-amber-400/40 bg-amber-400/10">
          <p className="text-sm">
            {reschedule.awaitingMe ? "Rakip tarih değişikliği önerdi: " : "Tarih değişikliği rakibin onayını bekliyor: "}
            <b>{matchWhen(reschedule.at, reschedule.tbd)}</b>
          </p>
          {reschedule.awaitingMe && (
            <div className="grid grid-cols-2 gap-2">
              {(["1", "0"] as const).map((a) => (
                <form key={a} action={respondReschedule}>
                  <Hidden groupId={groupId} matchId={matchId} />
                  <input type="hidden" name="challengeId" value={reschedule.challengeId} />
                  <input type="hidden" name="accept" value={a} />
                  <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="w-full" pendingLabel="…">
                    {a === "1" ? "Onayla" : "Reddet"}
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
        </Card>
      )}

      {status === "gathering" && linked && confirmed.mine && (
        <Card className="space-y-2">
          <div className="font-semibold">Rakibin onayı bekleniyor</div>
          <p className="text-xs text-muted">Kadronu onayladın. Rakip de onaylayınca maç kesinleşir ve iki kadroya bildirim gider.</p>
          <form action={unconfirmMatch}>
            <Hidden groupId={groupId} matchId={matchId} />
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Geri alınıyor…">
              Onayı geri al
            </SubmitButton>
          </form>
        </Card>
      )}

      {status === "gathering" && !(linked && confirmed.mine) && (
        <Card className="space-y-2">
          <div className="font-semibold">{linked ? "Kadro onayı" : "Maçı kesinleştir"}</div>
          <p className="text-xs text-muted">
            {!linked
              ? "Kadro eksik olsa da kesinleşir. Kadrodakilere 'Maç kesinleşti' bildirimi gider."
              : timeTbd
                ? "Saat belli değil: onaylamadan önce aşağıdan rakibe tarih ve saat öner."
                : confirmed.rival
                  ? "Rakip hazır; sen de onaylayınca maç kesinleşir. Saati değiştirmek için aşağıdan tarih öner."
                  : "Maç iki takım da onaylayınca kesinleşir. Saati değiştirmek için aşağıdan tarih öner."}
          </p>
          <form action={confirmMatch} className="space-y-2">
            <Hidden groupId={groupId} matchId={matchId} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" name="day" defaultValue={d.day} required aria-label="Maç günü" readOnly={linked} />
              <Input type="time" name="time" defaultValue={timeTbd ? "" : d.time} required aria-label="Maç saati" readOnly={linked} />
            </div>
            <SubmitButton className="w-full" disabled={rosterCount < minPlayers || (linked && timeTbd)} pendingLabel={linked ? "Onaylanıyor…" : "Kesinleşiyor…"}>
              {rosterCount < minPlayers
                ? `Kesinleştirmek için en az ${minPlayers} kişi`
                : !linked
                  ? "Maçı kesinleştir"
                  : confirmed.rival
                    ? "Onayla ve maçı kesinleştir"
                    : "Kadromuz hazır"}
            </SubmitButton>
          </form>
        </Card>
      )}

      <details className="rounded-2xl border border-line bg-surface-container">
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold">
          <Icon name="event_repeat" className="text-[20px]" />
          {linked ? "Tarih değişikliği öner" : "Ertele"}
        </summary>
        <form action={rescheduleMatch} className="space-y-2 px-4 pb-4">
          <Hidden groupId={groupId} matchId={matchId} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" name="day" defaultValue={d.day} required aria-label="Yeni gün" />
            <Input type="time" name="time" defaultValue={timeTbd ? "" : d.time} aria-label="Yeni saat" />
          </div>
          {status === "gathering" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="timeMode" value="tbd" className="accent-accent" />
              Saat belli değil
            </label>
          )}
          {linked && <Input name="venue" maxLength={80} placeholder="Saha (değişiyorsa)" aria-label="Yeni saha" />}
          <p className="text-xs text-muted">
            Kadro korunur, herkese bildirim gider.{status === "planned" ? " Gelemeyecek olan 24 saat içinde onaysız çıkabilir." : ""}
          </p>
          <SubmitButton variant="secondary" className="w-full" pendingLabel="Kaydediliyor…">
            {linked ? "Rakibe öner" : "Ertele"}
          </SubmitButton>
        </form>
      </details>

      <details className="rounded-2xl border border-red-500/30 bg-surface-container">
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold text-red-300">
          <Icon name="event_busy" className="text-[20px]" />
          Maçı iptal et
        </summary>
        <form action={cancelMatch} className="space-y-2 px-4 pb-4">
          <Hidden groupId={groupId} matchId={matchId} />
          <Input name="reason" maxLength={200} placeholder="Sebep (isteğe bağlı): örn. saha kapalı" aria-label="İptal sebebi" />
          <p className="text-xs text-muted">
            Maç silinmez, &quot;İptal edildi&quot; olarak kalır. Kadro, yedek ve davetlilere bildirim gider{linked ? "; rakip takımın maçı da iptal olur" : ""}.
          </p>
          <SubmitButton variant="secondary" className="w-full border-red-500/40 text-red-300" pendingLabel="İptal ediliyor…">
            İptal et
          </SubmitButton>
        </form>
      </details>
    </section>
  );
}

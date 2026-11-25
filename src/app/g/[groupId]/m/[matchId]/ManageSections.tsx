import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, Input, Label, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { POSITION_NAME, POSITIONS, type Position } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";
import { InviteBox } from "./InviteBox";
import { RivalChooser } from "./RivalChooser";
import {
  answerChallenge,
  cancelMatch,
  closeListing,
  confirmMatch,
  counterChallenge,
  createListing,
  decideApplication,
  manageEntry,
  removeGuest,
  rescheduleMatch,
  respondReschedule,
  setMatchFee,
} from "@/lib/match-manage-actions";

// Yeniden tasarım 4b: maç ekranının yönetim bölümleri (sadece maçı yönetene; misafir işleri kaptan/yetkiliye)

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";
const smallBtn = "min-h-9 shrink-0 rounded-lg px-3 text-sm font-bold";

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

/** Kadro (çıkar), yedek (kadroya al), başvurular (al/reddet), davetliler, kesin gelen ekle */
export function RosterManage({
  groupId,
  matchId,
  roster,
  entries,
  addable,
  isAdmin,
  full,
}: {
  groupId: string;
  matchId: string;
  roster: { id: string; userId: string | null; name: string; overall: number; position: Position | null }[];
  entries: EntryRow[];
  addable: { userId: string; name: string }[];
  isAdmin: boolean;
  full: boolean;
}) {
  const reserve = entries.filter((e) => e.status === "reserve");
  const pending = entries.filter((e) => e.status === "pending");
  const invited = entries.filter((e) => e.status === "invited");
  return (
    <>
      <SectionTitle>Kadro · {roster.length}</SectionTitle>
      <Card className="mb-4 p-0">
        {roster.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">Henüz kimse yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {roster.map((r) => (
              <li key={r.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                <OvrBadge overall={r.overall} />
                <Link href={`/g/${groupId}/p/${r.id}`} className="min-w-0 flex-1 truncate">
                  {r.name}
                </Link>
                {!r.userId && <span className="text-xs text-muted">misafir</span>}
                <PositionChip position={r.position} />
                {r.userId ? (
                  <form action={manageEntry}>
                    <Hidden groupId={groupId} matchId={matchId} />
                    <input type="hidden" name="userId" value={r.userId} />
                    <input type="hidden" name="op" value="remove" />
                    <button className="text-muted" aria-label={`${r.name} kadrodan çıkar`}>
                      <Icon name="person_remove" className="text-[20px]" />
                    </button>
                  </form>
                ) : (
                  isAdmin && (
                    <form action={removeGuest}>
                      <Hidden groupId={groupId} matchId={matchId} />
                      <input type="hidden" name="playerId" value={r.id} />
                      <button className="text-muted" aria-label={`${r.name} misafirini çıkar`}>
                        <Icon name="person_remove" className="text-[20px]" />
                      </button>
                    </form>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pending.length > 0 && (
        <section id="basvurular" className="mb-4 space-y-2">
          <SectionTitle>Başvurular · {pending.length}</SectionTitle>
          {pending.map((e) => (
            <Card key={e.userId} className="space-y-2">
              <div className="flex items-center gap-3">
                <OvrBadge overall={e.overall} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.name}</div>
                  <div className="truncate text-xs text-muted">
                    {SOURCE[e.source] ?? e.source}
                    {e.position ? ` · ${POSITION_NAME[e.position]}` : ""}
                  </div>
                </div>
              </div>
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

      {reserve.length > 0 && (
        <>
          <SectionTitle>Yedek · {reserve.length}</SectionTitle>
          <Card className="mb-4 p-0">
            <ol className="divide-y divide-line">
              {reserve.map((e, i) => (
                <li key={e.userId} className="flex min-h-12 items-center gap-3 px-4 py-2">
                  <span className="w-5 text-center text-sm font-bold text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <form action={manageEntry}>
                    <Hidden groupId={groupId} matchId={matchId} />
                    <input type="hidden" name="userId" value={e.userId ?? ""} />
                    <input type="hidden" name="op" value="promote" />
                    <button disabled={full} className={cx(smallBtn, full ? "bg-pitch-800 text-muted" : "bg-accent text-pitch-950")}>
                      Kadroya al
                    </button>
                  </form>
                  <form action={manageEntry}>
                    <Hidden groupId={groupId} matchId={matchId} />
                    <input type="hidden" name="userId" value={e.userId ?? ""} />
                    <input type="hidden" name="op" value="remove" />
                    <button className="text-muted" aria-label={`${e.name} yedekten çıkar`}>
                      <Icon name="close" className="text-[20px]" />
                    </button>
                  </form>
                </li>
              ))}
            </ol>
            {full && <p className="px-4 pb-3 text-xs text-muted">Kadro dolu; yer açılınca kadroya alabilirsin. Maça 3 saat kala boş yer kalırsa sıradaki otomatik alınır.</p>}
          </Card>
        </>
      )}

      {invited.length > 0 && (
        <p className="mb-4 px-1 text-sm text-muted">
          Davet bekleyen: {invited.map((e) => e.name).join(", ")}
        </p>
      )}

      {!full && addable.length > 0 && (
        <form action={manageEntry} className="mb-4 flex gap-2">
          <Hidden groupId={groupId} matchId={matchId} />
          <input type="hidden" name="op" value="add" />
          <select name="userId" aria-label="Kesin gelen üye" className={cx(selectCls, "flex-1")} required defaultValue="">
            <option value="" disabled>
              Kesin gelen üye ekle…
            </option>
            {addable.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
          <SubmitButton variant="secondary" className="shrink-0 px-4" pendingLabel="…">
            Ekle
          </SubmitButton>
        </form>
      )}
    </>
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
            <SubmitButton variant="secondary" className="w-full" pendingLabel="Ekleniyor…">
              Ekle
            </SubmitButton>
            <p className="text-xs text-muted">İlan seçtiğin yerlerin hepsinde paylaşılır. Gelen istekler senin onayına düşer; yetkili olmadığın grupta ilan önce o grubun onayına gider.</p>
          </form>
        )}
        {code && <InviteBox groupId={groupId} matchId={matchId} code={code} />}
      </Card>
    </section>
  );
}

/** Rakip: isim veya uygulamadaki takıma teklif; bekleyen teklif (sıra/kabul/ret/karşı teklif) */
export function RivalManage({
  groupId,
  matchId,
  opponentName,
  challenge,
  homeCity,
}: {
  groupId: string;
  matchId: string;
  opponentName: string | null;
  challenge: { id: string; toName: string; awaitingMe: boolean; proposedAt: string; proposedTbd: boolean; venue: string | null } | null;
  homeCity: string;
}) {
  const back = `/g/${groupId}/m/${matchId}`;
  return (
    <section className="mb-4 space-y-2">
      <SectionTitle>Rakip</SectionTitle>
      <Card className="space-y-3">
        {challenge ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Icon name="swords" className="text-[18px] text-primary" />
              <span className="min-w-0 flex-1">
                <b>{challenge.toName}</b> ile teklif · {matchWhen(challenge.proposedAt, challenge.proposedTbd)}
                {challenge.venue ? ` · ${challenge.venue}` : ""}
              </span>
            </div>
            {challenge.awaitingMe ? (
              <>
                <p className="text-sm text-amber-300">Rakip karşı teklif yaptı; kabul edersen maç bu tarihe geçer.</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["1", "0"] as const).map((a) => (
                    <form key={a} action={answerChallenge}>
                      <Hidden groupId={groupId} matchId={matchId} />
                      <input type="hidden" name="challengeId" value={challenge.id} />
                      <input type="hidden" name="accept" value={a} />
                      <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="w-full" pendingLabel="…">
                        {a === "1" ? "Kabul et" : "Reddet"}
                      </SubmitButton>
                    </form>
                  ))}
                </div>
                <CounterForm groupId={groupId} challengeId={challenge.id} back={back} at={challenge.proposedAt} />
              </>
            ) : (
              <p className="text-sm text-muted">Sıra rakipte: kabul, ret veya karşı teklif bekleniyor.</p>
            )}
          </div>
        ) : (
          <RivalChooser groupId={groupId} matchId={matchId} opponentName={opponentName} homeCity={homeCity} />
        )}
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

/** Saha ücretini sonradan ekle/değiştir/kaldır */
export function FeeManage({ groupId, matchId, fee }: { groupId: string; matchId: string; fee: number | null }) {
  return (
    <details className="mb-4 rounded-2xl border border-line bg-surface-container">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold">
        <Icon name="payments" className="text-[20px]" />
        Saha ücreti
        <span className="ml-auto text-sm font-normal text-muted">{fee ? `${fee} TL` : "belirtilmedi"}</span>
      </summary>
      <form action={setMatchFee} className="space-y-2 px-4 pb-4">
        <Hidden groupId={groupId} matchId={matchId} />
        <div className="flex gap-2">
          <Input key={fee ?? ""} name="fee" inputMode="numeric" pattern="[0-9]*" maxLength={6} defaultValue={fee ?? ""} placeholder="Kişi başı TL" aria-label="Kişi başı saha ücreti" />
          <SubmitButton variant="secondary" className="shrink-0" pendingLabel="…">
            Kaydet
          </SubmitButton>
        </div>
        <p className="text-xs text-muted">Kişi başı tutar. Boş bırakıp kaydedersen ücret kaldırılır.</p>
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

      {status === "gathering" && (
        <Card className="space-y-2">
          <div className="font-semibold">Maçı kesinleştir</div>
          <p className="text-xs text-muted">
            {linked
              ? "Rakiple anlaşılan saatle kesinleşir; saati değiştirmek için aşağıdan tarih öner."
              : "Kadro eksik olsa da kesinleşir. Kadrodakilere 'Maç kesinleşti' bildirimi gider."}
          </p>
          <form action={confirmMatch} className="space-y-2">
            <Hidden groupId={groupId} matchId={matchId} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" name="day" defaultValue={d.day} required aria-label="Maç günü" readOnly={linked} />
              <Input type="time" name="time" defaultValue={timeTbd ? "" : d.time} required aria-label="Maç saati" readOnly={linked && !timeTbd} />
            </div>
            <SubmitButton className="w-full" disabled={rosterCount < minPlayers} pendingLabel="Kesinleşiyor…">
              {rosterCount < minPlayers ? `Kesinleştirmek için en az ${minPlayers} kişi` : "Maçı kesinleştir"}
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

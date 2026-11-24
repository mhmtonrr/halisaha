import { Icon } from "@/components/Icon";
import Link from "next/link";
import { finalizePoll } from "@/lib/call-actions";
import { isoToTime, type Responder } from "@/lib/call-rules";
import type { Call, PollGuest } from "@/lib/calls-data";
import { SIZES } from "@/lib/formations";
import { Card, Input, Label, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { GuestRow, ResponderRow } from "./ResponderRow";

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";

/**
 * Kadroyu kesinleştir: "geliyorum" ve "belki" diyenler listelenir, ilk gelenler (kontenjan kadar) işaretli gelir.
 * Grupta sadece kendi aramızda; takımda sadece rakibe karşı (o takımın adına) maç kurulur.
 */
export function FinalizeForm({
  groupId,
  call,
  candidates,
  guests,
  preselected,
  isCommunity,
}: {
  groupId: string;
  call: Call;
  candidates: Responder[];
  guests: PollGuest[];
  preselected: Set<string>;
  isCommunity: boolean;
}) {
  return (
    <form action={finalizePoll} className="space-y-4">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="pollId" value={call.id} />
      <Card className="space-y-4 border-accent/40">
        <div className="text-sm font-semibold">Kadroyu kesinleştir</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label>Gün</Label>
            <Input type="date" name="day" defaultValue={call.play_on} required />
          </label>
          <label className="block">
            <Label>Saat</Label>
            <Input type="time" name="time" defaultValue={isoToTime(call.starts_at)} required />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label>Saha</Label>
            <Input name="venue" maxLength={80} defaultValue={call.venue ?? ""} />
          </label>
          <label className="block">
            <Label hint="her takım">Kaç kişilik?</Label>
            <select name="size" defaultValue={call.team_size ?? ""} className={selectCls}>
              <option value="">Belli değil</option>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}v{n}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isCommunity ? (
          <div className="space-y-1 text-sm">
            <input type="hidden" name="kind" value="internal" />
            <div>
              <b>Kendi aramızda</b> <span className="text-muted">· seçilenler iki dengeli tarafa bölünür</span>
            </div>
            <p className="text-xs text-muted">
              Rakip maçı mı yapacaksınız? Rakibe karşı maçlar takımdan açılır.{" "}
              <Link href="/takim-kur" className="text-accent underline">
                Takım kur ›
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <input type="hidden" name="kind" value="external" />
            <input type="hidden" name="teamId" value={groupId} />
            <label className="block">
              <Label hint="uygulamada olmasa da">Rakip adı</Label>
              <Input name="opponent" maxLength={60} placeholder="Örn. Yıldızspor" />
            </label>
            <p className="text-xs text-muted">Takımda olmayan seçilenler maça ödünç oyuncu olarak yazılır.</p>
          </div>
        )}
      </Card>

      <SectionTitle>Kimler oynayacak? · {preselected.size + guests.length} işaretli</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">İlk gelenler ve misafirler işaretli geldi. İşaretlenmeyen &quot;geliyorum&quot;cular yedek olur. Kaleciyi eldiven kutusuyla işaretle.</p>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {candidates.map((r) => (
            <ResponderRow key={r.user_id} r={r}>
              {r.answer === "maybe" && <span className="text-xs text-amber-300">belki</span>}
              <label className="flex items-center gap-1 text-xs text-muted" title="Kaleci">
                <input type="checkbox" name="gk" value={r.user_id} defaultChecked={(r.chosen_position ?? r.preferred_position) === "GK"} />
                <Icon name="front_hand" className="text-[16px]" />
              </label>
              <input
                type="checkbox"
                name="players"
                value={r.user_id}
                defaultChecked={preselected.has(r.user_id)}
                aria-label={`${r.display_name} oynasın`}
                className="h-5 w-5"
              />
            </ResponderRow>
          ))}
          {guests.map((g) => (
            <GuestRow key={g.id} g={g}>
              <label className="flex items-center gap-1 text-xs text-muted" title="Kaleci">
                <input type="checkbox" name="gk" value={g.id} defaultChecked={g.position === "GK"} />
                <Icon name="front_hand" className="text-[16px]" />
              </label>
              <input type="checkbox" name="guests" value={g.id} defaultChecked aria-label={`${g.name} oynasın`} className="h-5 w-5" />
            </GuestRow>
          ))}
        </ul>
      </Card>
      <SubmitButton className="w-full" pendingLabel="Maç kuruluyor…">
        Kadroyu kesinleştir ve maçı kur
      </SubmitButton>
      <p className="text-center text-xs">
        <Link href={`/g/${groupId}/cagri/${call.id}`} className="text-muted underline">
          Vazgeç
        </Link>
      </p>
    </form>
  );
}

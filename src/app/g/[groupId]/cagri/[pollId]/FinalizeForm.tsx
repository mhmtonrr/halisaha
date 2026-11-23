import Link from "next/link";
import { finalizePoll } from "@/lib/call-actions";
import { isoToTime, type Responder } from "@/lib/call-rules";
import type { Call, ManagedTeam } from "@/lib/calls-data";
import { SIZES } from "@/lib/formations";
import { Card, Input, Label, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ResponderRow } from "./ResponderRow";

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";

/**
 * Kadroyu kesinleştir: "geliyorum" ve "belki" diyenler listelenir, ilk gelenler (kontenjan kadar) işaretli gelir.
 * Kendi aramızda (sadece toplulukta) veya rakibe karşı (maç açabildiğim bir takımda) maç kurulur.
 */
export function FinalizeForm({
  groupId,
  call,
  candidates,
  preselected,
  isCommunity,
  teams,
}: {
  groupId: string;
  call: Call;
  candidates: Responder[];
  preselected: Set<string>;
  isCommunity: boolean;
  teams: ManagedTeam[];
}) {
  // Takımın kendi çağrısında maç o takımda ve rakibe karşı kurulur; toplulukta takımlarım + hızlı takım
  const teamChoices: ManagedTeam[] = isCommunity ? teams : [{ id: groupId, name: "Bu takım", temporary: false, archived: false }];
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

        <fieldset className="space-y-2">
          <Label>Maç türü</Label>
          {isCommunity && (
            <label className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm has-checked:border-accent has-checked:bg-accent/10">
              <input type="radio" name="kind" value="internal" defaultChecked />
              <span>
                <b>Kendi aramızda</b> <span className="text-muted">· taraflar dengeli bölünür</span>
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm has-checked:border-accent has-checked:bg-accent/10">
            <input type="radio" name="kind" value="external" defaultChecked={!isCommunity} />
            <span>
              <b>Rakibe karşı</b> <span className="text-muted">· takımın adına; takımda olmayanlar ödünç yazılır</span>
            </span>
          </label>
          {(
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Label>Takım</Label>
                <select name="teamId" defaultValue={teamChoices[0]?.id ?? "__new"} className={selectCls}>
                  {teamChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.temporary ? (t.archived ? " (geçici, yeniden aç)" : " (geçici)") : ""}
                    </option>
                  ))}
                  {isCommunity && <option value="__new">+ Hızlı takım kur</option>}
                </select>
              </label>
              <label className="block">
                <Label hint="uygulamada olmasa da">Rakip adı</Label>
                <Input name="opponent" maxLength={60} placeholder="Örn. Yıldızspor" />
              </label>
              {isCommunity && (
                <label className="col-span-2 block">
                  <Label hint="sadece “Hızlı takım kur” seçiliyse">Hızlı takımın adı</Label>
                  <Input name="newTeam" maxLength={60} placeholder="Örn. Cuma Ekibi" />
                  <span className="mt-1 block text-xs text-muted">
                    Geçici takım: Keşfet&apos;te görünmez, son maçı bitince kendiliğinden arşivlenir. İstersen sonra kalıcı yaparsın.
                  </span>
                </label>
              )}
            </div>
          )}
        </fieldset>
      </Card>

      <SectionTitle>Kimler oynayacak? · {preselected.size} işaretli</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-muted">İlk gelenler işaretli geldi. İşaretlenmeyen &quot;geliyorum&quot;cular yedek olur. Kaleciyi 🧤 ile işaretle.</p>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {candidates.map((r) => (
            <ResponderRow key={r.user_id} r={r}>
              {r.answer === "maybe" && <span className="text-xs text-amber-300">belki</span>}
              <label className="flex items-center gap-1 text-xs text-muted" title="Kaleci">
                <input type="checkbox" name="gk" value={r.user_id} defaultChecked={(r.chosen_position ?? r.preferred_position) === "GK"} />
                🧤
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

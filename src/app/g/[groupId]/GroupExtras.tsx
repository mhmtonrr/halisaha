import { cancelProposal, decideProposal, proposeMatch } from "@/lib/call-actions";
import { setGroupMuted, teamLifecycle } from "@/lib/actions";
import { callWhen, istanbulDate } from "@/lib/call-rules";
import { Card, Input, Label, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export interface Proposal {
  id: string;
  proposed_by: string;
  play_on: string;
  starts_at: string | null;
  venue: string | null;
  note: string | null;
}

function Hidden({ groupId }: { groupId: string }) {
  return <input type="hidden" name="groupId" value={groupId} />;
}

/** Dağıtılmış / geçici takım şeridi (kaptana yeniden aç / kalıcı yap) */
export function TeamStateBanner({ groupId, archived, temporary, isCaptain }: { groupId: string; archived: boolean; temporary: boolean; isCaptain: boolean }) {
  if (!archived && !temporary) return null;
  return (
    <Card className={archived ? "mb-4 border-line bg-pitch-900 text-sm" : "mb-4 border-amber-400/40 bg-amber-400/10 text-sm"}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{archived ? "📦" : "⏳"}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{archived ? "Bu takım dağıtıldı" : "Geçici takım"}</div>
          <div className="text-xs text-muted">
            {archived
              ? "Maç geçmişi ve puanlar duruyor; yeni maç, teklif ve katılım kapalı."
              : "Keşfet'te görünmez; son maçı bitince kendiliğinden arşivlenir."}
          </div>
        </div>
        {isCaptain && (
          <form action={teamLifecycle}>
            <Hidden groupId={groupId} />
            <input type="hidden" name="op" value={archived && !temporary ? "reopen" : "permanent"} />
            <SubmitButton variant="secondary" className="min-h-9 px-3 text-xs" pendingLabel="…">
              {archived && !temporary ? "Yeniden aç" : "Kalıcı yap"}
            </SubmitButton>
          </form>
        )}
      </div>
    </Card>
  );
}

/** Grubu kendi için sessize al: toplu duyurular gelmez, sana özel bildirimler gelir */
export function MuteToggle({ groupId, muted }: { groupId: string; muted: boolean }) {
  return (
    <form action={setGroupMuted} className="mb-2 text-right">
      <Hidden groupId={groupId} />
      <input type="hidden" name="muted" value={muted ? "0" : "1"} />
      <button
        className="text-xs text-muted hover:text-white"
        title={muted ? "Yeni çağrı ve sohbet bildirimleri tekrar gelsin" : "Yeni çağrı ve sohbet bildirimleri gelmesin; sana özel bildirimler (kadro, oylama) yine gelir"}
      >
        {muted ? "🔕 Sessizde · sesi aç" : "🔔 Sessize al"}
      </button>
    </form>
  );
}

/**
 * Maç önerileri. Üye: "Maç öner" formu ve bekleyen kendi önerisi. Maç açabilen: bekleyen öneriler (onayla → öneren adına çağrı).
 */
export function Proposals({
  groupId,
  canCreate,
  isMember,
  proposals,
  names,
  userId,
  openForm,
  sent,
}: {
  groupId: string;
  canCreate: boolean;
  isMember: boolean;
  proposals: Proposal[];
  names: Map<string, string>;
  userId: string;
  openForm: boolean;
  sent: boolean;
}) {
  const mine = proposals.find((p) => p.proposed_by === userId);
  const others = canCreate ? proposals : [];
  if (!isMember) return null;
  const today = istanbulDate();
  const max = istanbulDate(Date.now() + 30 * 86400_000);
  return (
    <div id="oneriler">
      {others.length > 0 && (
        <>
          <SectionTitle>💡 Maç önerileri · {others.length}</SectionTitle>
          <div className="space-y-2">
            {others.map((p) => (
              <Card key={p.id} className="space-y-2 p-3">
                <div className="text-sm">
                  <b>{names.get(p.proposed_by) ?? "Bir üye"}</b> öneriyor: {callWhen(p)}
                  {p.venue ? ` · ${p.venue}` : ""}
                </div>
                {p.note && <p className="rounded-lg bg-pitch-950 p-2 text-xs text-muted">“{p.note}”</p>}
                <div className="grid grid-cols-2 gap-2">
                  {(["1", "0"] as const).map((accept) => (
                    <form key={accept} action={decideProposal}>
                      <Hidden groupId={groupId} />
                      <input type="hidden" name="proposalId" value={p.id} />
                      <input type="hidden" name="accept" value={accept} />
                      <SubmitButton variant={accept === "1" ? "primary" : "secondary"} className="min-h-10 w-full text-sm" pendingLabel="…">
                        {accept === "1" ? "Onayla, çağrı aç" : "Reddet"}
                      </SubmitButton>
                    </form>
                  ))}
                </div>
                <p className="text-[11px] text-muted">Onaylarsan çağrı öneren adına açılır; kadroyu o kesinleştirir.</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {!canCreate && mine && (
        <Card className="mb-2 flex items-center gap-3 border-accent/30 p-3 text-sm">
          <span className="text-xl">💡</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{sent ? "Önerin gönderildi" : "Önerin onay bekliyor"}</div>
            <div className="text-xs text-muted">{callWhen(mine)}</div>
          </div>
          <form action={cancelProposal}>
            <Hidden groupId={groupId} />
            <input type="hidden" name="proposalId" value={mine.id} />
            <button className="text-xs text-muted hover:text-red-300">Geri çek</button>
          </form>
        </Card>
      )}

      {!canCreate && !mine && (
        <details className="mb-2" open={openForm}>
          <summary className="cursor-pointer rounded-xl border border-line bg-pitch-900 px-4 py-3 text-sm font-semibold hover:border-accent/50">
            💡 Maç öner
          </summary>
          <form action={proposeMatch} className="mt-2 space-y-3 rounded-xl border border-line p-3">
            <Hidden groupId={groupId} />
            <p className="text-xs text-muted">Önerin sadece kurucu, yetkili ve organizatörlere gider. Onaylanırsa çağrı senin adına açılır ve kadroyu sen kesinleştirirsin.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Label>Gün</Label>
                <Input type="date" name="day" min={today} max={max} defaultValue={today} required />
              </label>
              <label className="block">
                <Label hint="isteğe bağlı">Saat</Label>
                <Input type="time" name="time" />
              </label>
            </div>
            <label className="block">
              <Label hint="isteğe bağlı">Saha</Label>
              <Input name="venue" maxLength={80} placeholder="Örn. Petroller Halısaha" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Not</Label>
              <Input name="note" maxLength={300} placeholder="Örn. Cuma akşamı 7v7 yapalım mı?" />
            </label>
            <SubmitButton className="w-full" pendingLabel="Gönderiliyor…">
              Öneriyi gönder
            </SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}

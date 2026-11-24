import Link from "next/link";
import { createFillPoll } from "@/lib/call-actions";
import { Icon } from "@/components/Icon";
import { POSITIONS, POSITION_NAME } from "@/lib/data";
import type { Call } from "@/lib/calls-data";
import { Badge, Card, Label } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Maç ekranında "Adam ara" (maçı yöneten): planlı maçın eksiği için çağrı aç. Maçın kendi grubunda veya maç açabildiğim
 * bir toplulukta yayınlanır; başvuranları çağrı sayfasında rating ve güvenilirlikle görüp tek tek kadroya alırım.
 */
export function FillSection({
  groupId,
  matchId,
  groupLabel,
  fills,
  communities,
  gatherCall,
}: {
  groupId: string;
  matchId: string;
  groupLabel: string;
  fills: (Call & { group_name: string })[];
  communities: { id: string; name: string }[];
  gatherCall: { id: string; group_id: string } | null;
}) {
  const targets = [{ id: groupId, name: groupLabel }, ...communities.filter((c) => c.id !== groupId)];
  return (
    <div className="space-y-3">
      {gatherCall && (
        <Link href={`/g/${gatherCall.group_id}/cagri/${gatherCall.id}`} className="block text-sm text-accent underline">
          Bu maçı kuran çağrı: yedekleri gör, kadroya al ›
        </Link>
      )}
      {fills.map((f) => (
        <Link key={f.id} href={`/g/${f.group_id}/cagri/${f.id}`} className="block">
          <Card className="flex items-center gap-2 p-3 transition hover:border-accent/50">
            <Icon name="person_search" className="text-[22px] text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <b>{f.capacity} oyuncu</b> aranıyor · {f.group_name}
              {f.positions.length > 0 && <span className="text-muted"> · {f.positions.map((p) => POSITION_NAME[p as keyof typeof POSITION_NAME]).join(", ")}</span>}
            </div>
            <Badge tone={f.status === "filled" ? "accent" : "warn"}>{f.status === "filled" ? "Doldu" : "Açık"}</Badge>
          </Card>
        </Link>
      ))}
      <form action={createFillPoll} className="space-y-3">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="matchId" value={matchId} />
        <p className="text-xs text-muted">
          Eksik mi var? Çağrıyı bu maçın grubunda veya organizatörü olduğun bir toplulukta aç. Başvuranları rating ve güvenilirlikle görüp tek tek
          sen alırsın; takım üyesi olmayan oyuncu bu maç için ödünç olarak kadroya girer.
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
            <Label>Nerede?</Label>
            <select name="targetGroupId" defaultValue={groupId} className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm">
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
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
            placeholder="Örn. Kişi başı 150 TL. Kaleci acil lazım!"
            className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </label>
        <SubmitButton className="w-full" pendingLabel="Yayınlanıyor…">
          <Icon name="person_search" className="text-[20px]" />
          Adam ara
        </SubmitButton>
      </form>
    </div>
  );
}

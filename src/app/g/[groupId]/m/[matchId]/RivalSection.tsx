import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { TeamBadge } from "@/components/TeamBadge";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { matchWhen } from "@/lib/match-rules";
import { withdrawChallenge } from "@/lib/match-manage-actions";
import { RivalChooser } from "./RivalChooser";

export interface RivalOffer {
  id: string;
  status: "pending" | "declined";
  /** Teklifin gittiği takım; maçı gören ama teklifi okuyamayan kişide sadece ad vardır */
  team: { id: string | null; name: string; color: string | null; logo: string | null };
  at: string | null;
  tbd: boolean;
  /** Bekleyen teklifte sıra bizde (rakip karşı teklif yaptı); reddedilende reddeden biziz */
  ours: boolean;
}

/**
 * Açık maçta rakibin durumu: seçilmedi / teklif onay bekliyor / reddedildi / uygulama dışı takım.
 * Rakip onaylayınca (bağlı maç) bu bölüm yerine karşılaşma kartı görünür.
 */
export function RivalSection({
  groupId,
  matchId,
  homeCity,
  opponentName,
  offer,
  canManage,
  canOffer,
}: {
  groupId: string;
  matchId: string;
  homeCity: string;
  opponentName: string | null;
  offer: RivalOffer | null;
  canManage: boolean;
  /** Teklifi sadece kaptan/yetkili geri çekebilir (cancel_challenge) */
  canOffer: boolean;
}) {
  const pending = offer?.status === "pending" ? offer : null;
  const declined = !opponentName && offer?.status === "declined" ? offer : null;
  const chooser = <RivalChooser groupId={groupId} matchId={matchId} opponentName={opponentName} homeCity={homeCity} />;

  return (
    <section id="rakip" className="mb-4 space-y-2">
      <SectionTitle>{canManage && !pending && !opponentName ? "Rakip seç" : "Rakip"}</SectionTitle>

      {pending ? (
        <Card className="space-y-3 border-amber-400/40">
          <TeamRow team={pending.team} sub={pending.at ? `Teklif: ${matchWhen(pending.at, pending.tbd)}` : "Teklif gönderildi"}>
            <Badge tone="warn">Onay bekliyor</Badge>
          </TeamRow>
          {canManage && pending.ours ? (
            <Link href={`/g/${groupId}/teklifler`} className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-400/10 px-3 text-sm">
              <span className="min-w-0 flex-1">Karşı teklif geldi; yanıtın bekleniyor.</span>
              <span className="shrink-0 font-semibold text-primary">Yanıtla</span>
              <Icon name="chevron_right" className="text-[20px] text-muted" />
            </Link>
          ) : (
            canManage && <p className="text-xs text-muted">Yanıt gelince haber veririz. Başka takım aramak için teklifi geri çek.</p>
          )}
          {canOffer && (
            <form action={withdrawChallenge}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="challengeId" value={pending.id} />
              <SubmitButton variant="secondary" className="w-full" pendingLabel="Geri çekiliyor…">
                Teklifi geri çek
              </SubmitButton>
            </form>
          )}
        </Card>
      ) : opponentName ? (
        <Card className="space-y-3">
          <TeamRow team={{ id: null, name: opponentName, color: null, logo: null }} sub="Uygulamada olmayan takım" />
          {canManage && (
            <details>
              <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
                <Icon name="swap_horiz" className="text-[20px]" />
                Rakibi değiştir
              </summary>
              <div className="pt-2">{chooser}</div>
            </details>
          )}
        </Card>
      ) : (
        <>
          {declined && (
            <Card className="border-red-400/40">
              <TeamRow
                team={declined.team}
                sub={declined.ours ? "Karşı teklifi reddettin" : canManage ? "Teklifini reddetti; yeni rakip seçebilirsin" : "Teklifi reddetti"}
              >
                <Badge>Reddedildi</Badge>
              </TeamRow>
            </Card>
          )}
          <Card className="space-y-3">
            {canManage ? (
              <>
                <p className="text-sm text-amber-300">Bu maçın rakibi yok; kesinleştirmek için rakip seçmen gerekiyor.</p>
                {chooser}
              </>
            ) : (
              <p className="text-sm text-muted">Rakip henüz belli değil.</p>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function TeamRow({ team, sub, children }: { team: RivalOffer["team"]; sub: string; children?: React.ReactNode }) {
  const body = (
    <>
      <TeamBadge id={team.id ?? team.name} name={team.name} color={team.color} logo={team.logo} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-bold">{team.name}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3">
      {team.id ? (
        <Link href={`/g/${team.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
      ) : (
        body
      )}
      {children}
    </div>
  );
}

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { TeamBadge } from "@/components/TeamBadge";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { matchWhen } from "@/lib/match-rules";
import { withdrawChallenge } from "@/lib/match-manage-actions";
import { RivalChooser } from "./RivalChooser";

/** Bir maçtan aynı anda gönderilebilen teklif sayısı (create_challenge_v2 ile aynı) */
const MAX_OFFERS = 3;

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
 * Açık maçta rakibin durumu: seçilmedi / teklifler onay bekliyor (aynı anda en fazla 3) / reddedildi / uygulama dışı takım.
 * Bir rakip kabul edince (bağlı maç) bu bölüm yerine karşılaşma kartı görünür.
 */
export function RivalSection({
  groupId,
  matchId,
  homeCity,
  opponentName,
  offers,
  canManage,
  canOffer,
}: {
  groupId: string;
  matchId: string;
  homeCity: string;
  opponentName: string | null;
  offers: RivalOffer[];
  canManage: boolean;
  /** Kaptan/yetkili: teklifi gönderir, yanıtlar ve geri çeker */
  canOffer: boolean;
}) {
  const pending = offers.filter((o) => o.status === "pending");
  const declined = opponentName ? [] : offers.filter((o) => o.status === "declined");
  const chooser = <RivalChooser groupId={groupId} matchId={matchId} opponentName={opponentName} homeCity={homeCity} canOffer={canOffer} />;

  return (
    <section id="rakip" className="mb-4 space-y-2">
      <SectionTitle>{canManage && !pending.length && !opponentName ? "Rakip seç" : "Rakip"}</SectionTitle>

      {declined.map((o) => (
        <Card key={o.id} className="border-red-400/40">
          <TeamRow team={o.team} sub={o.ours ? "Karşı teklifi reddettin" : canManage ? "Teklifini reddetti" : "Teklifi reddetti"}>
            <Badge>Reddedildi</Badge>
          </TeamRow>
        </Card>
      ))}

      {pending.length ? (
        <>
          {pending.map((o) => (
            <Card key={o.id} className="space-y-3 border-amber-400/40">
              <TeamRow team={o.team} sub={o.at ? `Teklif: ${matchWhen(o.at, o.tbd)}` : "Teklif gönderildi"}>
                <Badge tone="warn">Onay bekliyor</Badge>
              </TeamRow>
              {canOffer && o.ours && (
                <Link href={`/g/${groupId}/teklifler`} className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-400/10 px-3 text-sm">
                  <span className="min-w-0 flex-1">Karşı teklif geldi; yanıtın bekleniyor.</span>
                  <span className="shrink-0 font-semibold text-primary">Yanıtla</span>
                  <Icon name="chevron_right" className="text-[20px] text-muted" />
                </Link>
              )}
              {canOffer && (
                <form action={withdrawChallenge}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="matchId" value={matchId} />
                  <input type="hidden" name="challengeId" value={o.id} />
                  <SubmitButton variant="secondary" className="w-full" pendingLabel="Geri çekiliyor…">
                    Teklifi geri çek
                  </SubmitButton>
                </form>
              )}
            </Card>
          ))}
          {canManage && !canOffer && <p className="px-1 text-xs text-muted">Teklifi takımın kaptanı veya yetkilisi yönetir.</p>}
          {canOffer && (
            <>
              <p className="px-1 text-xs text-muted">
                İlk kabul eden rakibin olur, diğer teklifler geri çekilir.{pending.length >= MAX_OFFERS ? " Yeni teklif için birini geri çek." : ""}
              </p>
              {pending.length < MAX_OFFERS && (
                <details className="rounded-2xl border border-line bg-surface-container px-3">
                  <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
                    <Icon name="add" className="text-[20px]" />
                    Başka takıma da teklif gönder
                  </summary>
                  <div className="pb-3">{chooser}</div>
                </details>
              )}
            </>
          )}
        </>
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

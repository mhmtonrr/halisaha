import { cancelWithdrawal, decideWithdrawal, requestWithdrawal } from "@/lib/actions";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export interface WithdrawalRow {
  id: string;
  player_id: string;
  reason: string | null;
  late: boolean;
  status: "pending" | "approved" | "denied" | "cancelled" | "closed";
  created_at: string;
  name: string;
}

const FLASH: Record<string, string> = {
  pending: "Çekilme isteğin kaptana ve yetkililere gönderildi. Onaylanana kadar kadrodasın.",
  approved: "Kadrodan çıkarıldın.",
  cancelled: "Çekilme isteğini geri çektin.",
  "approved-by-admin": "Çekilme onaylandı; oyuncu kadrodan çıkarıldı.",
  "denied-by-admin": "Çekilme isteği reddedildi; oyuncu kadroda kalıyor.",
};

/**
 * Maçtan çekilme (planlanmış maçta). part="requests": yetkililerin onay listesi (ekranın üstünde);
 * part="mine": oyuncunun "gelemeyeceğim" bölümü, mazeret zorunlu (ekranın en altında).
 */
export function WithdrawalSection({
  part,
  groupId,
  matchId,
  playedAt,
  myPlayerId,
  canManage,
  rows,
  flash,
}: {
  part: "requests" | "mine";
  groupId: string;
  matchId: string;
  playedAt: string;
  /** Kadrodaysam benim oyuncu satırım */
  myPlayerId: string | null;
  canManage: boolean;
  rows: WithdrawalRow[];
  flash?: string;
}) {
  const mine = rows.filter((r) => r.player_id === myPlayerId);
  const pending = mine.find((r) => r.status === "pending");
  const denied = !pending && mine[0]?.status === "denied";
  const waiting = canManage ? rows.filter((r) => r.status === "pending") : [];
  const hoursLeft = (new Date(playedAt).getTime() - Date.now()) / 3600_000;
  const soon = hoursLeft < 3;
  // Yetkilinin karar mesajları üstte, oyuncunun kendi mesajları altta
  const adminFlash = !!flash?.endsWith("-by-admin");
  const flashText = flash && adminFlash === (part === "requests") ? FLASH[flash] : null;
  const showRequests = part === "requests" && waiting.length > 0;
  const showMine = part === "mine" && !!myPlayerId;

  if (!showRequests && !showMine && !flashText) return null;

  return (
    <>
      {flashText && <p className="mb-3 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">{flashText}</p>}

      {showRequests && (
        <>
          <SectionTitle>Çekilme istekleri · {waiting.length}</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {waiting.map((w) => (
                <li key={w.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                    {w.late && <Badge tone="warn">Son dakika</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{w.reason ? `“${w.reason}”` : "Mazeret yazmadı"}</p>
                  <div className="mt-2 flex gap-2">
                    {(["1", "0"] as const).map((approve) => (
                      <form key={approve} action={decideWithdrawal} className="flex-1">
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="matchId" value={matchId} />
                        <input type="hidden" name="withdrawalId" value={w.id} />
                        <input type="hidden" name="approve" value={approve} />
                        <SubmitButton variant={approve === "1" ? "primary" : "secondary"} className="min-h-10 w-full text-sm" pendingLabel="…">
                          {approve === "1" ? "Onayla, kadrodan çıkar" : "Reddet"}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-2 text-center text-xs text-muted">
            Onaylarsan oyuncu kadrodan çıkar ve &quot;gelmedi&quot; sayılmaz. Reddedersen kadroda kalır; yine gelmezse maç sonucunu girerken &quot;gelmedi&quot; işaretleyebilirsin.
          </p>
        </>
      )}

      {showMine && (
        <>
          {pending ? (
            <Card className="space-y-3 border-amber-400/40 bg-amber-400/10">
              <p className="text-sm text-amber-100">
                Çekilme isteğin kaptan onayını bekliyor{pending.late ? " (son dakika)" : ""}. Onaylanana kadar kadrodasın.
              </p>
              <form action={cancelWithdrawal}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="matchId" value={matchId} />
                <input type="hidden" name="withdrawalId" value={pending.id} />
                <SubmitButton variant="secondary" className="w-full" pendingLabel="Geri çekiliyor…">
                  İsteği geri çek
                </SubmitButton>
              </form>
            </Card>
          ) : (
            <Card>
              {denied && (
                <p className="mb-3 rounded-lg bg-red-950/50 p-2 text-sm text-red-200">
                  Çekilme isteğin reddedildi, kadroda kalıyorsun. Gelemeyeceksen kaptanla konuş.
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-red-300">Maça gelemeyeceğim…</summary>
                <form action={requestWithdrawal} className="mt-3 space-y-3">
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="matchId" value={matchId} />
                  <label className="block text-xs text-muted">
                    Mazeretin (zorunlu)
                    <textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={200}
                      rows={2}
                      placeholder="Örn. işim çıktı, sakatım"
                      className="mt-1 w-full rounded-xl border border-line bg-pitch-950 px-3 py-2 text-sm text-white outline-none placeholder:text-muted/60 focus:border-accent"
                    />
                  </label>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                    <li>Kadrodan çıkman kaptan veya yetkili onayına bağlı; onaylanana kadar kadrondasın.</li>
                    <li>Onaylanırsa &quot;gelmedi&quot; sayılmaz, güvenilirliğin bozulmaz.</li>
                    <li>Reddedilirse ve yine gelmezsen &quot;gelmedi&quot; işaretlenebilir.</li>
                    {soon && <li className="text-amber-300">Maça 3 saatten az kaldı; istek &quot;son dakika&quot; olarak işaretlenir.</li>}
                  </ul>
                  <Button variant="danger" className="w-full">
                    {canManage ? "Kadrodan çık" : "Çekilme isteği gönder"}
                  </Button>
                </form>
              </details>
            </Card>
          )}
        </>
      )}
    </>
  );
}

import { matchWhen } from "@/lib/match-rules";
import Link from "next/link";
import { CounterForm } from "../m/[matchId]/ManageSections";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { cancelChallenge, respondChallenge } from "@/lib/actions";
import { formatDate } from "@/lib/data";
import { CHALLENGE_STATUS, getChallenges, type Challenge } from "@/lib/challenges-data";
import { TeamBadge } from "@/components/TeamBadge";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, ErrorNote, Header, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/** Takımın maç teklifleri: gelenler (yanıt bekleyen), gönderilenler ve geçmiş */
export default async function ChallengesPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { groupId } = await params;
  const { error, sent } = await searchParams;
  const { supabase } = await requireUser();

  const [{ data: group }, { data: isMember }, { data: isAdmin }] = await Promise.all([
    supabase.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("is_group_member", { p_group_id: groupId }),
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
  ]);
  if (!group || group.kind !== "team") notFound();
  // Teklifler sadece takımın oyuncularına görünür
  if (!isMember) redirect(`/g/${groupId}`);

  const all = await getChallenges(supabase, groupId);
  const incoming = all.filter((c) => c.to.id === groupId && c.status === "pending");
  const outgoing = all.filter((c) => c.from.id === groupId && c.status === "pending");
  const upcoming = all.filter((c) => c.status === "accepted" && c.matchStatus !== "closed");
  const history = all.filter((c) => !["pending"].includes(c.status) && !upcoming.includes(c));

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "match_challenges", filter: `to_group_id=eq.${groupId}` },
          { table: "match_challenges", filter: `from_group_id=eq.${groupId}` },
          { table: "matches", filter: `group_id=eq.${groupId}` },
        ]}
      />
      <Header title="Maç teklifleri" back={`/g/${groupId}`} />
      <ErrorNote message={error} />
      {sent && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">
          Teklif gönderildi ✓ Karşı takım yanıtlayınca sohbetinize haber düşer.
        </p>
      )}

      {all.length === 0 && (
        <Card className="text-center text-sm text-muted">
          Henüz teklif yok. <Link href="/kesfet" className="text-accent">Keşfet</Link> sayfasından bir takım bulup maç teklif edebilirsin.
        </Card>
      )}

      {incoming.length > 0 && (
        <>
          <SectionTitle>Gelen teklifler · {incoming.length}</SectionTitle>
          <div className="space-y-3">
            {incoming.map((c) => (
              <ChallengeCard key={c.id} c={c} groupId={groupId} canAct={!!isAdmin} direction="in" />
            ))}
          </div>
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <SectionTitle>Gönderilen · yanıt bekliyor</SectionTitle>
          <div className="space-y-3">
            {outgoing.map((c) => (
              <ChallengeCard key={c.id} c={c} groupId={groupId} canAct={!!isAdmin} direction="out" />
            ))}
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <SectionTitle>Kabul edilen maçlar</SectionTitle>
          <div className="space-y-3">
            {upcoming.map((c) => (
              <ChallengeCard key={c.id} c={c} groupId={groupId} canAct={!!isAdmin} direction={c.from.id === groupId ? "out" : "in"} />
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <SectionTitle>Geçmiş</SectionTitle>
          <div className="space-y-3">
            {history.map((c) => (
              <ChallengeCard key={c.id} c={c} groupId={groupId} canAct={false} direction={c.from.id === groupId ? "out" : "in"} />
            ))}
          </div>
        </>
      )}

      {!isAdmin && (
        <p className="mt-4 text-center text-xs text-muted">Teklifleri takımın kaptanı ve yetkilileri yanıtlar.</p>
      )}
    </main>
  );
}

function ChallengeCard({
  c,
  groupId,
  canAct,
  direction,
}: {
  c: Challenge;
  groupId: string;
  canAct: boolean;
  direction: "in" | "out";
}) {
  const other = direction === "in" ? c.from : c.to;
  const status = CHALLENGE_STATUS[c.status];
  const cancellable = canAct && (c.status === "accepted" ? c.matchStatus === "planned" || c.matchStatus === "gathering" : c.status === "pending" && direction === "out");
  // Sıra kimde (0044): karşı teklifle gönderene de geçebilir
  const myTurn = c.status === "pending" && (c.awaitingGroupId ?? c.to.id) === groupId;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <Link href={`/g/${other.id}`}>
          <TeamBadge id={other.id} name={other.name} color={other.color} logo={other.logo} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{direction === "in" ? "Teklif eden" : "Teklif edilen"}</div>
          <Link href={`/g/${other.id}`} className="block truncate font-bold hover:text-accent">
            {other.name}
          </Link>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Zaman</dt>
        <dd>{c.proposedTbd ? matchWhen(c.proposedAt, true) : formatDate(c.proposedAt)}</dd>
        <dt className="text-muted">Kişi</dt>
        <dd>
          {c.teamSize} kişilik ({c.teamSize}v{c.teamSize})
        </dd>
        <dt className="text-muted">Saha</dt>
        <dd>{c.venue ?? "Belirtilmedi"}</dd>
        {c.feeNote && (
          <>
            <dt className="text-muted">Ücret</dt>
            <dd>{c.feeNote}</dd>
          </>
        )}
      </dl>
      {c.message && <p className="rounded-lg bg-pitch-950 p-2.5 text-sm text-muted">“{c.message}”</p>}

      {c.status === "pending" && !myTurn && <p className="text-sm text-muted">Sıra rakipte: kabul, ret veya karşı teklif bekleniyor.</p>}
      {myTurn && direction === "out" && <p className="text-sm text-amber-300">Rakip karşı teklif yaptı (yukarıdaki tarih).</p>}
      {myTurn && canAct && (
        <div className="grid grid-cols-2 gap-2">
          {(["accept", "decline"] as const).map((answer) => (
            <form key={answer} action={respondChallenge}>
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="challengeId" value={c.id} />
              <input type="hidden" name="answer" value={answer} />
              <SubmitButton
                variant={answer === "accept" ? "primary" : "secondary"}
                className="w-full"
                pendingLabel={answer === "accept" ? "Kabul ediliyor…" : "Reddediliyor…"}
              >
                {answer === "accept" ? "Kabul et" : "Reddet"}
              </SubmitButton>
            </form>
          ))}
        </div>
      )}
      {myTurn && canAct && <CounterForm groupId={groupId} challengeId={c.id} back={`/g/${groupId}/teklifler`} at={c.proposedAt} />}

      {c.status === "accepted" && c.myMatchId && (
        <Link href={`/g/${groupId}/m/${c.myMatchId}`} className="block text-sm font-medium text-accent">
          Maça git ›
        </Link>
      )}

      {cancellable && (
        <form action={cancelChallenge} className="text-right">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="challengeId" value={c.id} />
          <button className="text-xs text-muted hover:text-red-300">
            {c.status !== "accepted" ? "Teklifi geri çek" : c.matchStatus === "gathering" ? "Rakibi bırak (iki takımın maçı da kalır)" : "Maçı iptal et (iki takımda da iptal olur)"}
          </button>
        </form>
      )}
    </Card>
  );
}

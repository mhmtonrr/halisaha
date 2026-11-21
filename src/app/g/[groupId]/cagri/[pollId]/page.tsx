import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import {
  approveFirstResponders,
  deletePoll,
  respondPoll,
  setPollStatus,
  togglePollApproval,
} from "@/lib/actions";
import { formatDate, getGroupPlayers, type Position } from "@/lib/data";
import { Badge, Button, Card, ErrorNote, Header, LinkButton, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";

type Answer = "yes" | "maybe" | "no";
const ANSWERS: { value: Answer; label: string; icon: string; active: string }[] = [
  { value: "yes", label: "Geliyorum", icon: "✅", active: "bg-accent text-pitch-950 border-accent" },
  { value: "maybe", label: "Belki", icon: "🤔", active: "bg-amber-400 text-pitch-950 border-amber-400" },
  { value: "no", label: "Gelemem", icon: "❌", active: "bg-red-400 text-pitch-950 border-red-400" },
];

function Hidden({ groupId, pollId }: { groupId: string; pollId: string }) {
  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="pollId" value={pollId} />
    </>
  );
}

export default async function PollPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; pollId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { groupId, pollId } = await params;
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();

  const [{ data: poll }, players, { data: isAdmin }] = await Promise.all([
    supabase
      .from("match_polls")
      .select("id, starts_at, venue, capacity, deadline, note, status, match_id, poll_responses(player_id, answer, approved, responded_at)")
      .eq("id", pollId)
      .eq("group_id", groupId)
      .maybeSingle(),
    getGroupPlayers(supabase, groupId),
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
  ]);
  if (!poll) notFound();

  const me = players.find((p) => p.user_id === user.id);
  const byId = new Map(players.map((p) => [p.id, p]));
  const responses = [...poll.poll_responses].sort((a, b) => a.responded_at.localeCompare(b.responded_at));
  const mine = responses.find((r) => r.player_id === me?.id);
  const yes = responses.filter((r) => r.answer === "yes");
  const maybe = responses.filter((r) => r.answer === "maybe");
  const no = responses.filter((r) => r.answer === "no");
  const answered = new Set(responses.map((r) => r.player_id));
  const silent = players.filter((p) => p.user_id && !answered.has(p.id));
  const approvedCount = yes.filter((r) => r.approved).length;

  const deadlinePassed = poll.deadline ? new Date(poll.deadline) < new Date() : false;
  const open = poll.status === "open" && !deadlinePassed;
  const pct = Math.min(100, (yes.length / poll.capacity) * 100);

  const Person = ({ id, children }: { id: string; children?: React.ReactNode }) => {
    const p = byId.get(id);
    if (!p) return null;
    return (
      <li className="flex items-center gap-3 px-4 py-2.5">
        <OvrBadge overall={p.overall} className="h-8 w-8 text-xs" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{p.display_name}</span>
          <PositionChip position={p.position as Position | null} />
        </span>
        {children}
      </li>
    );
  };

  return (
    <main>
      <Header
        title="Maç çağrısı"
        back={`/g/${groupId}`}
        right={
          poll.status === "converted" ? (
            <Badge tone="accent">Maç oluştu</Badge>
          ) : open ? (
            <Badge tone="warn">Açık</Badge>
          ) : (
            <Badge>Kapandı</Badge>
          )
        }
      />
      <ErrorNote message={error} />

      <Card className="mb-4">
        <div className="text-2xl font-black">{formatDate(poll.starts_at)}</div>
        {poll.venue && <div className="mt-0.5 text-muted">📍 {poll.venue}</div>}
        {poll.note && <p className="mt-3 rounded-lg bg-pitch-950 p-3 text-sm">{poll.note}</p>}
        <div className="mt-4 flex justify-between text-sm">
          <span>
            <b className="text-accent">{yes.length}</b>
            <span className="text-muted"> / {poll.capacity} geliyor</span>
            {maybe.length > 0 && <span className="text-muted"> · {maybe.length} belki</span>}
          </span>
          {poll.deadline && (
            <span className="text-xs text-muted">Son yanıt: {formatDate(poll.deadline)}</span>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-pitch-950">
          <div className={cx("h-full rounded-full", yes.length >= poll.capacity ? "bg-gold-2" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
        {yes.length > poll.capacity && (
          <p className="mt-2 text-xs text-amber-300">Kontenjan aşıldı: ilk {poll.capacity} kişi öncelikli, gerisi yedek.</p>
        )}
      </Card>

      {poll.status === "converted" && poll.match_id && (
        <LinkButton href={`/g/${groupId}/m/${poll.match_id}`} className="mb-4 w-full">
          Maça git ›
        </LinkButton>
      )}

      {me && open && (
        <>
          <div className="mb-1 text-center text-sm text-muted">{mine ? "Yanıtın (değiştirebilirsin)" : "Geliyor musun?"}</div>
          <div className="grid grid-cols-3 gap-2">
            {ANSWERS.map((a) => (
              <form key={a.value} action={respondPoll}>
                <Hidden groupId={groupId} pollId={pollId} />
                <input type="hidden" name="answer" value={a.value} />
                <button
                  className={cx(
                    "flex min-h-14 w-full flex-col items-center justify-center rounded-xl border text-sm font-semibold transition",
                    mine?.answer === a.value ? a.active : "border-line bg-pitch-900 hover:bg-pitch-800",
                  )}
                >
                  <span>{a.icon}</span>
                  {a.label}
                </button>
              </form>
            ))}
          </div>
          {mine?.answer === "yes" && (
            <p className="mt-2 text-center text-xs text-muted">
              {mine.approved ? "✓ Kadroya onaylandın" : "Yetkilinin onayını bekliyorsun"}
              {!mine.approved && yes.findIndex((r) => r.player_id === me.id) >= poll.capacity && " · şu an yedektesin"}
            </p>
          )}
        </>
      )}

      {isAdmin && poll.status !== "converted" && (
        <Card className="mt-4 space-y-2 border-accent/30">
          <div className="text-sm font-semibold">Yetkili işlemleri</div>
          <p className="text-xs text-muted">
            {approvedCount} oyuncu onaylı. Onayladıkların maç oluştururken seçili gelir; misafir oyuncuyu maç ekranından ekleyebilirsin.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <form action={approveFirstResponders}>
              <Hidden groupId={groupId} pollId={pollId} />
              <Button variant="secondary" className="w-full" disabled={yes.length === 0}>
                İlk {Math.min(poll.capacity, yes.length)} kişiyi onayla
              </Button>
            </form>
            <LinkButton href={`/g/${groupId}/matches/new?cagri=${pollId}`} className={approvedCount < 2 ? "pointer-events-none opacity-50" : ""}>
              Maçı oluştur ›
            </LinkButton>
          </div>
          <div className="flex justify-between pt-1">
            <form action={setPollStatus}>
              <Hidden groupId={groupId} pollId={pollId} />
              <input type="hidden" name="status" value={poll.status === "open" ? "closed" : "open"} />
              <button className="text-xs text-muted hover:text-white">
                {poll.status === "open" ? "Yanıtlara kapat" : "Yanıtlara tekrar aç"}
              </button>
            </form>
            <form action={deletePoll}>
              <Hidden groupId={groupId} pollId={pollId} />
              <button className="text-xs text-muted hover:text-red-300">Çağrıyı sil</button>
            </form>
          </div>
        </Card>
      )}

      <SectionTitle>Geliyor · {yes.length}</SectionTitle>
      {yes.length === 0 ? (
        <Card className="text-center text-sm text-muted">Henüz kimse &quot;geliyorum&quot; demedi.</Card>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line">
            {yes.map((r, i) => (
              <Person key={r.player_id} id={r.player_id}>
                {i >= poll.capacity && <Badge>Yedek</Badge>}
                {isAdmin && poll.status !== "converted" ? (
                  <form action={togglePollApproval}>
                    <Hidden groupId={groupId} pollId={pollId} />
                    <input type="hidden" name="playerId" value={r.player_id} />
                    <input type="hidden" name="approved" value={String(!r.approved)} />
                    <button
                      className={cx(
                        "rounded-lg px-2 py-1 text-xs font-semibold",
                        r.approved ? "bg-accent/20 text-accent" : "border border-line text-muted hover:text-white",
                      )}
                    >
                      {r.approved ? "✓ Onaylı" : "Onayla"}
                    </button>
                  </form>
                ) : (
                  r.approved && <Badge tone="accent">✓ Onaylı</Badge>
                )}
              </Person>
            ))}
          </ol>
        </Card>
      )}

      {maybe.length > 0 && (
        <>
          <SectionTitle>Belki · {maybe.length}</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">{maybe.map((r) => <Person key={r.player_id} id={r.player_id} />)}</ul>
          </Card>
        </>
      )}
      {no.length > 0 && (
        <>
          <SectionTitle>Gelemiyor · {no.length}</SectionTitle>
          <Card className="p-0 opacity-70">
            <ul className="divide-y divide-line">{no.map((r) => <Person key={r.player_id} id={r.player_id} />)}</ul>
          </Card>
        </>
      )}
      {silent.length > 0 && (
        <>
          <SectionTitle>Yanıt vermedi · {silent.length}</SectionTitle>
          <p className="text-sm text-muted">{silent.map((p) => p.display_name).join(", ")}</p>
        </>
      )}
      <p className="mt-6 text-center text-xs text-muted">
        <Link href={`/g/${groupId}`} className="underline">
          Gruba dön
        </Link>
      </p>
    </main>
  );
}

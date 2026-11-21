import { LiveRefresh } from "@/components/LiveRefresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { formatDate, getGroupSummaries } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { teamRating } from "@/lib/teams-data";
import {
  competitive,
  extremes,
  form,
  headToHead,
  leaders,
  outcomeOf,
  perMatch,
  recordOf,
  streak,
  type LeaderKey,
  type Outcome,
  type PlayerStatRow,
  type StatMatch,
} from "@/lib/team-stats";
import { TeamBadge } from "@/components/TeamBadge";
import { OvrBadge } from "@/components/PlayerCard";
import { Card, Header, LinkButton, SectionTitle, cx } from "@/components/ui";

const OUTCOME_STYLE: Record<Outcome, string> = {
  W: "bg-accent/20 text-accent",
  D: "bg-pitch-700 text-muted",
  L: "bg-red-400/20 text-red-300",
};
const OUTCOME_WORD: Record<Outcome, string> = { W: "galibiyet", D: "beraberlik", L: "mağlubiyet" };

export default async function TeamStatsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, kind, city, district, color")
    .eq("id", groupId)
    .maybeSingle();
  if (!group || group.kind !== "team") notFound();
  await finalizeExpired(groupId);

  const [players, { data: rows }] = await Promise.all([
    getGroupSummaries(supabase, groupId),
    supabase
      .from("matches")
      .select("id, played_at, kind, status, score_a, score_b, opponent_name, opponent_group_id")
      .eq("group_id", groupId)
      .in("status", ["voting", "closed"])
      .order("played_at", { ascending: false })
      .limit(500),
  ]);

  const matches: StatMatch[] = (rows ?? []).map((m) => ({
    id: m.id,
    playedAt: m.played_at,
    external: m.kind === "external",
    finished: true,
    scoreFor: m.score_a ?? 0,
    scoreAgainst: m.score_b ?? 0,
    opponentGroupId: m.opponent_group_id,
    opponentName: m.opponent_name,
  }));
  const record = recordOf(competitive(matches));
  const last5 = form(matches);
  const run = streak(matches);
  const { biggestWin, biggestLoss } = extremes(matches);
  const rivals = headToHead(matches);
  const recent = competitive(matches).reverse().slice(0, 10);

  const statRows: PlayerStatRow[] = players.map((p) => ({
    playerId: p.id,
    name: p.display_name,
    played: p.totals.played,
    goals: p.totals.goals,
    assists: p.totals.assists,
    saves: p.totals.saves,
    mvps: p.totals.mvps,
    overall: p.overall,
  }));
  const boards: { key: LeaderKey; title: string; icon: string; unit: string }[] = [
    { key: "goals", title: "Gol krallığı", icon: "⚽", unit: "gol" },
    { key: "assists", title: "Asist krallığı", icon: "🎯", unit: "asist" },
    { key: "mvps", title: "En çok MVP", icon: "⭐", unit: "MVP" },
    { key: "saves", title: "Kurtarışlar", icon: "🧤", unit: "kurtarış" },
  ];

  const rated = players.filter((p) => p.matches_played > 0);
  const avgOverall = players.length ? Math.round(players.reduce((s, p) => s + p.overall, 0) / players.length) : 0;
  const diff = record.goalsFor - record.goalsAgainst;

  const tiles = [
    { l: "Maç", v: record.played },
    { l: "Galibiyet", v: record.won, c: "text-accent" },
    { l: "Beraberlik", v: record.drawn },
    { l: "Mağlubiyet", v: record.lost, c: "text-red-300" },
    { l: "Atılan gol", v: record.goalsFor },
    { l: "Yenen gol", v: record.goalsAgainst },
    { l: "Averaj", v: diff > 0 ? `+${diff}` : diff, c: diff > 0 ? "text-accent" : diff < 0 ? "text-red-300" : "" },
    { l: "Galibiyet %", v: `%${record.winRate}` },
    { l: "Gol yemeden", v: record.cleanSheets },
  ];

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "matches", filter: `group_id=eq.${groupId}` },
          { table: "group_players", filter: `group_id=eq.${groupId}` },
        ]}
      />
      <Header title="Takım istatistikleri" back={`/g/${groupId}`} />
      <div className="mb-5 flex items-center gap-3">
        <TeamBadge name={group.name} color={group.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-black">{group.name}</div>
          <div className="text-xs text-muted">{formatRegion(group.city ?? "", group.district)}</div>
        </div>
        <div className="text-center">
          <OvrBadge overall={teamRating(players.map((p) => p.overall))} className={cx("h-12 w-12 text-lg", rated.length === 0 && "opacity-50")} />
          <div className="mt-1 text-[10px] text-muted">takım puanı</div>
        </div>
      </div>

      {record.played === 0 ? (
        <Card className="text-center text-sm text-muted">
          Henüz rakibe karşı oynanmış maç yok. İlk maçtan sonra karne, form ve rakip geçmişi burada görünür.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {tiles.map((t) => (
              <Card key={t.l} className="p-2.5">
                <div className={cx("text-xl font-black tabular-nums", t.c)}>{t.v}</div>
                <div className="text-[10px] text-muted">{t.l}</div>
              </Card>
            ))}
          </div>

          <Card className="mt-3 flex items-center gap-3">
            <div className="flex gap-1.5">
              {last5.map((o, i) => (
                <span key={i} className={cx("flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold", OUTCOME_STYLE[o])}>
                  {o === "W" ? "G" : o === "L" ? "M" : "B"}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1 text-right text-xs text-muted">
              <div>Son {last5.length} maç</div>
              {run && run.length >= 2 && (
                <div className={run.outcome === "W" ? "text-accent" : run.outcome === "L" ? "text-red-300" : ""}>
                  {run.length} maçlık {OUTCOME_WORD[run.outcome]} serisi
                </div>
              )}
            </div>
          </Card>

          {(biggestWin || biggestLoss) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                { t: "En büyük galibiyet", m: biggestWin, c: "text-accent" },
                { t: "En ağır mağlubiyet", m: biggestLoss, c: "text-red-300" },
              ].map((x) => (
                <Card key={x.t} className="p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted">{x.t}</div>
                  {x.m ? (
                    <>
                      <div className={cx("text-xl font-black tabular-nums", x.c)}>
                        {x.m.scoreFor}-{x.m.scoreAgainst}
                      </div>
                      <div className="truncate text-xs text-muted">{x.m.opponentName}</div>
                    </>
                  ) : (
                    <div className="py-1 text-sm text-muted">—</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <SectionTitle>Kadro</SectionTitle>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="p-2.5">
          <div className="text-xl font-black">{players.length}</div>
          <div className="text-[10px] text-muted">Oyuncu</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-xl font-black">{avgOverall || "—"}</div>
          <div className="text-[10px] text-muted">Ortalama puan</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-xl font-black">{rated.length}</div>
          <div className="text-[10px] text-muted">Puanlanmış oyuncu</div>
        </Card>
      </div>

      <SectionTitle>Liderler</SectionTitle>
      <div className="space-y-3">
        {boards.map((b) => {
          const top = leaders(statRows, b.key, 5);
          if (!top.length) return null;
          return (
            <Card key={b.key} className="p-0">
              <div className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {b.icon} {b.title}
              </div>
              <ol className="divide-y divide-line">
                {top.map((r, i) => (
                  <li key={r.playerId}>
                    <Link href={`/g/${groupId}/p/${r.playerId}`} className="flex items-center gap-3 px-4 py-2 transition hover:bg-pitch-800">
                      <span className="w-4 text-sm font-bold text-muted">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      {b.key !== "mvps" && b.key !== "saves" && (
                        <span className="text-xs text-muted">{perMatch(r[b.key], r.played)} / maç</span>
                      )}
                      <span className="w-16 text-right font-black tabular-nums">
                        {r[b.key]} <span className="text-[10px] font-normal text-muted">{b.unit}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Card>
          );
        })}
        {boards.every((b) => leaders(statRows, b.key, 1).length === 0) && (
          <Card className="text-center text-sm text-muted">Maç istatistiği girildikçe liderler burada görünür.</Card>
        )}
      </div>

      {rivals.length > 0 && (
        <>
          <SectionTitle>Rakipler</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {rivals.map((r) => {
                const inner = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.opponentName}</div>
                      <div className="text-xs text-muted">
                        {r.played} maç · {r.goalsFor}-{r.goalsAgainst} gol
                      </div>
                    </div>
                    <div className="flex gap-1 text-xs font-bold tabular-nums">
                      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-accent">{r.won}G</span>
                      <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-muted">{r.drawn}B</span>
                      <span className="rounded bg-red-400/20 px-1.5 py-0.5 text-red-300">{r.lost}M</span>
                    </div>
                  </>
                );
                const key = r.opponentGroupId ?? `ad:${r.opponentName}`;
                return (
                  <li key={key}>
                    {r.opponentGroupId ? (
                      <Link href={`/g/${r.opponentGroupId}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle>Son rakip maçları</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {recent.map((m) => {
                const o = outcomeOf(m);
                return (
                  <li key={m.id}>
                    <Link href={`/g/${groupId}/m/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-pitch-800">
                      <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold", OUTCOME_STYLE[o])}>
                        {o === "W" ? "G" : o === "L" ? "M" : "B"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">vs {m.opponentName}</div>
                        <div className="text-xs text-muted">{formatDate(m.playedAt)}</div>
                      </div>
                      <span className="font-black tabular-nums">
                        {m.scoreFor} - {m.scoreAgainst}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}

      <LinkButton href={`/g/${groupId}`} variant="secondary" className="mt-6 w-full">
        Takım sayfasına dön
      </LinkButton>
    </main>
  );
}

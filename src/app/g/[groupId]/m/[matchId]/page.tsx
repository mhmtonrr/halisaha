import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { formatDate, getGroupPlayers, one, POSITION_NAME, POSITIONS, type Position } from "@/lib/data";
import {
  addToMatch,
  closeVoting,
  deleteMatch,
  movePlayer,
  removeFromMatch,
  reshuffleTeams,
  setMatchPositions,
  submitResult,
} from "@/lib/actions";
import { Badge, Button, Card, ErrorNote, Header, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip, shortName } from "@/components/PlayerCard";
import { VoteForm } from "./VoteForm";

type Team = "A" | "B";
const TEAM = {
  A: { label: "Sarı", text: "text-team-a", bg: "bg-team-a" },
  B: { label: "Mavi", text: "text-team-b", bg: "bg-team-b" },
} as const;

/** Rakip takıma karşı maçta A takımı "Biz", B takımı rakip */
type Labels = Record<Team, string>;
const labelsFor = (external: boolean, opponent: string | null): Labels =>
  external ? { A: "Biz", B: opponent ?? "Rakip" } : { A: TEAM.A.label, B: TEAM.B.label };

interface RosterEntry {
  id: string;
  name: string;
  userId: string | null;
  position: Position | null;
  team: Team;
  isGoalkeeper: boolean;
  goals: number;
  assists: number;
  saves: number;
  overall: number;
}

function Hidden({ groupId, matchId }: { groupId: string; matchId: string }) {
  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
    </>
  );
}

function timeLeft(deadline: string | null) {
  if (!deadline) return "";
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "süre doldu";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} sa ${m} dk kaldı` : `${m} dk kaldı`;
}

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; matchId: string }>;
  searchParams: Promise<{ error?: string; voted?: string; positions?: string }>;
}) {
  const { groupId, matchId } = await params;
  const { error, voted, positions } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: first } = await supabase
    .from("matches")
    .select("id, group_id, status")
    .eq("id", matchId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!first) notFound();
  if (first.status === "voting") await finalizeExpired(groupId);

  const [{ data: match }, { data: rosterRows }, players, { data: canManage }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, voting_deadline, kind, opponent_name")
      .eq("id", matchId)
      .single(),
    supabase
      .from("match_players")
      .select("player_id, team, is_goalkeeper, position, goals, assists, saves, group_players(display_name, user_id, position)")
      .eq("match_id", matchId),
    getGroupPlayers(supabase, groupId),
    supabase.rpc("can_manage_match", { p_match_id: matchId }),
  ]);
  if (!match) notFound();

  const overall = new Map(players.map((p) => [p.id, p.overall]));
  type GP = { display_name: string; user_id: string | null; position: Position | null };
  const roster: RosterEntry[] = (rosterRows ?? [])
    .map((r) => {
      const gp = one(r.group_players as GP | GP[]);
      return {
        id: r.player_id,
        name: gp?.display_name ?? "?",
        userId: gp?.user_id ?? null,
        // Maça özel mevki; yoksa oyuncunun genel mevkisi
        position: (r.position as Position | null) ?? (r.is_goalkeeper ? "GK" : (gp?.position ?? null)),
        team: r.team as Team,
        isGoalkeeper: r.is_goalkeeper,
        goals: r.goals,
        assists: r.assists,
        saves: r.saves,
        overall: overall.get(r.player_id) ?? 65,
      };
    })
    .sort(
      (a, b) =>
        POSITIONS.indexOf(a.position ?? ("Z" as Position)) - POSITIONS.indexOf(b.position ?? ("Z" as Position)) ||
        b.overall - a.overall,
    );
  const external = match.kind === "external";
  const labels = labelsFor(external, match.opponent_name);

  const me = roster.find((r) => r.userId === user.id);
  const teams = { A: roster.filter((r) => r.team === "A"), B: roster.filter((r) => r.team === "B") };
  const avg = (t: RosterEntry[]) =>
    t.length ? Math.round((t.reduce((s, p) => s + p.overall, 0) / t.length) * 10) / 10 : 0;

  const statusBadge =
    match.status === "planned" ? (
      <Badge>Planlandı</Badge>
    ) : match.status === "voting" ? (
      <Badge tone="warn">Oylama</Badge>
    ) : (
      <Badge tone="accent">Tamamlandı</Badge>
    );

  return (
    <main>
      <Header
        title={external ? `vs ${match.opponent_name}` : formatDate(match.played_at)}
        back={`/g/${groupId}`}
        right={statusBadge}
      />
      <p className="-mt-3 mb-4 text-sm text-muted">
        {external ? formatDate(match.played_at) : "Kendi aramızda"}
        {match.venue ? ` · ${match.venue}` : ""}
      </p>
      <ErrorNote message={error} />
      {positions && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Mevkiler kaydedildi ✓</p>
      )}

      {match.status !== "planned" && (
        <Card className="mb-4 flex items-center justify-around py-5">
          {(["A", "B"] as const).map((t, i) => (
            <div key={t} className="flex items-center gap-4">
              {i === 1 && <span className="text-2xl text-muted">-</span>}
              <div className="text-center">
                <div className={cx("text-5xl font-black tabular-nums", external ? (t === "A" ? "text-white" : "text-muted") : TEAM[t].text)}>
                  {t === "A" ? match.score_a : match.score_b}
                </div>
                <div className="mt-1 max-w-28 truncate text-xs uppercase text-muted">{labels[t]}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {match.status === "planned" && (
        <PlannedView
          groupId={groupId}
          matchId={matchId}
          teams={teams}
          avg={avg}
          canManage={!!canManage}
          external={external}
          labels={labels}
          bench={players
            .filter((p) => !roster.some((r) => r.id === p.id))
            .sort((a, b) => a.display_name.localeCompare(b.display_name, "tr"))}
        />
      )}

      {match.status === "voting" && (
        <VotingView
          groupId={groupId}
          matchId={matchId}
          roster={roster}
          me={me}
          deadline={match.voting_deadline}
          canManage={!!canManage}
          justVoted={voted === "1"}
        />
      )}

      {match.status === "closed" && (
        <ResultsView groupId={groupId} matchId={matchId} roster={roster} myId={me?.id} external={external} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

async function PlannedView({
  groupId,
  matchId,
  teams,
  avg,
  canManage,
  external,
  labels,
  bench,
}: {
  groupId: string;
  matchId: string;
  teams: Record<Team, RosterEntry[]>;
  avg: (t: RosterEntry[]) => number;
  canManage: boolean;
  external: boolean;
  labels: Labels;
  bench: { id: string; display_name: string }[];
}) {
  const all = [...teams.A, ...teams.B];
  const counts = Object.fromEntries(POSITIONS.map((p) => [p, all.filter((r) => r.position === p).length]));

  return (
    <>
      {external ? (
        <Card className="p-3">
          <div className="mb-2 flex items-baseline justify-between font-bold">
            <span>Kadromuz ({all.length})</span>
            <span className="text-xs font-normal text-muted">
              {POSITIONS.filter((p) => counts[p]).map((p) => `${counts[p]} ${POSITION_NAME[p].toLocaleLowerCase("tr")}`).join(" · ")}
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {all.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <OvrBadge overall={p.overall} className="h-7 w-7 text-xs" />
                <span className="min-w-0 flex-1 truncate text-sm">{shortName(p.name)}</span>
                <PositionChip position={p.position} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(["A", "B"] as const).map((t) => (
            <Card key={t} className="p-3">
              <div className={cx("mb-2 flex items-baseline justify-between font-bold", TEAM[t].text)}>
                <span>
                  {labels[t]} ({teams[t].length})
                </span>
                <span className="text-sm">{avg(teams[t])}</span>
              </div>
              <ul className="space-y-1.5">
                {teams[t].map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5">
                    <OvrBadge overall={p.overall} className="h-7 w-7 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-sm">{shortName(p.name)}</span>
                    <PositionChip position={p.position} />
                    {canManage && (
                      <form action={movePlayer}>
                        <Hidden groupId={groupId} matchId={matchId} />
                        <input type="hidden" name="playerId" value={p.id} />
                        <input type="hidden" name="team" value={t} />
                        <button className="rounded px-1 text-muted hover:bg-pitch-700" title="Diğer takıma geçir">
                          {t === "A" ? "→" : "←"}
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <>
          {!external && (
            <form action={reshuffleTeams} className="mt-3">
              <Hidden groupId={groupId} matchId={matchId} />
              <Button variant="secondary" className="w-full">
                🔀 Takımları yeniden karıştır
              </Button>
            </form>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer py-2 text-sm text-muted">Bu maçın mevkilerini düzenle</summary>
            <form action={setMatchPositions} className="mt-2">
              <Hidden groupId={groupId} matchId={matchId} />
              <Card className="space-y-1.5">
                {all.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    {!external && <span className={cx("h-2 w-2 shrink-0 rounded-full", TEAM[p.team].bg)} />}
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <select
                      name={`pos_${p.id}`}
                      defaultValue={p.position ?? ""}
                      className="min-h-9 rounded-lg border border-line bg-pitch-950 px-2 text-sm"
                    >
                      <option value="">—</option>
                      {POSITIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {POSITION_NAME[pos]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </Card>
              <Button variant="secondary" className="mt-2 w-full">
                Mevkileri kaydet
              </Button>
              <p className="mt-1 text-center text-xs text-muted">
                Sadece bu maç için geçerli. Oyuncuların profilindeki mevki değişmez.
                {!external && " Kaydettikten sonra karıştırırsan takımlar yeni mevkilere göre dengelenir."}
              </p>
            </form>
          </details>

          <details className="mt-1">
            <summary className="cursor-pointer py-2 text-sm text-muted">Kadroya oyuncu ekle / çıkar</summary>
            <Card className="mt-2 space-y-3">
              <ul className="space-y-1">
                {all.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{p.name}</span>
                    <form action={removeFromMatch}>
                      <Hidden groupId={groupId} matchId={matchId} />
                      <input type="hidden" name="playerId" value={p.id} />
                      <button className="rounded px-2 py-1 text-xs text-muted hover:bg-red-950 hover:text-red-300">
                        Çıkar
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              {bench.length > 0 && (
                <form action={addToMatch} className="flex gap-2">
                  <Hidden groupId={groupId} matchId={matchId} />
                  <select
                    name="playerId"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-pitch-950 px-2 text-sm"
                  >
                    {bench.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary">Ekle</Button>
                </form>
              )}
            </Card>
          </details>

          <SectionTitle>Maç bitti mi? Sonucu gir</SectionTitle>
          <form action={submitResult} className="space-y-3">
            <Hidden groupId={groupId} matchId={matchId} />
            <Card className="flex items-center justify-center gap-4">
              {(["A", "B"] as const).map((t, i) => (
                <div key={t} className="flex items-center gap-4">
                  {i === 1 && <span className="text-2xl text-muted">-</span>}
                  <label className="text-center">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      name={t === "A" ? "scoreA" : "scoreB"}
                      required
                      className={cx("h-16 w-20 text-center text-3xl font-black", !external && TEAM[t].text)}
                    />
                    <span className="mt-1 block max-w-20 truncate text-xs uppercase text-muted">{labels[t]}</span>
                  </label>
                </div>
              ))}
            </Card>
            <Card className="p-0">
              <div className="grid grid-cols-[1fr_repeat(3,3.25rem)] gap-1 border-b border-line px-3 py-2 text-[11px] uppercase text-muted">
                <span>Oyuncu</span>
                <span className="text-center">Gol</span>
                <span className="text-center">Asist</span>
                <span className="text-center">Kurt.</span>
              </div>
              {all.map((p) => (
                <div key={p.id} className="grid grid-cols-[1fr_repeat(3,3.25rem)] items-center gap-1 px-3 py-1.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {!external && <span className={cx("h-2 w-2 shrink-0 rounded-full", TEAM[p.team].bg)} />}
                    <span className="truncate">{p.name}</span>
                  </span>
                  {(["goals", "assists", "saves"] as const).map((k) => (
                    <input
                      key={k}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={99}
                      name={`${k}_${p.id}`}
                      placeholder="0"
                      className={cx(
                        "h-9 w-full rounded-lg border border-line bg-pitch-950 text-center text-sm",
                        k === "saves" && p.position !== "GK" && "opacity-40",
                      )}
                    />
                  ))}
                </div>
              ))}
            </Card>
            <Button className="w-full">Kaydet ve oylamayı başlat</Button>
            <p className="text-center text-xs text-muted">Oylama 24 saat açık kalır. Herkes oy verince sonuçlar hemen açıklanır.</p>
          </form>

          <form action={deleteMatch} className="mt-8 text-center">
            <Hidden groupId={groupId} matchId={matchId} />
            <button className="text-xs text-muted hover:text-red-300">Maçı iptal et</button>
          </form>
        </>
      )}
      {!canManage && (
        <p className="mt-4 text-center text-sm text-muted">
          Takımları, mevkileri ve sonucu maçı kuran kişi veya grup yöneticisi düzenler.
        </p>
      )}
    </>
  );
}

async function VotingView({
  groupId,
  matchId,
  roster,
  me,
  deadline,
  canManage,
  justVoted,
}: {
  groupId: string;
  matchId: string;
  roster: RosterEntry[];
  me?: RosterEntry;
  deadline: string | null;
  canManage: boolean;
  justVoted: boolean;
}) {
  const { supabase } = await requireUser();
  const [{ data: progressRaw }, { data: myVotes }, { data: myMvp }] = await Promise.all([
    supabase.rpc("voting_progress", { p_match_id: matchId }),
    me
      ? supabase.from("votes").select("target_id, score").eq("match_id", matchId).eq("voter_id", me.id)
      : Promise.resolve({ data: [] as { target_id: string; score: number }[] }),
    me
      ? supabase.from("mvp_votes").select("target_id").eq("match_id", matchId).eq("voter_id", me.id).maybeSingle()
      : Promise.resolve({ data: null as { target_id: string } | null }),
  ]);
  const progress = (Array.isArray(progressRaw) ? progressRaw[0] : progressRaw) as
    | { voters: number; eligible: number }
    | undefined;
  const hasVoted = (myVotes?.length ?? 0) > 0;
  const pct = progress && progress.eligible ? (progress.voters / progress.eligible) * 100 : 0;

  return (
    <>
      <Card className="mb-4">
        <div className="mb-2 flex justify-between text-sm">
          <span>
            <b>{progress?.voters ?? 0}</b>
            <span className="text-muted"> / {progress?.eligible ?? 0} kişi oy verdi</span>
          </span>
          <span className="text-muted">{timeLeft(deadline)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-pitch-950">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>

      {justVoted && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">
          Oyların kaydedildi ✓ Süre bitene kadar değiştirebilirsin.
        </p>
      )}

      {me && me.userId ? (
        <>
          <SectionTitle>{hasVoted ? "Oylarını güncelle" : "Arkadaşlarını puanla"}</SectionTitle>
          <VoteForm
            groupId={groupId}
            matchId={matchId}
            myTeam={me.team}
            targets={roster
              .filter((r) => r.id !== me.id)
              .map((r) => ({
                id: r.id,
                name: r.name,
                team: r.team,
                goals: r.goals,
                assists: r.assists,
                position: r.position,
              }))}
            initialScores={Object.fromEntries((myVotes ?? []).map((v) => [v.target_id, v.score]))}
            initialMvp={myMvp?.target_id ?? null}
          />
        </>
      ) : (
        <Card className="text-center text-sm text-muted">Bu maçta oynamadığın için oy veremezsin.</Card>
      )}

      {canManage && (
        <form action={closeVoting} className="mt-6">
          <Hidden groupId={groupId} matchId={matchId} />
          <Button variant="secondary" className="w-full">
            Oylamayı şimdi kapat ve sonuçları açıkla
          </Button>
        </form>
      )}
    </>
  );
}

async function ResultsView({
  groupId,
  matchId,
  roster,
  myId,
  external,
}: {
  groupId: string;
  matchId: string;
  roster: RosterEntry[];
  myId?: string;
  external: boolean;
}) {
  const { supabase } = await requireUser();
  const { data: results } = await supabase
    .from("match_results")
    .select("player_id, match_score, votes_received, rating_before, rating_after, is_mvp, weight")
    .eq("match_id", matchId);
  const byId = new Map((results ?? []).map((r) => [r.player_id, r]));
  const rows = roster
    .map((p) => ({ p, r: byId.get(p.id) }))
    .sort((a, b) => (b.r?.match_score ?? 0) - (a.r?.match_score ?? 0));
  const mvp = rows.find((x) => x.r?.is_mvp);

  return (
    <>
      {mvp && (
        <Card className="mb-4 flex items-center gap-4 border-amber-400/40 bg-amber-400/10">
          <div className="text-4xl">⭐</div>
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-300">Maçın adamı</div>
            <div className="text-xl font-black">{mvp.p.name}</div>
            <div className="text-sm text-muted">Maç puanı {mvp.r!.match_score.toFixed(1)}</div>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="grid grid-cols-[1.5rem_1fr_3rem_4.5rem] gap-2 border-b border-line px-3 py-2 text-[11px] uppercase text-muted">
          <span />
          <span>Oyuncu</span>
          <span className="text-center">Puan</span>
          <span className="text-right">Rating</span>
        </div>
        {rows.map(({ p, r }, i) => {
          const delta = r ? r.rating_after - r.rating_before : 0;
          return (
            <Link
              key={p.id}
              href={`/g/${groupId}/p/${p.id}`}
              className={cx(
                "grid grid-cols-[1.5rem_1fr_3rem_4.5rem] items-center gap-2 px-3 py-2.5 transition hover:bg-pitch-800",
                p.id === myId && "bg-accent/5",
              )}
            >
              <span className="text-sm font-bold text-muted">{i + 1}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  {!external && <span className={cx("h-2 w-2 shrink-0 rounded-full", TEAM[p.team].bg)} />}
                  <span className="truncate font-medium">{p.name}</span>
                  <PositionChip position={p.position} />
                  {r?.is_mvp && <span>⭐</span>}
                </span>
                <span className={cx("block text-xs text-muted", !external && "pl-4")}>
                  {[p.goals && `${p.goals} gol`, p.assists && `${p.assists} asist`, p.saves && `${p.saves} kurtarış`]
                    .filter(Boolean)
                    .join(" · ") || " "}
                </span>
              </span>
              <span className="text-center text-lg font-black tabular-nums">
                {r && r.weight > 0 ? r.match_score.toFixed(1) : "–"}
              </span>
              <span className="text-right text-sm tabular-nums">
                {r ? (
                  <>
                    <b>{r.rating_after}</b>{" "}
                    <span className={delta > 0 ? "text-accent" : delta < 0 ? "text-red-400" : "text-muted"}>
                      {delta > 0 ? `+${delta}` : delta < 0 ? delta : "±0"}
                    </span>
                  </>
                ) : (
                  "–"
                )}
              </span>
            </Link>
          );
        })}
      </Card>
      <p className="mt-3 text-center text-xs text-muted">
        Puanlar, herkesin kendi oy verme ölçeğine göre düzeltilmiş ve uç oylar atılmış ortalamadır.
      </p>
    </>
  );
}

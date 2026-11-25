import Link from "next/link";
import { InviteToMatchButton } from "@/components/SendInviteLink";
import { Icon } from "@/components/Icon";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeExpired } from "@/lib/finalize";
import { formatDate, getGroupPlayers, getGroupSummaries, one, POSITION_NAME, POSITIONS, type Position } from "@/lib/data";
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
import { CONFIG } from "@/lib/rating";
import { teamRating } from "@/lib/teams-data";
import { getFormation, inferSize } from "@/lib/formations";
import { LineupPitch, type PitchPlayer } from "@/components/LineupPitch";
import { LineupEditor } from "./LineupEditor";
import { LiveRefresh } from "@/components/LiveRefresh";
import { GuestForm } from "./GuestForm";
import { FillSection } from "./FillSection";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { fillCallsOfMatch, gatherCallOfMatch, myManagedCommunities, type Call } from "@/lib/calls-data";
import { SubmitButton } from "@/components/SubmitButton";
import { PushPrompt } from "@/components/PushControls";
import { TeamBadge } from "@/components/TeamBadge";
import { SkillQueueBanner } from "@/components/SkillQueueBanner";
import { Badge, Button, Card, ErrorNote, Header, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip, shortName } from "@/components/PlayerCard";
import { VoteForm } from "./VoteForm";
import { WithdrawalSection, type WithdrawalRow } from "./WithdrawalSection";

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
  cardName: string | null;
  photoUrl: string | null;
  userId: string | null;
  position: Position | null;
  team: Team;
  isGoalkeeper: boolean;
  /** Dizilişteki yeri; boşsa yedek */
  slot: number | null;
  goals: number;
  assists: number;
  saves: number;
  overall: number;
  /** Profil kartı için: özellikler, forma numarası, geçici rating */
  attributes: { key: string; value: number | null }[];
  city: string | null;
  district: string | null;
}

type GP = { display_name: string; user_id: string | null; position: Position | null };

/** Bir maçın kadrosu; ratingler maçın kendi grubundan (rakip takımınki de okunabilir) */
async function fetchRoster(supabase: SupabaseClient, matchId: string, groupId: string): Promise<RosterEntry[]> {
  const [{ data: rows }, players] = await Promise.all([
    supabase
      .from("match_players")
      .select("player_id, team, is_goalkeeper, position, slot, goals, assists, saves, group_players(display_name, user_id, position)")
      .eq("match_id", matchId),
    getGroupSummaries(supabase, groupId, { includeLeft: true }),
  ]);
  const summary = new Map(players.map((p) => [p.id, p]));
  return (rows ?? [])
    .map((r) => {
      const gp = one(r.group_players as GP | GP[]);
      return {
        id: r.player_id,
        name: gp?.display_name ?? "?",
        cardName: summary.get(r.player_id)?.card_name ?? null,
        photoUrl: summary.get(r.player_id)?.photo_url ?? null,
        userId: gp?.user_id ?? null,
        // Maça özel mevki; yoksa oyuncunun genel mevkisi
        position: (r.position as Position | null) ?? (r.is_goalkeeper ? "GK" : (gp?.position ?? null)),
        team: r.team as Team,
        isGoalkeeper: r.is_goalkeeper,
        slot: r.slot,
        goals: r.goals,
        assists: r.assists,
        saves: r.saves,
        overall: summary.get(r.player_id)?.overall ?? 65,
        attributes: summary.get(r.player_id)?.skills ?? [],
        city: summary.get(r.player_id)?.city ?? null,
        district: summary.get(r.player_id)?.district ?? null,
      };
    })
    .sort(
      (a, b) =>
        POSITIONS.indexOf(a.position ?? ("Z" as Position)) - POSITIONS.indexOf(b.position ?? ("Z" as Position)) ||
        b.overall - a.overall,
    );
}

/** Maç kadrosu satırı → sahadaki profil kartı verisi */
const toPitch = (r: RosterEntry): PitchPlayer => ({
  id: r.id,
  name: r.name,
  cardName: r.cardName,
  photoUrl: r.photoUrl,
  overall: r.overall,
  position: r.position,
  attributes: r.attributes,
  city: r.city,
  district: r.district,
});

interface TeamInfo {
  id: string;
  name: string;
  color: string | null;
  city: string | null;
  district: string | null;
}

interface Opponent {
  team: TeamInfo;
  match: {
    id: string;
    status: string;
    score_a: number | null;
    score_b: number | null;
    team_size: number | null;
    formation_a: string | null;
  };
  roster: RosterEntry[];
}

/** Takımlar arası maçta karşı tarafın maçı, takımı ve kadrosu (takımlar herkese açık olduğundan okunabilir) */
async function loadOpponent(
  supabase: SupabaseClient,
  challengeId: string,
  myMatchId: string,
  oppGroupId: string | null,
): Promise<Opponent | null> {
  const { data: m } = await supabase
    .from("matches")
    .select("id, group_id, status, score_a, score_b, team_size, formation_a")
    .eq("challenge_id", challengeId)
    .neq("id", myMatchId)
    .maybeSingle();
  const groupId = m?.group_id ?? oppGroupId;
  if (!m || !groupId) return null;
  const [{ data: team }, roster] = await Promise.all([
    supabase.from("groups").select("id, name, color, city, district").eq("id", groupId).single(),
    fetchRoster(supabase, m.id, groupId),
  ]);
  if (!team) return null;
  return { team, match: m, roster };
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
  searchParams: Promise<{ error?: string; voted?: string; positions?: string; kabul?: string; dizilis?: string; cekilme?: string }>;
}) {
  const { groupId, matchId } = await params;
  const { error, voted, positions, kabul, dizilis, cekilme } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: first } = await supabase
    .from("matches")
    .select("id, group_id, status")
    .eq("id", matchId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!first) notFound();
  if (first.status === "voting") await finalizeExpired(groupId);

  const [{ data: match }, roster, players, { data: canManage }, { data: myTeam }, { data: isAdmin }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, voting_deadline, kind, opponent_name, challenge_id, opponent_group_id, team_size, formation_a, formation_b")
      .eq("id", matchId)
      .single(),
    fetchRoster(supabase, matchId, groupId),
    getGroupPlayers(supabase, groupId),
    supabase.rpc("can_manage_match", { p_match_id: matchId }),
    supabase.from("groups").select("name, color, kind").eq("id", groupId).single(),
    // Misafiri sadece kaptan/yetkili ekler (0042)
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
  ]);
  if (!match) notFound();
  const myTeamName = myTeam?.name ?? "Biz";
  // Planlı maçın açık "adam ara" çağrıları (görebildiğim gruplardakiler) ve maçı kuran toplama çağrısı (yedekler)
  const planned = match.status === "planned";
  const [fills, gatherCall, communities] = planned
    ? await Promise.all([
        fillCallsOfMatch(supabase, matchId),
        canManage ? gatherCallOfMatch(supabase, matchId) : Promise.resolve(null),
        canManage ? myManagedCommunities(supabase, user.id) : Promise.resolve([]),
      ])
    : [[], null, []];
  const myTeamColor = myTeam?.color ?? null;
  const opp = match.challenge_id
    ? await loadOpponent(supabase, match.challenge_id, matchId, match.opponent_group_id)
    : null;
  const linked = !!match.challenge_id;

  const external = match.kind === "external";
  const oppName = opp?.team.name ?? match.opponent_name;
  const labels = labelsFor(external, oppName);

  const me = roster.find((r) => r.userId === user.id);
  // Maçtan çekilme istekleri (RLS: oyuncu kendininkini, yetkili hepsini görür); sadece planlanmış maçta anlamlı
  let withdrawals: WithdrawalRow[] = [];
  if (match.status === "planned" && (me || canManage)) {
    const { data: wRows } = await supabase
      .from("match_withdrawals")
      .select("id, player_id, reason, late, status, created_at, group_players(display_name)")
      .eq("match_id", matchId)
      .order("created_at", { ascending: false })
      .limit(50);
    withdrawals = (wRows ?? []).map((w) => ({
      id: w.id,
      player_id: w.player_id,
      reason: w.reason,
      late: w.late,
      status: w.status as WithdrawalRow["status"],
      created_at: w.created_at,
      name: (Array.isArray(w.group_players) ? w.group_players[0] : w.group_players)?.display_name ?? "Oyuncu",
    }));
  }
  const teams = { A: roster.filter((r) => r.team === "A"), B: roster.filter((r) => r.team === "B") };
  const avg = (t: RosterEntry[]) =>
    t.length ? Math.round((t.reduce((s, p) => s + p.overall, 0) / t.length) * 10) / 10 : 0;

  const statusBadge =
    match.status === "planned" ? (
      <Badge>Planlandı</Badge>
    ) : match.status === "played" ? (
      <Badge tone="warn">Skor onayı</Badge>
    ) : match.status === "voting" ? (
      <Badge tone="warn">Oylama</Badge>
    ) : (
      <Badge tone="accent">Tamamlandı</Badge>
    );

  return (
    <main>
      <LiveRefresh
        pollMs={match.status === "voting" ? 15000 : undefined}
        watches={[
          { table: "matches", filter: `id=eq.${matchId}` },
          { table: "match_players", filter: `match_id=eq.${matchId}` },
          { table: "match_results", filter: `match_id=eq.${matchId}` },
          { table: "match_withdrawals", filter: `match_id=eq.${matchId}` },
          ...(planned ? [{ table: "match_polls", filter: `match_id=eq.${matchId}` }] : []),
          ...(match.challenge_id
            ? [
                // Karşı takımın maçı, kadrosu ve sonuçları; teklif iptali (maçlar silinir, teklifin durumu güncellenir)
                { table: "matches", filter: `challenge_id=eq.${match.challenge_id}` },
                { table: "match_challenges", filter: `id=eq.${match.challenge_id}` },
                ...(opp
                  ? [
                      { table: "match_players", filter: `match_id=eq.${opp.match.id}` },
                      { table: "match_results", filter: `match_id=eq.${opp.match.id}` },
                    ]
                  : []),
              ]
            : []),
        ]}
      />
      <Header title={external ? `vs ${oppName}` : "Kendi aramızda"} back={`/g/${groupId}`} />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-on-surface-variant">
        {statusBadge}
        <span className="inline-flex items-center gap-1">
          <Icon name="calendar_today" className="text-[16px]" />
          {formatDate(match.played_at)}
        </span>
        {match.team_size ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="groups" className="text-[16px]" />
            {match.team_size} kişilik
          </span>
        ) : null}
        {match.venue ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Icon name="stadium" className="text-[16px]" />
            <span className="truncate">{match.venue}</span>
          </span>
        ) : null}
      </div>
      <ErrorNote message={error} />
      {canManage && match.status === "planned" && <InviteToMatchButton groupId={groupId} matchId={matchId} className="mb-4" />}
      {!canManage &&
        fills
          .filter((f) => f.status === "open")
          .map((f) => (
            <Link key={f.id} href={`/g/${f.group_id}/cagri/${f.id}`} className="mb-4 block">
              <Card className="flex items-center gap-3 border-amber-400/40 bg-amber-400/10 transition hover:border-amber-400">
                <Icon name="person_search" fill className="text-[24px] text-amber-300" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{f.capacity} oyuncu aranıyor</div>
                  <div className="truncate text-xs text-muted">
                    {f.positions.length ? f.positions.map((p) => POSITION_NAME[p as Position]).join(", ") + " · " : ""}
                    {f.group_name} · çağrıyı gör ve başvur
                  </div>
                </div>
                <Icon name="chevron_right" className="text-[22px] text-amber-300" />
              </Card>
            </Link>
          ))}
      {kabul && (
        <p className="mb-4 flex items-start gap-1.5 rounded-xl bg-primary/10 p-3 text-sm text-primary">
          <Icon name="check_circle" fill className="mt-0.5 text-[18px]" />
          <span>Teklif kabul edildi. Şimdi kadronu belirle. Rakip takım da kendi kadrosunu belirliyor.</span>
        </p>
      )}
      {positions && (
        <p className="mb-4 flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary"><Icon name="check_circle" fill className="text-[18px]" />Mevkiler kaydedildi</p>
      )}
      {dizilis && (
        <p className="mb-4 flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary"><Icon name="check_circle" fill className="text-[18px]" />Diziliş kaydedildi. Rakip takım da görebilir.</p>
      )}

      {linked && opp && <VersusCard mine={{ id: groupId, name: myTeamName, color: myTeamColor, roster }} opp={opp} />}
      {external && !opp && match.status !== "planned" && roster.length > 0 && (
        <VersusCard mine={{ id: groupId, name: myTeamName, color: myTeamColor, roster }} opp={null} />
      )}

      {match.status !== "planned" && (
        <Card className="mb-4 flex items-center justify-around bg-gradient-to-br from-primary/10 via-surface-container to-surface-container py-5 shadow-md">
          {(["A", "B"] as const).map((t, i) => (
            <div key={t} className="flex items-center gap-4">
              {i === 1 && <span className="text-2xl text-muted">-</span>}
              <div className="text-center">
                <div className={cx("font-display text-5xl font-bold tabular-nums", external ? (t === "A" ? "text-on-surface" : "text-on-surface-variant") : TEAM[t].text)}>
                  {t === "A" ? match.score_a : match.score_b}
                </div>
                <div className="mt-1 max-w-28 truncate text-xs uppercase text-muted">{labels[t]}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <LineupsSection
        sides={
          external
            ? [
                { key: "me", title: myTeamName, groupId, size: match.team_size, formationId: match.formation_a, roster },
                ...(opp
                  ? [{ key: "opp", title: opp.team.name, groupId: opp.team.id, size: opp.match.team_size, formationId: opp.match.formation_a, roster: opp.roster }]
                  : []),
              ]
            : [
                { key: "A", title: TEAM.A.label, groupId, size: match.team_size, formationId: match.formation_a, roster: teams.A },
                { key: "B", title: TEAM.B.label, groupId, size: match.team_size, formationId: match.formation_b, roster: teams.B },
              ]
        }
      />

      {match.status === "planned" && (
        <WithdrawalSection
          groupId={groupId}
          matchId={matchId}
          playedAt={match.played_at}
          myPlayerId={me?.id ?? null}
          canManage={!!canManage}
          rows={withdrawals}
          flash={cekilme}
        />
      )}

      {match.status === "planned" && (
        <PlannedView
          groupId={groupId}
          matchId={matchId}
          teams={teams}
          avg={avg}
          canManage={!!canManage}
          isAdmin={!!isAdmin}
          external={external}
          labels={labels}
          linked={linked}
          teamSize={match.team_size}
          formations={{ A: match.formation_a, B: match.formation_b }}
          groupLabel={myTeam?.name ?? ""}
          fills={fills}
          gatherCall={gatherCall}
          communities={communities}
          bench={players
            .filter((p) => !roster.some((r) => r.id === p.id))
            .sort((a, b) => a.display_name.localeCompare(b.display_name, "tr"))}
        />
      )}

      {match.status === "played" && (
        <PlayedView
          groupId={groupId}
          matchId={matchId}
          roster={roster}
          canManage={!!canManage}
          labels={labels}
          mine={{ a: match.score_a, b: match.score_b }}
          opp={opp}
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
          opp={opp}
        />
      )}

      {match.status === "closed" && (
        <ResultsView groupId={groupId} matchId={matchId} roster={roster} myId={me?.id} external={external} />
      )}

      {linked && opp && <OpponentSection opp={opp} />}
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
  isAdmin,
  external,
  labels,
  linked,
  teamSize,
  formations,
  groupLabel,
  fills,
  gatherCall,
  communities,
  bench,
}: {
  groupId: string;
  matchId: string;
  teams: Record<Team, RosterEntry[]>;
  avg: (t: RosterEntry[]) => number;
  canManage: boolean;
  isAdmin: boolean;
  external: boolean;
  labels: Labels;
  linked: boolean;
  teamSize: number | null;
  formations: Record<Team, string | null>;
  groupLabel: string;
  fills: (Call & { group_name: string })[];
  gatherCall: { id: string; group_id: string } | null;
  communities: { id: string; name: string }[];
  bench: { id: string; display_name: string }[];
}) {
  const all = [...teams.A, ...teams.B];
  const counts = Object.fromEntries(POSITIONS.map((p) => [p, all.filter((r) => r.position === p).length]));

  return (
    <>
      {linked && all.length === 0 && (
        <Card className="mb-3 border-amber-400/40 bg-amber-400/10 text-center text-sm text-amber-200">
          Kadro boş. {canManage ? "Aşağıdan oyuncuları ekle; rakip takım da bu ekrandan kadronu görebilir." : "Kaptan veya yetkililer kadroyu belirler."}
        </Card>
      )}
      {linked ? null : external ? (
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
                <Link href={`/g/${groupId}/p/${p.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {shortName(p.name)}
                </Link>
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
                    <Link href={`/g/${groupId}/p/${p.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      {shortName(p.name)}
                    </Link>
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
                <Icon name="shuffle" className="text-[20px]" />
                Takımları yeniden karıştır
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

          <AutoOpenDetails
            className="mt-1"
            openInitially={false}
            summary={
              <span className="inline-flex items-center gap-1.5 align-middle">
                <Icon name="person_search" className="text-[18px]" />
                Adam ara
                {fills.length > 0 && ` · ${fills.filter((f) => f.status === "open").length} açık`}
              </span>
            }
          >
            <Card className="mt-2">
              <FillSection groupId={groupId} matchId={matchId} groupLabel={groupLabel} fills={fills} communities={communities} gatherCall={gatherCall} />
            </Card>
          </AutoOpenDetails>

          <details className="mt-1">
            <summary className="cursor-pointer py-2 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5 align-middle">
                <Icon name="sports" className="text-[18px]" />
                Diziliş (sürükle-bırak)
              </span>
            </summary>
            <div className="mt-2 space-y-6">
              {(external ? (["A"] as const) : (["A", "B"] as const)).map((t) => {
                const mine = teams[t];
                if (mine.length === 0) {
                  return (
                    <p key={t} className="text-center text-sm text-muted">
                      Önce kadroya oyuncu ekle; sonra dizilişi ayarlayabilirsin.
                    </p>
                  );
                }
                return (
                  <div key={t}>
                    {!external && <div className={cx("mb-2 text-sm font-bold", TEAM[t].text)}>{labels[t]}</div>}
                    <LineupEditor
                      key={`${t}-${mine.map((p) => p.id).join()}`}
                      groupId={groupId}
                      matchId={matchId}
                      team={t}
                      size={teamSize ?? inferSize(mine.length)}
                      players={mine.map(toPitch)}
                      initialFormation={formations[t]}
                      initialAssign={Object.fromEntries(mine.map((p) => [p.id, p.slot]))}
                    />
                  </div>
                );
              })}
            </div>
          </details>

          <details className="mt-1" open={linked && all.length === 0}>
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
                <form action={addToMatch} className="space-y-2">
                  <Hidden groupId={groupId} matchId={matchId} />
                  <div className="text-xs uppercase tracking-wide text-muted">Eklenecekleri seç</div>
                  <ul className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
                    {bench.map((p) => (
                      <li key={p.id}>
                        <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-2 text-sm has-checked:border-accent has-checked:bg-accent/10">
                          <input type="checkbox" name="playerId" value={p.id} className="accent-accent" />
                          <span className="truncate">{p.display_name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <SubmitButton variant="secondary" className="w-full" pendingLabel="Ekleniyor…">
                    Seçilenleri ekle
                  </SubmitButton>
                </form>
              )}
              {isAdmin && <GuestForm groupId={groupId} matchId={matchId} />}
            </Card>
          </details>

          <SectionTitle>Maç bitti mi? Sonucu gir</SectionTitle>
          <ResultForm groupId={groupId} matchId={matchId} all={all} external={external} labels={labels} linked={linked} allowNoShow />

          <form action={deleteMatch} className="mt-8 text-center">
            <Hidden groupId={groupId} matchId={matchId} />
            <button className="text-xs text-muted hover:text-red-300">
              {linked ? "Maçı iptal et (rakip takımda da silinir)" : "Maçı iptal et"}
            </button>
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

function ResultForm({
  groupId,
  matchId,
  all,
  external,
  labels,
  linked,
  score,
  allowNoShow = false,
}: {
  groupId: string;
  matchId: string;
  all: RosterEntry[];
  external: boolean;
  labels: Labels;
  linked: boolean;
  score?: { a: number | null; b: number | null };
  /** "Gelmedi" işareti sadece planlanmış maçta (skor düzeltmesinde gösterilmez) */
  allowNoShow?: boolean;
}) {
  return (
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
                defaultValue={(t === "A" ? score?.a : score?.b) ?? undefined}
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
            <span className="min-w-0 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {!external && <span className={cx("h-2 w-2 shrink-0 rounded-full", TEAM[p.team].bg)} />}
                <span className="truncate">{p.name}</span>
              </span>
              {allowNoShow && (
                <label className="mt-0.5 flex w-fit cursor-pointer items-center gap-1 text-[11px] text-muted has-checked:text-red-300">
                  <input type="checkbox" name="noshow" value={p.id} className="accent-red-400" />
                  gelmedi
                </label>
              )}
            </span>
            {(["goals", "assists", "saves"] as const).map((k) => (
              <input
                key={k}
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                name={`${k}_${p.id}`}
                defaultValue={p[k] || undefined}
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
      <Button className="w-full">{linked ? "Skoru kaydet" : "Kaydet ve oylamayı başlat"}</Button>
      <p className="text-center text-xs text-muted">
              {linked
                ? "Rakip takım da skoru girer. Skorlar eşleşince iki takımda da 24 saatlik oylama açılır."
                : "Oylama 24 saat açık kalır. Herkes oy verince sonuçlar hemen açıklanır."}
            </p>
    </form>
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
  opp,
}: {
  groupId: string;
  matchId: string;
  roster: RosterEntry[];
  me?: RosterEntry;
  deadline: string | null;
  canManage: boolean;
  justVoted: boolean;
  opp: Opponent | null;
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
          Oyların kaydedildi. Süre bitene kadar değiştirebilirsin.
        </p>
      )}
      {justVoted && <PushPrompt reason="Sonuçlar açıklanınca haber verelim mi?" />}
      {justVoted && <SkillQueueBanner supabase={supabase} className="mb-4 block" />}

      {me && me.userId ? (
        <>
          <SectionTitle>{hasVoted ? "Oylarını güncelle" : "Arkadaşlarını puanla"}</SectionTitle>
          <VoteForm
            groupId={groupId}
            matchId={matchId}
            myTeam={me.team}
            rivalLabel={opp ? `Rakip takım · ${opp.team.name}` : undefined}
            targets={[
              ...roster.filter((r) => r.id !== me.id),
              // Takımlar arası maçta rakip takımın oyuncuları da oylanır
              ...(opp?.roster.map((r) => ({ ...r, team: "B" as Team })) ?? []),
            ].map((r) => ({
                id: r.id,
                name: r.name,
                photoUrl: r.photoUrl,
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

      {opp && (
        <p className="mt-4 rounded-xl bg-pitch-800 p-3 text-center text-xs text-muted">
          Sahadaki herkes kendi dışındaki herkesi puanlar. Bir oyuncunun maç puanının %{Math.round(CONFIG.RIVAL_SHARE * 100)}&apos;ı
          rakip takımın, %{Math.round((1 - CONFIG.RIVAL_SHARE) * 100)}&apos;ı kendi takımının oylarından gelir; böylece kimse
          kendi takımını şişiremez. Oylama süre dolunca veya herkes oy verince iki takımda birden kapanır.
        </p>
      )}

      {canManage && !opp && (
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
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20">
            <Icon name="star" fill className="text-[34px] text-gold-1" />
          </span>
          <div className="min-w-0">
            <div className="t-label-caps uppercase text-amber-300">Maçın adamı</div>
            <div className="truncate font-display text-xl font-bold">{mvp.p.name}</div>
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
                  {r?.is_mvp && <Icon name="star" fill className="text-[16px] text-gold-1" />}
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

// ---------------------------------------------------------------------------
// Takımlar arası maç: karşılaşma kartı, skor onayı, rakip kadro
// ---------------------------------------------------------------------------

/** İki takım yan yana: üstte ad ve takım rating'i (en iyi 7), altında iki sütunda oyuncular ve ratingleri */
function VersusCard({
  mine,
  opp,
}: {
  mine: { id: string; name: string; color: string | null; roster: RosterEntry[] };
  opp: Opponent | null;
}) {
  // Rakip sistemde kayıtlı değilse (sadece yazılmış ad) yalnızca kendi kadromuz gösterilir
  const sides = [
    { id: mine.id, name: mine.name, color: mine.color, roster: mine.roster, self: true },
    ...(opp ? [{ id: opp.team.id, name: opp.team.name, color: opp.team.color, roster: opp.roster, self: false }] : []),
  ];
  const single = sides.length === 1;
  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className={cx("grid items-start gap-2 px-3 py-4", single ? "grid-cols-1" : "grid-cols-[1fr_auto_1fr]")}>
        {sides.map((t, i) => (
          <div key={t.id} className="contents">
            {i === 1 && <span className="mt-3 text-sm font-bold text-muted">VS</span>}
            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <TeamBadge name={t.name} color={t.color} size="md" />
              {t.self ? (
                <span className="max-w-full truncate text-sm font-bold">{t.name}</span>
              ) : (
                <Link href={`/g/${t.id}`} className="max-w-full truncate text-sm font-bold hover:text-accent">
                  {t.name}
                </Link>
              )}
              <div className="flex items-center gap-1.5">
                <OvrBadge overall={teamRating(t.roster.map((p) => p.overall))} className={cx("h-7 w-7 text-xs", t.roster.length === 0 && "opacity-40")} />
                <span className="text-xs text-muted">{t.roster.length} kişi</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={cx("grid divide-x divide-line border-t border-line", single ? "grid-cols-1" : "grid-cols-2")}>
        {sides.map((t) => (
          <ul key={t.id} className="min-w-0 space-y-1.5 p-3">
            {t.roster.length === 0 && <li className="py-2 text-center text-xs text-muted">Kadro bekleniyor</li>}
            {t.roster.map((p) => (
              <li key={p.id}>
                <Link href={`/g/${t.id}/p/${p.id}`} className="flex items-center gap-1.5 rounded-md transition hover:bg-pitch-800">
                  <OvrBadge overall={p.overall} className="h-7 w-7 shrink-0 text-xs" />
                  <span className="min-w-0 flex-1 truncate text-sm">{shortName(p.name)}</span>
                  <PositionChip position={p.position} />
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Card>
  );
}

/** Skor girildi ama rakip henüz girmedi / skorlar uyuşmuyor */
function PlayedView({
  groupId,
  matchId,
  roster,
  canManage,
  labels,
  mine,
  opp,
}: {
  groupId: string;
  matchId: string;
  roster: RosterEntry[];
  canManage: boolean;
  labels: Labels;
  mine: { a: number | null; b: number | null };
  opp: Opponent | null;
}) {
  const oppEntered = opp?.match.status === "played";
  // Rakibin girdiği skor bizim açımızdan: biz = onların kalesine attığımız (score_b), onlar = score_a
  const theirView = oppEntered ? { us: opp!.match.score_b, them: opp!.match.score_a } : null;
  return (
    <>
      <Card className={cx("mb-4 space-y-1 text-sm", oppEntered ? "border-red-400/40" : "border-amber-400/40")}>
        {oppEntered ? (
          <>
            <div className="font-semibold text-red-300">Skorlar uyuşmuyor</div>
            <p className="text-muted">
              Senin girdiğin: <b className="text-white">{mine.a}-{mine.b}</b> · {opp!.team.name} takımının girdiği:{" "}
              <b className="text-white">{theirView!.us}-{theirView!.them}</b>. İki takım da doğru skoru girene kadar
              oylama açılmaz; aşağıdan düzeltebilirsin.
            </p>
          </>
        ) : (
          <>
            <div className="font-semibold text-amber-300">Rakibin skor girmesi bekleniyor</div>
            <p className="text-muted">
              {opp?.team.name ?? "Rakip takım"} skoru girince ve skorlar eşleşince iki takımda da oylama açılır.
              Yanlış girdiysen aşağıdan düzeltebilirsin.
            </p>
          </>
        )}
      </Card>
      {canManage ? (
        <details open={oppEntered}>
          <summary className="cursor-pointer py-2 text-sm text-muted">Skoru ve istatistikleri düzenle</summary>
          <ResultForm groupId={groupId} matchId={matchId} all={roster} external labels={labels} linked score={mine} />
        </details>
      ) : (
        <p className="text-center text-sm text-muted">Skoru kaptan veya yetkililer girer.</p>
      )}
    </>
  );
}

/** Maç kapanınca rakip takımın oyuncu puanları (kadro zaten karşılaşma kartında) */
function OpponentSection({ opp }: { opp: Opponent }) {
  if (opp.match.status !== "closed") return null;
  return (
    <>
      <SectionTitle
        action={
          <Link href={`/g/${opp.team.id}`} className="text-xs text-accent">
            Takım sayfası ›
          </Link>
        }
      >
        Rakip takım sonuçları · {opp.team.name}
      </SectionTitle>
      <ResultsView groupId={opp.team.id} matchId={opp.match.id} roster={opp.roster} external />
      <p className="mt-2 text-center text-xs text-muted">
        Her takım kendi oyuncularını puanlar; rakip oyuncuların puanları senin kartlarını etkilemez.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dizilişler (herkes görür)
// ---------------------------------------------------------------------------

interface LineupSide {
  key: string;
  title: string;
  groupId: string;
  size: number | null;
  formationId: string | null;
  roster: RosterEntry[];
}

/** Kaydedilmiş dizilişleri sahada kartlarla gösterir; hiç diziliş yoksa görünmez */
function LineupsSection({ sides }: { sides: LineupSide[] }) {
  const shown = sides.flatMap((side) => {
    const formation = getFormation(side.size ?? inferSize(side.roster.length), side.formationId);
    if (!formation || !side.roster.some((r) => r.slot !== null)) return [];
    return [{ side, formation }];
  });
  if (!shown.length) return null;
  return (
    <>
      <SectionTitle>Dizilişler</SectionTitle>
      <div className="space-y-4">
        {shown.map(({ side, formation }) => {
          const placed = new Map<number, PitchPlayer>(
            side.roster
              .filter((r) => r.slot !== null)
              .map((r) => [r.slot as number, toPitch(r)]),
          );
          const bench = side.roster.filter((r) => r.slot === null);
          return (
            <div key={side.key}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-bold">{side.title}</span>
                <span className="text-sm font-black tabular-nums text-accent">{formation.id}</span>
              </div>
              <LineupPitch slots={formation.slots} placed={placed} playerHref={(id) => `/g/${side.groupId}/p/${id}`} />
              {bench.length > 0 && (
                <p className="mt-1.5 text-xs text-muted">Yedek: {bench.map((r) => shortName(r.name)).join(", ")}</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

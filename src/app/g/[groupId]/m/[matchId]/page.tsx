import Link from "next/link";
import { GatheringPanel, type EntryStatus } from "./GatheringPanel";
import { matchWhen, feeText } from "@/lib/match-rules";
import { Icon } from "@/components/Icon";
import { notFound } from "next/navigation";
import { NoMatchAccess } from "@/components/NoMatchAccess";
import { requireUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeExpired } from "@/lib/finalize";
import { formatDate, getGroupPlayers, getGroupSummaries, one, POSITION_NAME, POSITIONS, type GroupPlayer, type Position } from "@/lib/data";
import { closeVoting, submitResult } from "@/lib/actions";
import { CONFIG } from "@/lib/rating";
import { teamRating } from "@/lib/teams-data";
import { inferSize } from "@/lib/formations";
import type { PitchPlayer } from "@/components/LineupPitch";
import { LineupStage, type StageSide } from "./LineupStage";
import { LiveRefresh } from "@/components/LiveRefresh";
import { AddPlayer, type Person } from "./AddPlayer";
import { Applications, Invitees, ListingManage, ScheduleManage, type EntryRow } from "./ManageSections";
import { RivalSection, type RivalOffer } from "./RivalSection";
import { RosterBoard, type BoardPerson } from "./RosterBoard";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { applyMatch, cancelApplication } from "@/lib/match-manage-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { PushPrompt } from "@/components/PushControls";
import { TeamBadge } from "@/components/TeamBadge";
import { SkillQueueBanner } from "@/components/SkillQueueBanner";
import { Badge, Button, Card, ErrorNote, Header, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge, PositionChip, shortName } from "@/components/PlayerCard";
import { VoteForm, VoteHeader } from "./VoteForm";
import { MatchSummary, type SummarySide } from "./MatchSummary";
import { ResultsView } from "./ResultsView";
import { WithdrawalSection, type WithdrawalRow } from "./WithdrawalSection";

type Team = "A" | "B";

/** Yönetim eylemlerinden sonra kısa onay (?ok=) */
const OK_TEXT: Record<string, string> = {
  eklendi: "Kadroya alındı; bildirim gitti.",
  cikarildi: "Kadrodan çıkarıldı.",
  "basvuru-in": "Başvuru kabul edildi, kadroya alındı.",
  "basvuru-reserve": "Başvuru kabul edildi; kadro dolu olduğu için yedeğe yazıldı.",
  "basvuru-rejected": "Başvuru reddedildi.",
  basvuru: "Başvurun gönderildi; maçı ayarlayan onaylayınca haber vereceğiz.",
  ilan: "İlan açıldı.",
  "ilan-kapandi": "İlan kapatıldı.",
  kod: "Bağlantı yenilendi; eski bağlantı artık çalışmaz.",
  rakip: "Rakip kaydedildi.",
  teklif: "Teklif gönderildi; rakibin yanıtı bekleniyor.",
  "teklif-geri": "Teklif geri çekildi; yeni rakip seçebilirsin.",
  "tarih-onerildi": "Tarih önerisi rakibe gitti.",
  "tarih-reddedildi": "Tarih önerisi reddedildi.",
  ertelendi: "Maçın tarihi değişti; kadroya bildirim gitti.",
  kesin: "Maç kesinleşti; kadroya bildirim gitti.",
  iptal: "Maç iptal edildi; herkese bildirim gitti.",
  "davet-iptal": "Davet geri çekildi.",
  "davet-onaylanmadi": "Davet onaylanmadı.",
};
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
  logo: string | null;
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
    supabase.from("groups").select("id, name, color, logo, city, district").eq("id", groupId).single(),
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
  searchParams: Promise<{ error?: string; voted?: string; kabul?: string; dizilis?: string; cekilme?: string; yanit?: string; ok?: string }>;
}) {
  const { groupId, matchId } = await params;
  const { error, voted, kabul, dizilis, cekilme, yanit, ok } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: first } = await supabase
    .from("matches")
    .select("id, group_id, status")
    .eq("id", matchId)
    .eq("group_id", groupId)
    .maybeSingle();
  // Çıkarılan / daveti iptal edilen kişiye satır dönmez (0056)
  if (!first) return <NoMatchAccess title="Maç" />;
  if (first.status === "voting") await finalizeExpired(groupId);

  const [{ data: match }, roster, players, { data: canManage }, { data: myTeam }, { data: isAdmin }, { data: myEntry }, { data: isMember }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, voting_deadline, kind, opponent_name, challenge_id, opponent_group_id, team_size, formation_a, formation_b, time_tbd, capacity, roster_count, reserve_count, open_to_members, cancel_reason, fee_per_person")
      .eq("id", matchId)
      .single(),
    fetchRoster(supabase, matchId, groupId),
    getGroupPlayers(supabase, groupId),
    supabase.rpc("can_manage_match", { p_match_id: matchId }),
    supabase.from("groups").select("name, color, logo, kind, city").eq("id", groupId).single(),
    // Misafiri sadece kaptan/yetkili ekler (0042)
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
    // Yeni maç yapısı (0042): benim kaydım (kadro/yedek/davetli/başvuru) ve üyeliğim
    supabase.from("match_entries").select("status").eq("match_id", matchId).eq("user_id", user.id).maybeSingle(),
    supabase.rpc("is_group_member", { p_group_id: groupId }),
  ]);
  if (!match) notFound();
  const myTeamName = myTeam?.name ?? "Biz";
  const planned = match.status === "planned";
  const open = match.status === "gathering" || planned;
  const manage = open && !!canManage;
  // Yönetim verisi (yeniden tasarım 4b): kayıtlar, ilanlar, bağlantı kodu, hedef gruplar, rakip teklifi
  const [entryRows, listingRows, code, targetRows, lastChallenge, applyListing] = await Promise.all([
    open
      ? supabase.from("match_entries").select("user_id, player_id, status, source, position, note, queued_at, created_at, profiles!match_entries_user_id_fkey(display_name), group_players(display_name, position)").eq("match_id", matchId).then((r) => r.data ?? [])
      : Promise.resolve([]),
    manage
      ? supabase.from("match_listings").select("id, status, target_group_id, groups(name)").eq("match_id", matchId).in("status", ["pending", "active"]).then((r) => r.data ?? [])
      : Promise.resolve([]),
    manage ? supabase.rpc("match_invite_code", { p_match: matchId }).then((r) => (r.data as string | null) ?? null) : Promise.resolve(null),
    manage
      ? supabase.from("group_players").select("groups(id, name)").eq("user_id", user.id).is("left_at", null).eq("is_loan", false).neq("group_id", groupId).then((r) => r.data ?? [])
      : Promise.resolve([]),
    // Bu maçtan giden son teklif (RLS: iki takımın üyeleri okur); geri çekilen sayılmaz
    open && match.kind === "external" && !match.challenge_id
      ? supabase.from("match_challenges").select("id, status, to_group_id, awaiting_group_id, proposed_at, proposed_tbd").eq("from_match_id", matchId).in("status", ["pending", "declined"]).order("created_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    // Üye olmayan, kaydı olmayan ama maçı bir ilandan görüyor: "Başvur"
    open && !isMember && (!myEntry || myEntry.status === "left")
      ? supabase.from("match_listings").select("id").eq("match_id", matchId).eq("status", "active").limit(1).maybeSingle().then((r) => r.data?.id as string | undefined)
      : Promise.resolve(undefined),
  ]);
  const challengeTeam = lastChallenge
    ? (await supabase.from("groups").select("id, name, color, logo").eq("id", lastChallenge.to_group_id).maybeSingle()).data
    : null;
  const { data: rescheduleRow } =
    open && canManage && match.challenge_id
      ? await supabase.from("match_challenges").select("id, pending_at, pending_tbd, awaiting_group_id").eq("id", match.challenge_id).maybeSingle()
      : { data: null };
  const entryUserIds = (entryRows as { user_id: string | null }[]).map((e) => e.user_id).filter(Boolean) as string[];
  const rawEntries = entryRows as unknown as RawEntry[];
  const { data: entryRatings } = entryUserIds.length
    ? await supabase.from("user_ratings").select("user_id, overall").in("user_id", entryUserIds)
    : { data: [] as { user_id: string; overall: number }[] };
  const ovr = new Map((entryRatings ?? []).map((r) => [r.user_id as string, r.overall as number]));
  const entries: EntryRow[] = [...rawEntries]
    .sort((a, b) => (a.queued_at ?? a.created_at).localeCompare(b.queued_at ?? b.created_at))
    .map((e) => ({
      userId: e.user_id,
      playerId: e.player_id,
      name: one(e.profiles)?.display_name ?? "Oyuncu",
      status: e.status,
      source: e.source,
      position: e.position,
      note: e.note,
      overall: (e.user_id && ovr.get(e.user_id)) || 65,
    }));
  const busy = new Set(entries.filter((e) => ["in", "reserve", "pending", "invited"].includes(e.status)).map((e) => e.userId));
  const listings = (listingRows as { id: string; status: string; target_group_id: string | null; groups: { name: string } | { name: string }[] | null }[]).map((l) => ({
    id: l.id,
    status: l.status,
    targetName: l.target_group_id ? (one(l.groups)?.name ?? "Grup") : null,
    targetId: l.target_group_id,
  }));
  const listed = new Set(listings.map((l) => l.targetId).filter(Boolean));
  const targets = (targetRows as { groups: { id: string; name: string } | { id: string; name: string }[] | null }[])
    .map((r) => one(r.groups))
    .filter((g): g is { id: string; name: string } => !!g && !listed.has(g.id))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const friends = manage ? await loadFriends(supabase, user.id) : [];
  const statuses = Object.fromEntries(entries.filter((e) => e.userId && busy.has(e.userId)).map((e) => [e.userId as string, e.status]));
  const full = !!match.capacity && match.roster_count >= match.capacity;
  // Takımın/grubun kendi üyeleri; bunların dışındakiler çıkarılınca maçtan tamamen düşer
  const teamUsers = new Set(players.filter((p) => p.user_id && !p.is_loan).map((p) => p.user_id as string));
  const invitees = entries.filter((e) => e.userId && !teamUsers.has(e.userId) && (e.status === "invited" || e.status === "declined"));
  // Takım dışından, kendisi çıkmış / engellenmiş kayıt yanıt veremez
  const lapsed = !isMember && ["left", "removed", "rejected"].includes(myEntry?.status ?? "");
  const myTeamColor = myTeam?.color ?? null;
  const opp = match.challenge_id
    ? await loadOpponent(supabase, match.challenge_id, matchId, match.opponent_group_id)
    : null;
  const linked = !!match.challenge_id;

  const external = match.kind === "external";
  const oppName = opp?.team.name ?? match.opponent_name;
  const labels = labelsFor(external, oppName);
  // Teklif bekleyen rakibi maçı gören herkes görür (teklifin kendisi iki takıma özel)
  const pendingRival =
    open && external && !oppName && !linked
      ? (((await supabase.rpc("match_pending_rivals", { p_ids: [matchId] })).data ?? []) as { name: string }[])[0]?.name ?? null
      : null;

  const rivalOffer: RivalOffer | null = lastChallenge
    ? {
        id: lastChallenge.id,
        status: lastChallenge.status as RivalOffer["status"],
        team: challengeTeam ?? { id: null, name: "Rakip", color: null, logo: null },
        at: lastChallenge.proposed_at,
        tbd: !!lastChallenge.proposed_tbd,
        ours: lastChallenge.awaiting_group_id === groupId,
      }
    : pendingRival
      ? { id: "", status: "pending", team: { id: null, name: pendingRival, color: null, logo: null }, at: null, tbd: false, ours: false }
      : null;
  // Toplanırken rakibin her durumu; kesin maçta yalnızca rakip henüz yoksa
  const showRival = open && external && !linked && (match.status === "gathering" || !match.opponent_name);

  const matchTitle = external ? (oppName || pendingRival ? `vs ${oppName ?? pendingRival}` : "Rakip belli değil") : "Kendi aramızda";

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
  // Kadro / Yedek / Kadro dışı: takımdaki herkes bu üç bölümden birinde
  let board: BoardPerson[] = [];
  if (open) {
    // Takımdan ayrılanlar listelenmez
    const { data: gone } = await supabase.from("group_players").select("user_id").eq("group_id", groupId).eq("is_loan", false).not("left_at", "is", null);
    const former = new Set((gone ?? []).map((g) => g.user_id as string | null).filter(Boolean) as string[]);
    board = buildBoard({
      roster,
      entries: rawEntries,
      members: players,
      former,
      ratings: ovr,
      isAdmin: !!isAdmin,
    });
  }

  const statusBadge =
    match.status === "gathering" ? (
      <Badge tone="warn">Toplanıyor</Badge>
    ) : match.status === "cancelled" ? (
      <Badge>İptal edildi</Badge>
    ) : match.status === "no_result" ? (
      <Badge>Sonuçsuz</Badge>
    ) : match.status === "planned" ? (
      <Badge>Planlandı</Badge>
    ) : match.status === "played" ? (
      <Badge tone="warn">Skor onayı</Badge>
    ) : match.status === "voting" ? (
      <Badge tone="warn">Oylama</Badge>
    ) : (
      <Badge tone="accent">Tamamlandı</Badge>
    );

  // Diziliş sahnesi: planlanmış maçta herkes görür (kaydedilmemişse taslak); sonrasında sadece kaydedildiyse.
  // Toplanma ekranında şimdilik yok.
  const side = (key: StageSide["key"], title: string, color: string, gid: string, size: number | null, formationId: string | null, list: RosterEntry[], editable: boolean): StageSide => ({
    key,
    title,
    color,
    groupId: gid,
    size: size ?? inferSize(list.length),
    formationId,
    rating: teamRating(list.map((p) => p.overall)),
    players: list.map((r) => ({ ...toPitch(r), slot: r.slot, userId: r.userId, movable: !!r.userId || !!isAdmin, leaves: !r.userId || !teamUsers.has(r.userId) })),
    // Yedek sırası takıma bağlı değil: kendi aramızda iki tarafın kulübesinde de görünür
    reserves:
      planned && key !== "opp"
        ? board.filter((p) => p.zone === "reserve").map((p) => ({ key: p.key, userId: p.userId, playerId: p.playerId, name: p.name, overall: p.overall, photoUrl: p.photoUrl ?? null, movable: p.movable, leaves: p.leaves }))
        : [],
    editable,
  });
  const canEdit = planned && !!canManage;
  const stageSides: StageSide[] = external
    ? [
        side("A", myTeamName, myTeamColor ?? "#4be277", groupId, match.team_size, match.formation_a, roster, canEdit),
        ...(opp
          ? [side("opp", opp.team.name, opp.team.color && opp.team.color !== myTeamColor ? opp.team.color : "#ff8a5b", opp.team.id, opp.match.team_size, opp.match.formation_a, opp.roster, false)]
          : []),
      ]
    : [
        side("A", TEAM.A.label, "#f5c542", groupId, match.team_size, match.formation_a, teams.A, canEdit),
        side("B", TEAM.B.label, "#5aa9ff", groupId, match.team_size, match.formation_b, teams.B, canEdit),
      ];
  const showStage = planned || (match.status !== "gathering" && stageSides.some((s) => s.players.some((p) => p.slot !== null)));
  const stage = showStage ? (
    <LineupStage
      groupId={groupId}
      matchId={matchId}
      sides={stageSides}
      faceOff={!external}
      canShuffle={!external && canEdit && roster.length > 1}
      initialTab={external ? "A" : (me?.team ?? (canEdit ? "A" : "vs"))}
    />
  ) : null;

  // Maç özeti (oylamada ve sonrasında): skor + gol/asist/kurtarış
  const summarized = match.status === "voting" || match.status === "closed";
  const summarySide = (s: StageSide, score: number | null, list: RosterEntry[], team?: SummarySide["team"]): SummarySide => ({
    team,
    key: s.key,
    title: s.title,
    color: s.color,
    score,
    players: list,
  });
  const summarySides: SummarySide[] = external
    ? [
        summarySide(stageSides[0], match.score_a, roster, { id: groupId, name: myTeamName, color: myTeamColor, logo: myTeam?.logo ?? null }),
        // Rakibin skoru bizim kaydımızdaki score_b (iki takımın girişi eşleşmiş)
        ...(opp ? [summarySide(stageSides[1], match.score_b, opp.roster, opp.team)] : []),
      ]
    : [summarySide(stageSides[0], match.score_a, teams.A), summarySide(stageSides[1], match.score_b, teams.B)];

  return (
    <main>
      <LiveRefresh
        pollMs={match.status === "voting" ? 15000 : undefined}
        watches={[
          { table: "matches", filter: `id=eq.${matchId}` },
          { table: "match_players", filter: `match_id=eq.${matchId}` },
          // Davet/yanıt değişimi; erişimi iptal edilenin açık sayfası da bununla kapanır
          { table: "match_entries", filter: `match_id=eq.${matchId}` },
          { table: "match_results", filter: `match_id=eq.${matchId}` },
          { table: "match_withdrawals", filter: `match_id=eq.${matchId}` },
          ...(open && external && !match.challenge_id ? [{ table: "match_challenges", filter: `from_match_id=eq.${matchId}` }] : []),
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
      <Header
        // Rakip adı ve "Kendi aramızda" dar telefonda kesilmesin: iki satıra kadar
        title={open ? "Taktik Odası" : <span className="line-clamp-2 whitespace-normal break-words text-base leading-tight">{matchTitle}</span>} back={isMember || myTeam?.kind === "team" ? `/g/${groupId}` : "/"} />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-on-surface-variant">
        {statusBadge}
        {/* Açık maçta başlık "Taktik Odası"; kimle oynandığı burada */}
        {open && (
          <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-on-surface">
            <Icon name="swords" className="text-[16px]" />
            <span className="truncate">{matchTitle}</span>
          </span>
        )}
        {pendingRival && <Badge tone="warn">Rakip onay bekliyor</Badge>}
        <span className="inline-flex items-center gap-1">
          <Icon name="calendar_today" className="text-[16px]" />
          {match.time_tbd ? matchWhen(match.played_at, true) : formatDate(match.played_at)}
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
        {match.fee_per_person ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="payments" className="text-[16px]" />
            {feeText(match.fee_per_person)}
          </span>
        ) : null}
      </div>
      <ErrorNote message={error} />
      {(match.status === "cancelled" || match.status === "no_result") && (
        <Card className="mb-4 flex items-start gap-3 text-sm">
          <Icon name={match.status === "cancelled" ? "event_busy" : "help"} className="text-[22px] text-muted" />
          <div>
            <div className="font-semibold">{match.status === "cancelled" ? "Bu maç iptal edildi" : "Skor girilmediği için sonuçsuz kapandı"}</div>
            {match.cancel_reason && <div className="text-muted">{match.cancel_reason}</div>}
          </div>
        </Card>
      )}
      {(match.status === "gathering" || (match.status === "planned" && match.capacity)) && (
        <GatheringPanel
          groupId={groupId}
          matchId={matchId}
          status={match.status as "gathering" | "planned"}
          roster={match.roster_count}
          reserve={match.reserve_count}
          capacity={match.capacity ?? match.roster_count}
          myStatus={(myEntry?.status as EntryStatus) ?? null}
          canRespond={!lapsed && (!!myEntry || (!!isMember && match.open_to_members))}
          flash={yanit}
        />
      )}
      {applyListing && (
        <Card className="mb-4 space-y-2 border-amber-400/40 bg-amber-400/10">
          <div className="font-semibold">Bu maça adam aranıyor</div>
          <p className="text-sm text-on-surface-variant">Başvurunu maçı ayarlayan kişi onaylar. Kadro doluysa yedeğe yazılırsın. Başvurun beklerken istatistiklerin ve maç geçmişin karar verecek kişiye görünür.</p>
          <form action={applyMatch} className="space-y-2">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="matchId" value={matchId} />
            <input type="hidden" name="listingId" value={applyListing} />
            <div className="flex gap-2">
              <select name="position" aria-label="Mevki" defaultValue="" className="min-h-11 rounded-xl border border-line bg-pitch-950 px-2 text-sm">
                <option value="">Mevki</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POSITION_NAME[p]}
                  </option>
                ))}
              </select>
              <Input name="note" maxLength={200} placeholder="Not (isteğe bağlı)" aria-label="Başvuru notu" className="flex-1" />
            </div>
            <SubmitButton className="w-full" pendingLabel="Gönderiliyor…">
              Başvur
            </SubmitButton>
          </form>
        </Card>
      )}
      {myEntry?.status === "pending" && (
        <form action={cancelApplication} className="-mt-2 mb-4 text-center">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="matchId" value={matchId} />
          <button className="text-xs text-muted underline">Başvurumu geri çek</button>
        </form>
      )}
      {ok && OK_TEXT[ok] && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xl bg-primary/10 p-3 text-sm text-primary">
          <Icon name="check_circle" fill className="text-[18px]" />
          {OK_TEXT[ok]}
        </p>
      )}
      {showRival && (
        <RivalSection
          groupId={groupId}
          matchId={matchId}
          homeCity={myTeam?.city ?? ""}
          opponentName={match.opponent_name}
          offer={rivalOffer}
          canManage={manage}
          canOffer={manage && !!isAdmin}
        />
      )}
      {kabul && (
        <p className="mb-4 flex items-start gap-1.5 rounded-xl bg-primary/10 p-3 text-sm text-primary">
          <Icon name="check_circle" fill className="mt-0.5 text-[18px]" />
          <span>Teklif kabul edildi. Şimdi kadronu belirle. Rakip takım da kendi kadrosunu belirliyor.</span>
        </p>
      )}
      {dizilis && (
        <p className="mb-4 flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary"><Icon name="check_circle" fill className="text-[18px]" />Diziliş kaydedildi. Maçtaki herkes görebilir.</p>
      )}

      {planned && stage}

      {/* Planlanmış maçta iki takım sahnede; oylama ve sonuçta isimler maç özetinde */}
      {linked && opp && match.status === "gathering" && (
        <SectionTitle action={<Badge tone="accent">Onaylandı</Badge>}>Rakip</SectionTitle>
      )}
      {linked && opp && !planned && !summarized && <VersusCard mine={{ id: groupId, name: myTeamName, color: myTeamColor, logo: myTeam?.logo ?? null, roster }} opp={opp} />}

      {summarized && (
        <MatchSummary sides={summarySides} rival={external && !opp ? { title: labels.B, score: match.score_b } : undefined} />
      )}

      {match.status === "played" && (
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

      {match.status === "planned" && (
        <WithdrawalSection
          part="requests"
          groupId={groupId}
          matchId={matchId}
          playedAt={match.played_at}
          myPlayerId={me?.id ?? null}
          canManage={!!canManage}
          rows={withdrawals}
          flash={cekilme}
        />
      )}
      {manage && <Applications groupId={groupId} matchId={matchId} entries={entries} full={full} />}
      {manage && <Invitees groupId={groupId} matchId={matchId} entries={invitees} />}

      {!planned && stage}

      {/* Planlanmış maçta kadro ve yedekler sahnede; altta yalnızca kadro dışı kalanlar */}
      {open && (!planned || manage || isMember) && (
        <RosterBoard groupId={groupId} matchId={matchId} people={board} capacity={match.capacity} canManage={manage} onlyRoster={!manage && !isMember} outOnly={planned} />
      )}

      {manage && (
        <AutoOpenDetails
          openInitially={!!ok && ["ilan", "ilan-kapandi", "kod"].includes(ok)}
          className="mb-4 rounded-2xl border border-line bg-surface-container px-3 open:pb-1"
          summaryClassName="flex min-h-14 cursor-pointer items-center gap-2 px-1 font-semibold"
          summary={
            <>
              <Icon name="person_add" className="text-[22px] text-primary" />
              <span className="flex-1">Oyuncu mu eksik?</span>
              <span className="text-xs font-normal text-muted">Adam ara · Oyuncu ekle</span>
              <Icon name="expand_more" className="text-[20px] text-muted" />
            </>
          }
        >
          <ListingManage groupId={groupId} matchId={matchId} listings={listings} targets={targets} code={code} full={full} />
          <AddPlayer
            groupId={groupId}
            matchId={matchId}
            meId={user.id}
            friends={friends}
            statuses={statuses}
            homeCity={myTeam?.city ?? ""}
            canAddGuest={!!isAdmin}
          />
        </AutoOpenDetails>
      )}

      {planned && canManage && (
        <>
          <SectionTitle>Maç bitti mi? Sonucu gir</SectionTitle>
          <ResultForm groupId={groupId} matchId={matchId} all={roster} external={external} labels={labels} linked={linked} allowNoShow />
        </>
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
          colors={{ A: stageSides[0].color, B: stageSides[1]?.color ?? "#ff8a5b" }}
        />
      )}

      {match.status === "closed" && (
        <ResultsView
          groupId={groupId}
          matchId={matchId}
          roster={roster.map((r) => ({ ...r, color: stageSides[!external && r.team === "B" ? 1 : 0].color }))}
          myId={me?.id}
          isTeam={myTeam?.kind === "team"}
        />
      )}

      {manage && (
        <ScheduleManage
          groupId={groupId}
          matchId={matchId}
          status={match.status as "gathering" | "planned"}
          playedAt={match.played_at}
          timeTbd={match.time_tbd}
          linked={linked}
          reschedule={
            rescheduleRow?.pending_at
              ? { challengeId: rescheduleRow.id, at: rescheduleRow.pending_at, tbd: !!rescheduleRow.pending_tbd, awaitingMe: rescheduleRow.awaiting_group_id === groupId }
              : null
          }
          rosterCount={match.roster_count}
          minPlayers={external ? 2 : 4}
        />
      )}

      {linked && opp && <OpponentSection opp={opp} color={stageSides[1].color} />}

      {planned && (
        <WithdrawalSection
          part="mine"
          groupId={groupId}
          matchId={matchId}
          playedAt={match.played_at}
          myPlayerId={me?.id ?? null}
          canManage={!!canManage}
          rows={withdrawals}
          flash={cekilme}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

interface RawEntry {
  user_id: string | null;
  player_id: string | null;
  status: string;
  source: string;
  position: Position | null;
  note: string | null;
  queued_at: string | null;
  created_at: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
  group_players: { display_name: string; position: Position | null } | { display_name: string; position: Position | null }[] | null;
}

/** Kadro dışındakilerde sebep metni ve sıralaması */
const OUT_TAG: Record<string, string> = {
  declined: "Gelemem dedi",
  left: "Kadrodan çıktı",
  invited: "Davetli, yanıt bekleniyor",
  none: "Yanıt vermedi",
};
const OUT_ORDER = Object.keys(OUT_TAG);

/** Kadro panosunun kişileri: kadro (maç kadrosu), yedek (sıra ile), kadro dışı (takımın kalan üyeleri) */
function buildBoard({
  roster,
  entries,
  members,
  former,
  ratings,
  isAdmin,
}: {
  roster: RosterEntry[];
  entries: RawEntry[];
  members: GroupPlayer[];
  former: Set<string>;
  ratings: Map<string, number>;
  isAdmin: boolean;
}): BoardPerson[] {
  const team = members.filter((m) => m.user_id && !m.is_loan);
  const byUser = new Map(team.map((m) => [m.user_id as string, m]));
  const inRoster: BoardPerson[] = roster.map((r) => ({
    key: r.userId ?? r.id,
    userId: r.userId,
    playerId: r.id,
    name: r.name,
    overall: r.overall,
    position: r.position,
    zone: "in",
    movable: !!r.userId || isAdmin,
    leaves: !r.userId || !byUser.has(r.userId),
  }));
  const seen = new Set(inRoster.map((p) => p.key));
  const reserve: BoardPerson[] = [];
  const out: (BoardPerson & { order: number })[] = [];
  const add = (key: string, status: string, p: Omit<BoardPerson, "key" | "zone" | "tag">) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (status === "reserve") reserve.push({ ...p, key, zone: "reserve" });
    else out.push({ ...p, key, zone: "out", tag: OUT_TAG[status], order: OUT_ORDER.indexOf(status) });
  };
  for (const e of [...entries].sort((a, b) => (a.queued_at ?? a.created_at).localeCompare(b.queued_at ?? b.created_at))) {
    // Onay bekleyen başvurular ayrı kartlarda; reddedilen/çıkarılan üye "Yanıt vermedi" olarak aşağıda
    if (["pending", "in", "rejected", "removed"].includes(e.status)) continue;
    const key = e.user_id ?? e.player_id;
    if (!key || (e.user_id && former.has(e.user_id))) continue;
    const member = e.user_id ? byUser.get(e.user_id) : undefined;
    // Takım dışından biri panoda yalnızca yedekse görünür (davetliler ayrı listede)
    if (!member && e.status !== "reserve") continue;
    const guest = one(e.group_players);
    add(key, e.status, {
      userId: e.user_id,
      playerId: e.user_id ? (member?.id ?? null) : e.player_id,
      name: member?.display_name ?? one(e.profiles)?.display_name ?? guest?.display_name ?? "Oyuncu",
      overall: member?.overall ?? (e.user_id ? ratings.get(e.user_id) : undefined) ?? 65,
      photoUrl: member?.photo_url ?? null,
      position: e.position ?? member?.position ?? guest?.position ?? null,
      movable: e.user_id ? true : isAdmin,
      leaves: !member,
    });
  }
  // Başvurusu bekleyen üye "yanıt vermedi" sayılmaz
  for (const e of entries) if (e.status === "pending" && e.user_id) seen.add(e.user_id);
  for (const m of team) {
    add(m.user_id as string, "none", { userId: m.user_id, playerId: m.id, name: m.display_name, overall: m.overall, position: m.position, movable: true, leaves: false });
  }
  out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "tr"));
  return [...inRoster, ...reserve, ...out];
}

/** Arkadaşlarım (ada göre) — "Oyuncu ekle" listesi */
async function loadFriends(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string): Promise<Person[]> {
  const { data: rows } = await supabase.from("friendships").select("user_a, user_b").eq("status", "accepted").limit(300);
  const ids = (rows ?? []).map((r) => (r.user_a === userId ? r.user_b : r.user_a) as string);
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select("id, display_name, photo_url, city, district").in("id", ids);
  return (data ?? [])
    .map((p) => ({ id: p.id as string, name: p.display_name as string, photoUrl: p.photo_url as string | null, city: p.city as string | null, district: p.district as string | null }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
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
  colors,
}: {
  groupId: string;
  matchId: string;
  roster: RosterEntry[];
  me?: RosterEntry;
  deadline: string | null;
  canManage: boolean;
  justVoted: boolean;
  opp: Opponent | null;
  colors: Record<Team, string>;
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
  const status = { voters: progress?.voters ?? 0, eligible: progress?.eligible ?? 0, timeLeft: timeLeft(deadline) };

  return (
    <>
      {justVoted && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">
          Oyların kaydedildi. Süre bitene kadar değiştirebilirsin.
        </p>
      )}
      {justVoted && <PushPrompt reason="Sonuçlar açıklanınca haber verelim mi?" />}
      {justVoted && <SkillQueueBanner supabase={supabase} className="mb-4 block" />}

      {me && me.userId ? (
        <VoteForm
          groupId={groupId}
          matchId={matchId}
          voterId={me.id}
          myTeam={me.team}
          status={status}
          colors={colors}
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
            saves: r.saves,
            position: r.position,
          }))}
          initialScores={Object.fromEntries((myVotes ?? []).map((v) => [v.target_id, v.score]))}
          initialMvp={myMvp?.target_id ?? null}
        />
      ) : (
        <>
          <section aria-label="Oylama" className="mb-3 rounded-2xl border border-white/10 bg-[#060d14]">
            <VoteHeader status={status} title="Oylama sürüyor" />
          </section>
          <Card className="text-center text-sm text-muted">Bu maçta oynamadığın için oy veremezsin.</Card>
        </>
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

// ---------------------------------------------------------------------------
// Takımlar arası maç: karşılaşma kartı, skor onayı, rakip kadro
// ---------------------------------------------------------------------------

/** İki takım yan yana: üstte ad ve takım rating'i (en iyi 7), altında iki sütunda oyuncular ve ratingleri */
function VersusCard({
  mine,
  opp,
}: {
  mine: { id: string; name: string; color: string | null; logo: string | null; roster: RosterEntry[] };
  opp: Opponent;
}) {
  const sides = [
    { id: mine.id, name: mine.name, color: mine.color, logo: mine.logo, roster: mine.roster, self: true },
    { id: opp.team.id, name: opp.team.name, color: opp.team.color, logo: opp.team.logo, roster: opp.roster, self: false },
  ];
  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 py-4">
        {sides.map((t, i) => (
          <div key={t.id} className="contents">
            {i === 1 && <span className="mt-3 text-sm font-bold text-muted">VS</span>}
            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <TeamBadge id={t.id} name={t.name} color={t.color} logo={t.logo} size="md" />
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
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
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
function OpponentSection({ opp, color }: { opp: Opponent; color: string }) {
  if (opp.match.status !== "closed") return null;
  return (
    <>
      <SectionTitle
        action={
          <Link href={`/g/${opp.team.id}`} className="shrink-0 whitespace-nowrap text-xs text-accent">
            Takım sayfası ›
          </Link>
        }
      >
        Rakip sonuçları
        <span className="block truncate font-sans text-xs font-medium normal-case tracking-normal text-muted">{opp.team.name}</span>
      </SectionTitle>
      <ResultsView groupId={opp.team.id} matchId={opp.match.id} roster={opp.roster.map((r) => ({ ...r, color }))} isTeam />
      <p className="mt-2 text-center text-xs text-muted">
        Sahadaki herkes iki takımın oyuncularını da puanlar; sonuçlar her takımda ayrı listelenir.
      </p>
    </>
  );
}


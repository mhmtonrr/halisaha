"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeMatch } from "@/lib/finalize";
import { balanceTeams, pickVariant, type TeamCandidate } from "@/lib/teams";
import { getGroupPlayers, parseLocalDateTime, type Position } from "@/lib/data";

const VOTING_HOURS = 24;
const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const int = (fd: FormData, key: string) => {
  const n = Number(fd.get(key));
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

// ---------------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------------

export async function createGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const name = str(fd, "name");
  if (name.length < 2) fail("/", "Grup adı en az 2 karakter olmalı");
  const { data, error } = await supabase
    .from("groups")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();
  if (error) fail("/", "Grup oluşturulamadı");
  redirect(`/g/${data.id}`);
}

export async function joinGroup(fd: FormData) {
  const { supabase } = await requireUser();
  let code = str(fd, "code");
  // Tam link yapıştırılırsa sondaki kodu al
  code = code.split("/").filter(Boolean).pop() ?? "";
  const { data, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error) fail("/", "Davet kodu geçersiz");
  redirect(`/g/${data}`);
}

export async function addGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const name = str(fd, "name");
  const position = str(fd, "position") as Position;
  const back = `/g/${groupId}/players`;
  if (name.length < 2) fail(back, "İsim en az 2 karakter olmalı");
  const { error } = await supabase.from("group_players").insert({
    group_id: groupId,
    display_name: name,
    position: POSITIONS.includes(position) ? position : null,
  });
  if (error) fail(back, "Misafir eklenemedi (yönetici olmalısınız)");
  revalidatePath(back);
}

export async function claimGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players`;
  const { error } = await supabase.rpc("claim_guest", {
    p_guest_id: str(fd, "guestId"),
    p_member_id: str(fd, "memberId"),
  });
  if (error) fail(back, error.message);
  revalidatePath(back);
}

export async function setPosition(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const playerId = str(fd, "playerId");
  const raw = str(fd, "position");
  const position = POSITIONS.includes(raw as Position) ? raw : null;
  const { error } = await supabase.rpc("set_player_position", {
    p_player_id: playerId,
    p_position: position,
  });
  if (error) fail(`/g/${groupId}/players`, error.message);
  revalidatePath(`/g/${groupId}`, "layout");
}

export async function removePlayer(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players`;
  const { error } = await supabase
    .from("group_players")
    .delete()
    .eq("id", str(fd, "playerId"));
  if (error) fail(back, "Oyuncu çıkarılamadı");
  revalidatePath(back);
}

// ---------------------------------------------------------------------------
// Maçlar
// ---------------------------------------------------------------------------

function toCandidates(
  ids: string[],
  ratings: Map<string, { overall: number; name: string }>,
  goalkeepers: Set<string>,
): TeamCandidate[] {
  return ids.map((id) => ({
    id,
    name: ratings.get(id)?.name,
    overall: ratings.get(id)?.overall ?? 65,
    isGoalkeeper: goalkeepers.has(id),
  }));
}

async function ratingsFor(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  groupId: string,
) {
  const players = await getGroupPlayers(supabase, groupId);
  return new Map(players.map((p) => [p.id, { overall: p.overall, name: p.display_name }]));
}

export async function createMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/matches/new`;
  const playerIds = [...new Set(fd.getAll("players").map(String))];
  const goalkeepers = new Set(fd.getAll("gk").map(String).filter((id) => playerIds.includes(id)));
  const when = str(fd, "playedAt");

  if (!when) fail(back, "Maç tarihini seçin");
  if (playerIds.length < 4) fail(back, "En az 4 oyuncu seçin");

  const ratings = await ratingsFor(supabase, groupId);
  const [best] = balanceTeams(toCandidates(playerIds, ratings, goalkeepers));

  const { data: match, error } = await supabase
    .from("matches")
    .insert({
      group_id: groupId,
      played_at: parseLocalDateTime(when),
      venue: str(fd, "venue") || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) fail(back, "Maç oluşturulamadı");

  const rows = [
    ...best.teamA.map((p) => ({ team: "A", p })),
    ...best.teamB.map((p) => ({ team: "B", p })),
  ].map(({ team, p }) => ({
    match_id: match.id,
    player_id: p.id,
    team,
    is_goalkeeper: !!p.isGoalkeeper,
  }));
  const { error: rosterError } = await supabase.from("match_players").insert(rows);
  if (rosterError) {
    await supabase.from("matches").delete().eq("id", match.id);
    fail(back, "Kadro kaydedilemedi");
  }
  redirect(`/g/${groupId}/m/${match.id}`);
}

async function loadRoster(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
) {
  const { data } = await supabase
    .from("match_players")
    .select("player_id, team, is_goalkeeper")
    .eq("match_id", matchId);
  return data ?? [];
}

async function writeTeams(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
  teamA: string[],
  teamB: string[],
) {
  const results = await Promise.all([
    supabase.from("match_players").update({ team: "A" }).eq("match_id", matchId).in("player_id", teamA),
    supabase.from("match_players").update({ team: "B" }).eq("match_id", matchId).in("player_id", teamB),
  ]);
  return results.find((r) => r.error)?.error ?? null;
}

/** Takımları yeniden dengeler: en iyiye yakın bölünmelerden rastgele biri. */
export async function reshuffleTeams(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const roster = await loadRoster(supabase, matchId);
  const ratings = await ratingsFor(supabase, groupId);
  const gks = new Set(roster.filter((r) => r.is_goalkeeper).map((r) => r.player_id));
  const splits = balanceTeams(toCandidates(roster.map((r) => r.player_id), ratings, gks));
  const pick = pickVariant(splits, 1.5);
  const error = await writeTeams(
    supabase,
    matchId,
    pick.teamA.map((p) => p.id),
    pick.teamB.map((p) => p.id),
  );
  if (error) fail(back, "Takımlar güncellenemedi");
  revalidatePath(back);
}

export async function movePlayer(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const team = str(fd, "team") === "A" ? "B" : "A";
  const { error } = await supabase
    .from("match_players")
    .update({ team })
    .eq("match_id", matchId)
    .eq("player_id", str(fd, "playerId"));
  if (error) fail(back, "Oyuncu taşınamadı");
  revalidatePath(back);
}

export async function toggleGoalkeeper(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase
    .from("match_players")
    .update({ is_goalkeeper: str(fd, "value") === "true" })
    .eq("match_id", matchId)
    .eq("player_id", str(fd, "playerId"));
  if (error) fail(back, "Güncellenemedi");
  revalidatePath(back);
}

export async function addToMatch(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const roster = await loadRoster(supabase, matchId);
  const countA = roster.filter((r) => r.team === "A").length;
  const team = countA <= roster.length - countA ? "A" : "B";
  const { error } = await supabase
    .from("match_players")
    .insert({ match_id: matchId, player_id: str(fd, "playerId"), team });
  if (error) fail(back, "Oyuncu eklenemedi");
  revalidatePath(back);
}

export async function removeFromMatch(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase
    .from("match_players")
    .delete()
    .eq("match_id", matchId)
    .eq("player_id", str(fd, "playerId"));
  if (error) fail(back, "Oyuncu çıkarılamadı");
  revalidatePath(back);
}

/** Skor ve istatistikler girilir, oylama 24 saatliğine açılır. */
export async function submitResult(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  if (fd.get("scoreA") === "" || fd.get("scoreB") === "") fail(back, "Skoru girin");

  const roster = await loadRoster(supabase, matchId);
  const updates = await Promise.all(
    roster.map((r) =>
      supabase
        .from("match_players")
        .update({
          goals: int(fd, `goals_${r.player_id}`),
          assists: int(fd, `assists_${r.player_id}`),
          saves: int(fd, `saves_${r.player_id}`),
        })
        .eq("match_id", matchId)
        .eq("player_id", r.player_id),
    ),
  );
  if (updates.some((u) => u.error)) fail(back, "İstatistikler kaydedilemedi");

  const deadline = new Date(Date.now() + VOTING_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .update({
      score_a: int(fd, "scoreA"),
      score_b: int(fd, "scoreB"),
      status: "voting",
      voting_deadline: deadline,
    })
    .eq("id", matchId)
    .eq("status", "planned")
    .select("id");
  if (error || !data?.length) fail(back, "Maç güncellenemedi (yetkiniz olmayabilir)");
  revalidatePath(back);
}

export async function submitVotes(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;

  const { data: me } = await supabase.rpc("my_player_id", { p_group_id: groupId });
  if (!me) fail(back, "Bu grupta oyuncu değilsiniz");

  const roster = await loadRoster(supabase, matchId);
  const votes = roster
    .filter((r) => r.player_id !== me)
    .map((r) => ({
      match_id: matchId,
      voter_id: me,
      target_id: r.player_id,
      score: Math.min(10, Math.max(1, int(fd, `score_${r.player_id}`) || 6)),
    }));
  const { error } = await supabase
    .from("votes")
    .upsert(votes, { onConflict: "match_id,voter_id,target_id" });
  if (error) fail(back, "Oylar kaydedilemedi. Oylama kapanmış olabilir.");

  const mvp = str(fd, "mvp");
  if (mvp && mvp !== me) {
    const { error: mvpError } = await supabase
      .from("mvp_votes")
      .upsert(
        { match_id: matchId, voter_id: me, target_id: mvp },
        { onConflict: "match_id,voter_id" },
      );
    if (mvpError) fail(back, "MVP oyu kaydedilemedi");
  }

  // Herkes oy verdiyse sonuçları hemen açıkla
  const { data: progress } = await supabase.rpc("voting_progress", { p_match_id: matchId });
  const p = Array.isArray(progress) ? progress[0] : progress;
  if (p && p.eligible > 0 && p.voters >= p.eligible) await finalizeMatch(matchId);

  revalidatePath(back);
  redirect(`${back}?voted=1`);
}

export async function closeVoting(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { data: allowed } = await supabase.rpc("can_manage_match", { p_match_id: matchId });
  if (!allowed) fail(back, "Oylamayı sadece maçı oluşturan veya yönetici kapatabilir");
  await finalizeMatch(matchId);
  revalidatePath(`/g/${groupId}`, "layout");
}

export async function deleteMatch(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const { data: match } = await supabase
    .from("matches")
    .select("status")
    .eq("id", matchId)
    .single();
  if (match?.status === "closed") fail(`/g/${groupId}/m/${matchId}`, "Kapanmış maç silinemez");
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) fail(`/g/${groupId}/m/${matchId}`, "Maç silinemedi");
  redirect(`/g/${groupId}`);
}

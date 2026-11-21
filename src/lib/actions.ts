"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeMatch, recomputePlayers } from "@/lib/finalize";
import { settlePoll } from "@/lib/polls";
import { later, notify } from "@/lib/notify";
import { skillSet } from "@/lib/skills";
import { recomputeSkillsForVoter } from "@/lib/skills-data";
import { text } from "@/lib/notify-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupMemberIds, groupName, linkedMatches, matchAccountIds } from "@/lib/recipients";
import { balanceTeams, pickVariant, type TeamCandidate } from "@/lib/teams";
import { formatDate, getGroupPlayers, parseLocalDateTime, POSITIONS, type Position } from "@/lib/data";
import { canonicalDistrict, isProvince } from "@/lib/regions";
import { getFormation, inferSize, isValidSize, validAssignment, type Role } from "@/lib/formations";

const VOTING_HOURS = 24;
const asPosition = (v: string): Position | null => (POSITIONS.includes(v as Position) ? (v as Position) : null);

function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

/** RPC'lerin Türkçe hata metinlerini kullanıcıya gösterir; beklenmeyen hatada genel metin */
function rpcMessage(error: { message?: string; code?: string }, fallback: string) {
  // P0001: raise exception ile bizim yazdığımız mesaj
  return error.code === "P0001" && error.message ? error.message : fallback;
}

/** Formdan kişi sayısı (5-11); geçersizse null */
const sizeOf = (fd: FormData, key = "size") => {
  const n = Number(fd.get(key));
  return isValidSize(n) ? n : null;
};

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const int = (fd: FormData, key: string) => {
  const n = Number(fd.get(key));
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

function profileArgs(fd: FormData) {
  const position = asPosition(str(fd, "position"));
  const secondary = fd
    .getAll("secondary")
    .map(String)
    .filter((p) => asPosition(p) && p !== position);
  const foot = ["L", "R", "B"].includes(str(fd, "foot")) ? str(fd, "foot") : null;
  const num = (key: string, lo: number, hi: number) => {
    const n = Number(str(fd, key));
    return str(fd, key) && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  const city = str(fd, "city");
  return {
    p_display_name: str(fd, "name"),
    p_position: position,
    p_secondary: secondary,
    p_foot: foot,
    p_shirt: num("shirt", 1, 99),
    p_bio: str(fd, "bio").slice(0, 160),
    p_city: isProvince(city) ? city : "",
    // Sadece seçilen ile ait bir ilçe kabul edilir
    p_district: canonicalDistrict(city, str(fd, "district")) ?? "",
    p_birth_year: num("birthYear", 1940, new Date().getFullYear() - 8),
  };
}

export async function updateProfile(fd: FormData) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("update_my_profile", profileArgs(fd));
  if (error) fail("/profil", error.message);
  revalidatePath("/", "layout");
  redirect("/profil?saved=1");
}

/** İlk girişteki karşılama formu */
export async function completeOnboarding(fd: FormData) {
  const { supabase } = await requireUser({ allowIncomplete: true });
  const rawNext = str(fd, "next");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/hosgeldin") ? rawNext : "/";
  const args = profileArgs(fd);
  const back = `/hosgeldin?next=${encodeURIComponent(next)}`;
  if (!args.p_city) fail(back, "İlini seç");
  if (!args.p_position) fail(back, "Ana mevkini seç");
  const { error } = await supabase.rpc("update_my_profile", { ...args, p_complete_onboarding: true });
  if (error) fail(back, error.message);
  revalidatePath("/", "layout");
  redirect(next);
}

// ---------------------------------------------------------------------------
// Gruplar
// ---------------------------------------------------------------------------

export async function createGroup(fd: FormData) {
  const { supabase, user } = await requireUser();
  const back = "/grup-kur";
  const name = str(fd, "name");
  if (name.length < 2) fail(back, "Grup adı en az 2 karakter olmalı");
  const city = str(fd, "city");
  const color = str(fd, "color");
  const { data, error } = await supabase
    .from("groups")
    .insert({
      name: name.slice(0, 60),
      created_by: user.id,
      kind: "community",
      description: str(fd, "description").slice(0, 200) || null,
      city: isProvince(city) ? city : null,
      district: canonicalDistrict(city, str(fd, "district")),
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    })
    .select("id")
    .single();
  if (error) fail(back, "Grup oluşturulamadı");
  redirect(`/g/${data.id}`);
}

function teamFields(fd: FormData) {
  const city = str(fd, "city");
  const color = str(fd, "color");
  return {
    name: str(fd, "name").slice(0, 60),
    city: isProvince(city) ? city : null,
    district: canonicalDistrict(city, str(fd, "district")),
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    description: str(fd, "description").slice(0, 200) || null,
  };
}

export async function createTeam(fd: FormData) {
  const { supabase, user } = await requireUser();
  const back = "/takim-kur";
  const fields = teamFields(fd);
  if (fields.name.length < 2) fail(back, "Takım adı en az 2 karakter olmalı");
  if (!fields.city) fail(back, "Takımın ilini seç");
  const { data, error } = await supabase
    .from("groups")
    .insert({ ...fields, kind: "team", created_by: user.id })
    .select("id")
    .single();
  if (error) fail(back, "Takım oluşturulamadı");
  redirect(`/g/${data.id}`);
}

export async function updateTeam(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players`;
  const fields = teamFields(fd);
  if (fields.name.length < 2) fail(back, "Takım adı en az 2 karakter olmalı");
  if (!fields.city) fail(back, "Takımın ilini seç");
  const { data, error } = await supabase.from("groups").update(fields).eq("id", groupId).select("id");
  if (error || !data?.length) fail(back, "Takım bilgilerini sadece kaptan ve yetkililer değiştirebilir");
  revalidatePath(`/g/${groupId}`, "layout");
  redirect(`${back}?saved=1`);
}

export async function setMemberRole(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/players`;
  const { error } = await supabase.rpc("set_member_role", {
    p_player_id: str(fd, "playerId"),
    p_role: str(fd, "role"),
  });
  if (error) fail(back, error.message);
  revalidatePath(`/g/${groupId}`, "layout");
}

export async function regenerateInvite(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { error } = await supabase.rpc("regenerate_invite", { p_group_id: groupId });
  if (error) fail(`/g/${groupId}`, error.message);
  revalidatePath(`/g/${groupId}`);
}

export async function joinGroup(fd: FormData) {
  const { supabase } = await requireUser();
  let code = str(fd, "code");
  // Tam link yapıştırılırsa sondaki kodu al
  code = code.split("/").filter(Boolean).pop() ?? "";
  const { data, error } = await supabase.rpc("join_group", { p_invite_code: code });
  if (error) fail("/kesfet", "Davet kodu geçersiz");
  redirect(`/g/${data}`);
}

export interface GuestState {
  ok?: boolean;
  error?: string;
  /** Başarıda eklenen kişinin adı (bildirim için); her gönderimde değişir, form bunu anahtar olarak kullanır */
  added?: string;
  /** Hata durumunda yazılan isim geri doldurulsun */
  name?: string;
  at?: number;
}

/**
 * Maç ekranından misafir oyuncu ekler: hesabı olmayan biri maça geldiyse isim + mevki yazılır, oyuncu
 * hem gruba (misafir olarak) hem bu maçın kadrosuna girer. Oylanır ama oy veremez. Sadece planlanmış maçta;
 * yetkiyi RLS yapar (kaptan/yetkili/maçı kuran).
 * Sayfa zıplamasın diye yönlendirmez: durum döndürür, sayfa yerinde yenilenir (revalidatePath).
 */
export async function addGuestToMatch(_prev: GuestState, fd: FormData): Promise<GuestState> {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const name = str(fd, "name");
  const position = asPosition(str(fd, "position"));
  const error = (message: string): GuestState => ({ error: message, name, at: Date.now() });
  if (name.length < 2) return error("Misafirin ismi en az 2 karakter olmalı");

  const [{ data: match }, roster] = await Promise.all([
    supabase.from("matches").select("kind, status").eq("id", matchId).eq("group_id", groupId).maybeSingle(),
    loadRoster(supabase, matchId),
  ]);
  if (!match) return error("Maç bulunamadı");
  if (match.status !== "planned") return error("Misafir sadece planlanmış maça eklenir");

  const { data: guest, error: insertError } = await supabase
    .from("group_players")
    .insert({ group_id: groupId, display_name: name.slice(0, 60), position })
    .select("id")
    .single();
  if (insertError || !guest) return error("Misafir eklenemedi (yetkiniz olmayabilir)");

  const countA = roster.filter((r) => r.team === "A").length;
  const team = match.kind === "external" || countA <= roster.length - countA ? "A" : "B";
  const { error: rosterError } = await supabase.from("match_players").insert({
    match_id: matchId,
    player_id: guest.id,
    team,
    position,
    is_goalkeeper: position === "GK",
  });
  if (rosterError) {
    // Kadroya girmeyen misafir grupta yetim kalmasın
    await supabase.from("group_players").delete().eq("id", guest.id);
    return error("Misafir maça eklenemedi");
  }
  revalidatePath(`/g/${groupId}/m/${matchId}`);
  return { ok: true, added: name.slice(0, 60), at: Date.now() };
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
  // Misafirin geçmişi artık hesap sahibine ait: genel rating'i tüm maçlarla yeniden hesapla
  await recomputePlayers([str(fd, "guestId")]);
  revalidatePath(back);
}

export async function setPosition(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const playerId = str(fd, "playerId");
  const position = asPosition(str(fd, "position"));
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
  rows: { id: string; position: Position | null }[],
  ratings: Map<string, { overall: number; name: string }>,
): TeamCandidate[] {
  return rows.map(({ id, position }) => ({
    id,
    name: ratings.get(id)?.name,
    overall: ratings.get(id)?.overall ?? 65,
    isGoalkeeper: position === "GK",
    position,
  }));
}

async function ratingsFor(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  groupId: string,
) {
  const players = await getGroupPlayers(supabase, groupId);
  return new Map(
    players.map((p) => [p.id, { overall: p.overall, name: p.display_name, position: p.position }]),
  );
}

export async function createMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/matches/new`;
  const playerIds = [...new Set(fd.getAll("players").map(String))];
  const goalkeepers = new Set(fd.getAll("gk").map(String).filter((id) => playerIds.includes(id)));
  const when = str(fd, "playedAt");
  // Takım sadece rakibe karşı, grup sadece kendi aralarında maç kurar (veritabanı da zorunlu kılar)
  const { data: groupRow } = await supabase.from("groups").select("kind").eq("id", groupId).maybeSingle();
  if (!groupRow) fail(back, "Grup bulunamadı");
  const external = groupRow.kind === "team";
  const opponent = str(fd, "opponent");

  if (!when) fail(back, "Maç tarihini seçin");
  if (external && opponent.length < 2) fail(back, "Rakip takımın adını yazın");
  if (playerIds.length < (external ? 2 : 4)) fail(back, external ? "En az 2 oyuncu seçin" : "En az 4 oyuncu seçin");

  const ratings = await ratingsFor(supabase, groupId);
  // Maçtaki mevki: işaretlenen kaleciler GK, diğerleri profildeki mevki (GK değilse)
  const positionOf = (id: string): Position | null => {
    if (goalkeepers.has(id)) return "GK";
    const p = ratings.get(id)?.position ?? null;
    return p === "GK" ? null : p;
  };
  const roster = playerIds.map((id) => ({ id, position: positionOf(id) }));

  let teamOf: (id: string) => "A" | "B" = () => "A";
  if (!external) {
    const [best] = balanceTeams(toCandidates(roster, ratings));
    const inA = new Set(best.teamA.map((p) => p.id));
    teamOf = (id) => (inA.has(id) ? "A" : "B");
  }

  const { data: match, error } = await supabase
    .from("matches")
    .insert({
      group_id: groupId,
      played_at: parseLocalDateTime(when),
      venue: str(fd, "venue") || null,
      created_by: user.id,
      kind: external ? "external" : "internal",
      opponent_name: external ? opponent.slice(0, 60) : null,
      team_size: sizeOf(fd),
    })
    .select("id")
    .single();
  if (error) fail(back, "Maç oluşturulamadı");

  const { error: rosterError } = await supabase.from("match_players").insert(
    roster.map((r) => ({
      match_id: match.id,
      player_id: r.id,
      team: teamOf(r.id),
      position: r.position,
      is_goalkeeper: r.position === "GK",
    })),
  );
  if (rosterError) {
    await supabase.from("matches").delete().eq("id", match.id);
    fail(back, "Kadro kaydedilemedi");
  }
  // Maç çağrısından oluşturulduysa çağrıyı maça bağla
  const pollId = str(fd, "pollId");
  if (pollId) {
    await supabase.from("match_polls").update({ status: "converted", match_id: match.id }).eq("id", pollId);
  }
  // Kadrodaki hesap sahiplerine "maç kuruldu"
  later(async () => {
    const admin = createAdminClient();
    const [ids, name] = await Promise.all([matchAccountIds(admin, [match.id]), groupName(admin, groupId)]);
    await notify(ids, "match", text.matchCreated(name, groupId, match.id, formatDate(parseLocalDateTime(when)), external ? opponent : null), { excludeUserId: user.id });
  });
  redirect(`/g/${groupId}/m/${match.id}`);
}

/** Oylanabilecek oyuncular: maçın kadrosu; bağlı maçta rakip kadro da */
async function loadVoteTargets(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
) {
  const { data: m } = await supabase.from("matches").select("challenge_id").eq("id", matchId).single();
  let ids = [matchId];
  if (m?.challenge_id) {
    const { data: linked } = await supabase.from("matches").select("id").eq("challenge_id", m.challenge_id);
    ids = (linked ?? []).map((x) => x.id);
  }
  const { data } = await supabase.from("match_players").select("player_id").in("match_id", ids);
  return data ?? [];
}

async function loadRoster(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  matchId: string,
) {
  const { data } = await supabase
    .from("match_players")
    .select("player_id, team, is_goalkeeper, position")
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
  const splits = balanceTeams(
    toCandidates(
      roster.map((r) => ({ id: r.player_id, position: r.position as Position | null })),
      ratings,
    ),
  );
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

/** Maça özel mevkiler. RLS sadece maçı kuranın veya yöneticinin değiştirmesine izin verir. */
export async function setMatchPositions(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const roster = await loadRoster(supabase, matchId);
  const results = await Promise.all(
    roster.map((r) => {
      const position = asPosition(str(fd, `pos_${r.player_id}`));
      return supabase
        .from("match_players")
        .update({ position, is_goalkeeper: position === "GK" })
        .eq("match_id", matchId)
        .eq("player_id", r.player_id)
        .select("player_id");
    }),
  );
  if (results.some((r) => r.error || !r.data?.length))
    fail(back, "Mevkileri sadece maçı kuran kişi veya yönetici değiştirebilir");
  revalidatePath(back);
  redirect(`${back}?positions=1`);
}

export async function addToMatch(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const playerIds = [...new Set(fd.getAll("playerId").map(String).filter(Boolean))];
  if (!playerIds.length) fail(back, "Eklenecek oyuncuyu seçin");
  const [roster, { data: match }, { data: players }] = await Promise.all([
    loadRoster(supabase, matchId),
    supabase.from("matches").select("kind").eq("id", matchId).single(),
    supabase.from("group_players").select("id, position").in("id", playerIds),
  ]);
  let countA = roster.filter((r) => r.team === "A").length;
  let countB = roster.length - countA;
  const rows = (players ?? []).map((pl) => {
    const team = match?.kind === "external" || countA <= countB ? "A" : "B";
    if (team === "A") countA++;
    else countB++;
    const position = (pl.position as Position | null) ?? null;
    return { match_id: matchId, player_id: pl.id, team, position, is_goalkeeper: position === "GK" };
  });
  const { error } = await supabase.from("match_players").insert(rows);
  if (error) fail(back, rpcMessage(error, "Oyuncu eklenemedi"));
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

/**
 * Skor ve istatistikler girilir, oylama 24 saatliğine açılır.
 * Takımlar arası (bağlı) maçta skoru iki takım da girer: ikisi birbirinin aynası olunca
 * iki maçın da oylaması açılır; o zamana kadar maç "skor onayı bekliyor" durumunda kalır.
 */
export async function submitResult(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  if (fd.get("scoreA") === "" || fd.get("scoreB") === "") fail(back, "Skoru girin");

  const [roster, { data: cur }, { data: allowed }] = await Promise.all([
    loadRoster(supabase, matchId),
    supabase.from("matches").select("challenge_id, status").eq("id", matchId).single(),
    supabase.rpc("can_manage_match", { p_match_id: matchId }),
  ]);
  if (!cur) fail(back, "Maç bulunamadı");
  if (!allowed) fail(back, "Sonucu sadece maçı oluşturan veya yetkililer girer");
  const linked = !!cur.challenge_id;

  // Geri alınamayan işlemlerden ÖNCE her şey doğrulanır. Gelmeyenler (kadrodan çıkar, güvenilirlik kaydı yazılır)
  // en son, maç durumu güncellenmeden hemen önce işaretlenir.
  const rosterIds = new Set(roster.map((r) => r.player_id));
  const noShows = [...new Set(fd.getAll("noshow").map(String).filter((id) => rosterIds.has(id)))];
  if (noShows.length && cur.status !== "planned") fail(back, "Gelmeyenler sadece planlanmış maçta işaretlenir");
  const present = roster.filter((r) => !noShows.includes(r.player_id));
  if (present.length < 2) {
    fail(back, noShows.length ? "Gelmeyenler çıkarılınca kadroda en az 2 oyuncu kalmalı" : "Sonuç girmek için kadroda en az 2 oyuncu olmalı");
  }
  if (cur.status !== "planned" && !(linked && cur.status === "played")) fail(back, "Bu maçın sonucu zaten girildi");

  // Gelmeyenlerin istatistiği yazılmaz (kadrodan çıkacaklar)
  const updates = await Promise.all(
    present.map((r) =>
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

  if (noShows.length) {
    const { error: nsError } = await supabase.rpc("mark_no_shows", { p_match: matchId, p_players: noShows });
    if (nsError) fail(back, rpcMessage(nsError, "Gelmeyenler işaretlenemedi"));
  }

  const deadline = new Date(Date.now() + VOTING_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("matches")
    .update({
      score_a: int(fd, "scoreA"),
      score_b: int(fd, "scoreB"),
      status: linked ? "played" : "voting",
      ...(linked ? {} : { voting_deadline: deadline }),
    })
    .eq("id", matchId)
    .in("status", linked ? ["planned", "played"] : ["planned"])
    .select("id");
  if (error || !data?.length) fail(back, "Maç güncellenemedi (yetkiniz olmayabilir)");

  if (linked) {
    const { data: state, error: settleError } = await supabase.rpc("settle_linked_match", { p_match_id: matchId });
    if (settleError) fail(back, "Skor eşleştirilemedi");
    if (state === "settled") announceVoting(matchId, user.id);
    revalidatePath(back);
    redirect(`${back}?skor=${state}`);
  }
  announceVoting(matchId, user.id);
  revalidatePath(back);
}

/** Oylama açıldı: maçın (bağlı maçta iki takımın) hesap sahiplerine "oy ver" */
function announceVoting(matchId: string, actorId: string) {
  later(async () => {
    const admin = createAdminClient();
    const matches = await linkedMatches(admin, matchId);
    for (const m of matches) {
      const ids = await matchAccountIds(admin, [m.id]);
      await notify(ids, "vote", text.voteOpened(m.group_id, m.id, m.kind === "external" ? m.opponent_name : null), { excludeUserId: actorId });
    }
  });
}

export async function submitVotes(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;

  const { data: me } = await supabase.rpc("my_player_id", { p_group_id: groupId });
  if (!me) fail(back, "Bu grupta oyuncu değilsiniz");

  // Takımlar arası maçta rakip takımın oyuncuları da oylanır (oy kendi maçıma yazılır)
  const roster = await loadVoteTargets(supabase, matchId);
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
  const { data: cur } = await supabase.from("matches").select("challenge_id").eq("id", matchId).single();
  if (cur?.challenge_id) {
    fail(back, "Takımlar arası maçın oylaması süre dolunca veya herkes oy verince kapanır; rakip takım da oy veriyor");
  }
  await finalizeMatch(matchId);
  revalidatePath(`/g/${groupId}`, "layout");
}

export async function deleteMatch(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const { data: match } = await supabase
    .from("matches")
    .select("status, challenge_id")
    .eq("id", matchId)
    .single();
  if (match?.status === "closed") fail(`/g/${groupId}/m/${matchId}`, "Kapanmış maç silinemez");
  if (match?.challenge_id) {
    // Karşı takımla ortak maç: iki taraftaki maç birlikte iptal edilir
    const { error } = await supabase.rpc("cancel_challenge", { p_challenge_id: match.challenge_id });
    if (error) fail(`/g/${groupId}/m/${matchId}`, rpcMessage(error, "Maç iptal edilemedi"));
    redirect(`/g/${groupId}`);
  }
  const { error } = await supabase.from("matches").delete().eq("id", matchId);
  if (error) fail(`/g/${groupId}/m/${matchId}`, "Maç silinemedi");
  redirect(`/g/${groupId}`);
}

// ---------------------------------------------------------------------------
// Maç çağrısı (anket)
// ---------------------------------------------------------------------------

export async function createPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/cagri/yeni`;
  const when = str(fd, "startsAt");
  if (!when) fail(back, "Maç tarihini seçin");
  const capacity = Number(str(fd, "capacity"));
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 40) fail(back, "Kontenjan 2-40 arası olmalı");
  const deadline = str(fd, "deadline");
  const { data, error } = await supabase
    .from("match_polls")
    .insert({
      group_id: groupId,
      created_by: user.id,
      starts_at: parseLocalDateTime(when),
      venue: str(fd, "venue").slice(0, 80) || null,
      capacity,
      deadline: deadline ? parseLocalDateTime(deadline) : null,
      note: str(fd, "note").slice(0, 300) || null,
    })
    .select("id")
    .single();
  if (error) fail(back, "Çağrıyı sadece yetkililer açabilir");
  announcePoll(groupId, data.id, user.id, parseLocalDateTime(when), str(fd, "venue").slice(0, 80) || null);
  redirect(`/g/${groupId}/cagri/${data.id}`);
}

export async function respondPoll(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `/g/${groupId}/cagri/${pollId}`;
  const { error } = await supabase.rpc("respond_poll", { p_poll_id: pollId, p_answer: str(fd, "answer") });
  if (error) fail(back, error.message);
  // Üye çağrısı kontenjanı dolduysa maç hemen kurulur (elle onaylı çağrıya dokunmaz)
  await settlePoll(pollId);
  revalidatePath(back);
  revalidatePath("/");
}

/** Yeni çağrı: grubun üyelerine haber ver */
function announcePoll(groupId: string, pollId: string, actorId: string, startsAt: string, venue: string | null) {
  later(async () => {
    const admin = createAdminClient();
    const [ids, name] = await Promise.all([groupMemberIds(admin, groupId), groupName(admin, groupId)]);
    await notify(ids, "poll", text.pollOpened(name, groupId, pollId, formatDate(startsAt), venue), { excludeUserId: actorId });
  });
}

/** Üye çağrısı: otomatik maça dönüşen çağrı (kurallar ve sınırlar veritabanında zorunlu) */
export async function createMemberPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/cagri/yeni`;
  const when = str(fd, "startsAt");
  if (!when) fail(back, "Maç zamanını seçin");
  const size = sizeOf(fd);
  if (!size) fail(back, "Kaç kişilik oynanacağını seçin (5-11)");
  const deadline = str(fd, "deadline");
  const { data, error } = await supabase.rpc("create_member_poll", {
    p_group: groupId,
    p_starts_at: parseLocalDateTime(when),
    p_venue: str(fd, "venue").slice(0, 80),
    p_size: size,
    p_deadline: deadline ? parseLocalDateTime(deadline) : null,
    p_note: str(fd, "note").slice(0, 300),
  });
  if (error || !data) fail(back, rpcMessage(error ?? {}, "Çağrı açılamadı"));
  announcePoll(groupId, data as string, user.id, parseLocalDateTime(when), str(fd, "venue").slice(0, 80) || null);
  redirect(`/g/${groupId}/cagri/${data}`);
}

/** Çağrıyı iptal et: açan kişi veya yetkili */
export async function closePoll(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `/g/${groupId}/cagri/${pollId}`;
  const { error } = await supabase.rpc("close_poll", { p_poll_id: pollId });
  if (error) fail(back, rpcMessage(error, "Çağrı iptal edilemedi"));
  revalidatePath(back);
  revalidatePath("/");
}

export async function togglePollApproval(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `/g/${groupId}/cagri/${pollId}`;
  const { error } = await supabase.rpc("set_poll_approval", {
    p_poll_id: pollId,
    p_player_id: str(fd, "playerId"),
    p_approved: str(fd, "approved") === "true",
  });
  if (error) fail(back, error.message);
  revalidatePath(back);
}

export async function approveFirstResponders(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `/g/${groupId}/cagri/${pollId}`;
  const { error } = await supabase.rpc("approve_first_responders", { p_poll_id: pollId });
  if (error) fail(back, error.message);
  revalidatePath(back);
}

export async function setPollStatus(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `/g/${groupId}/cagri/${pollId}`;
  const status = str(fd, "status") === "open" ? "open" : "closed";
  const { data, error } = await supabase
    .from("match_polls")
    .update({ status })
    .eq("id", pollId)
    .neq("status", "converted")
    .select("id");
  if (error || !data?.length) fail(back, "Çağrı güncellenemedi");
  revalidatePath(back);
}

export async function deletePoll(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const { data, error } = await supabase.from("match_polls").delete().eq("id", pollId).select("id");
  if (error || !data?.length) fail(`/g/${groupId}/cagri/${pollId}`, "Çağrı silinemedi");
  redirect(`/g/${groupId}`);
}

// ---------------------------------------------------------------------------
// Takımlar arası maç teklifi
// ---------------------------------------------------------------------------

/** Kendi takımımızdan (fromGroupId) karşı takıma (toGroupId) teklif gönderir */
export async function createChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const from = str(fd, "fromGroupId");
  const to = str(fd, "toGroupId");
  const back = `/g/${to}/teklif`;
  if (!from) fail(back, "Hangi takımınızla teklif göndereceğinizi seçin");
  const when = str(fd, "playedAt");
  if (!when) fail(back, "Maç zamanını seçin");
  const size = sizeOf(fd);
  if (!size) fail(`${back}?from=${from}`, "Kaç kişilik oynanacağını seçin (5-11)");

  const { error } = await supabase.rpc("create_challenge", {
    p_size: size,
    p_from: from,
    p_to: to,
    p_at: parseLocalDateTime(when),
    p_venue: str(fd, "venue").slice(0, 80),
    p_fee: str(fd, "fee").slice(0, 120),
    p_message: str(fd, "message").slice(0, 300),
  });
  if (error) fail(`${back}?from=${from}`, rpcMessage(error, "Teklif gönderilemedi"));
  // Karşı takımın kaptan/yetkililerine "teklif geldi"
  later(async () => {
    const admin = createAdminClient();
    const [ids, fromName] = await Promise.all([groupMemberIds(admin, to, { adminsOnly: true }), groupName(admin, from)]);
    await notify(ids, "offer", text.challengeReceived(fromName, to, formatDate(parseLocalDateTime(when))), { excludeUserId: user.id });
  });
  revalidatePath(`/g/${from}/teklifler`);
  redirect(`/g/${from}/teklifler?sent=1`);
}

export async function respondChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/teklifler`;
  const accept = str(fd, "answer") === "accept";
  const { data: matchId, error } = await supabase.rpc("respond_challenge", {
    p_challenge_id: str(fd, "challengeId"),
    p_accept: accept,
  });
  if (error) fail(back, rpcMessage(error, "Teklif yanıtlanamadı"));
  // Teklifi gönderen takımın kaptan/yetkililerine yanıt
  later(async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("from_group_id, to_group_id").eq("id", str(fd, "challengeId")).maybeSingle();
    if (!c) return;
    const [ids, toName] = await Promise.all([groupMemberIds(admin, c.from_group_id, { adminsOnly: true }), groupName(admin, c.to_group_id)]);
    await notify(ids, "offer", text.challengeAnswered(toName, c.from_group_id, accept), { excludeUserId: user.id });
  });
  revalidatePath(back);
  // Kabulde doğrudan oluşan maça git: kadroyu belirlemek için
  if (accept && matchId) redirect(`/g/${groupId}/m/${matchId}?kabul=1`);
  redirect(back);
}

export async function cancelChallenge(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/teklifler`;
  const { error } = await supabase.rpc("cancel_challenge", { p_challenge_id: str(fd, "challengeId") });
  if (error) fail(back, rpcMessage(error, "Teklif iptal edilemedi"));
  revalidatePath(back);
  redirect(back);
}

// ---------------------------------------------------------------------------
// Diziliş (sürükle-bırak editörü)
// ---------------------------------------------------------------------------

/**
 * Bir takımın dizilişini kaydeder: formasyon + oyuncu → slot atamaları. Sahaya dizilen oyuncunun maçtaki
 * mevkisi slotun rolü olur. Sadece planlanmış maçta; yetkiyi RLS yapar (kaptan/yetkili/maçı kuran).
 */
export async function setLineup(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const team = str(fd, "team") === "B" ? "B" : "A";
  const back = `/g/${groupId}/m/${matchId}`;

  const { data: match } = await supabase
    .from("matches")
    .select("status, kind, team_size, challenge_id")
    .eq("id", matchId)
    .single();
  if (!match) fail(back, "Maç bulunamadı");
  if (match.status !== "planned") fail(back, "Diziliş sadece planlanmış maçta değiştirilir");
  // Rakibe karşı maçta sadece A (bizim takım) vardır
  if (match.kind === "external" && team === "B") fail(back, "Geçersiz takım");

  const roster = (await loadRoster(supabase, matchId)).filter((r) => r.team === team);
  const size = match.team_size ?? inferSize(roster.length);
  const formation = getFormation(size, str(fd, "formation"));
  if (!formation) fail(back, "Geçersiz diziliş");

  let raw: unknown;
  try {
    raw = JSON.parse(str(fd, "lineup") || "{}");
  } catch {
    fail(back, "Diziliş okunamadı");
  }
  const rosterIds = new Set(roster.map((r) => r.player_id));
  const assign: Record<string, number | null> = {};
  for (const [id, slot] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!rosterIds.has(id)) continue; // kadroda olmayan oyuncu sayılmaz
    assign[id] = typeof slot === "number" ? slot : null;
  }
  if (!validAssignment(assign, formation)) fail(back, "Diziliş geçersiz (iki oyuncu aynı yerde olamaz)");

  // Benzersiz slot kuralı yüzünden önce takımın tüm slotları boşaltılır
  const cleared = await supabase.from("match_players").update({ slot: null }).eq("match_id", matchId).eq("team", team);
  if (cleared.error) fail(back, "Diziliş kaydedilemedi (yetkiniz olmayabilir)");

  const results = await Promise.all(
    Object.entries(assign)
      .filter(([, slot]) => slot !== null)
      .map(([id, slot]) => {
        const role = formation.slots[slot as number].role as Role;
        return supabase
          .from("match_players")
          .update({ slot, position: role, is_goalkeeper: role === "GK" })
          .eq("match_id", matchId)
          .eq("player_id", id);
      }),
  );
  if (results.some((r) => r.error)) fail(back, "Diziliş kaydedilemedi");

  const { error } = await supabase
    .from("matches")
    .update({
      [team === "A" ? "formation_a" : "formation_b"]: formation.id,
      ...(match.team_size ? {} : { team_size: size }),
    })
    .eq("id", matchId);
  if (error) fail(back, "Diziliş kaydedilemedi");
  revalidatePath(back);
  redirect(`${back}?dizilis=1`);
}

// ---------------------------------------------------------------------------
// Oyuncu arama ilanı ve ödünç oyuncu
// ---------------------------------------------------------------------------

/** Takımın planlanmış maçı için "oyuncu arıyoruz" ilanı aç (kaptan/yetkili) */
export async function createListing(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const needed = Number(str(fd, "needed"));
  if (!Number.isInteger(needed) || needed < 1 || needed > 10) fail(back, "Kaç oyuncu arandığını seçin (1-10)");
  const positions = fd.getAll("positions").map(String).filter((p) => asPosition(p));
  const minRaw = str(fd, "minOverall");
  const minOverall = minRaw ? Number(minRaw) : null;
  if (minOverall !== null && (!Number.isInteger(minOverall) || minOverall < 40 || minOverall > 99)) fail(back, "Minimum rating 40-99 arası olmalı");
  const { error } = await supabase.rpc("create_listing", {
    p_match: matchId,
    p_needed: needed,
    p_positions: positions,
    p_min_overall: minOverall,
    p_note: str(fd, "note").slice(0, 300),
  });
  if (error) fail(back, rpcMessage(error, "İlan açılamadı"));
  revalidatePath(back);
}

export async function closeListing(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase.rpc("close_listing", { p_listing: str(fd, "listingId") });
  if (error) fail(back, rpcMessage(error, "İlan kapatılamadı"));
  revalidatePath(back);
}

/** Kaptan/yetkili başvuruyu kabul eder (oyuncu ödünç olarak maç kadrosuna girer) veya reddeder */
export async function decideApplication(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const { error } = await supabase.rpc("decide_application", {
    p_listing: str(fd, "listingId"),
    p_user: str(fd, "userId"),
    p_accept: str(fd, "answer") === "accept",
  });
  if (error) fail(back, rpcMessage(error, "Başvuru yanıtlanamadı"));
  // Başvurana sonuç
  later(async () => {
    const admin = createAdminClient();
    await notify([str(fd, "userId")], "listing", text.applicationDecided(await groupName(admin, groupId), str(fd, "answer") === "accept", groupId, matchId), { excludeUserId: user.id });
  });
  revalidatePath(back);
}

/** Herkese açık ilana başvur (hesabı olan herkes) */
export async function applyListing(fd: FormData) {
  const { supabase, user } = await requireUser();
  const listingId = str(fd, "listingId");
  const back = `/ilan/${listingId}`;
  const { error } = await supabase.rpc("apply_listing", {
    p_listing: listingId,
    p_position: asPosition(str(fd, "position")),
    p_note: str(fd, "note").slice(0, 200),
  });
  if (error) fail(back, rpcMessage(error, "Başvuru gönderilemedi"));
  // Takımın kaptan/yetkililerine "yeni başvuru"
  later(async () => {
    const admin = createAdminClient();
    const { data: l } = await admin.from("player_listings").select("group_id, match_id").eq("id", listingId).maybeSingle();
    if (!l) return;
    const [ids, team, { data: p }] = await Promise.all([
      groupMemberIds(admin, l.group_id, { adminsOnly: true }),
      groupName(admin, l.group_id),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    await notify(ids, "listing", text.listingApplied(p?.display_name ?? "Bir oyuncu", team, l.group_id, l.match_id), { excludeUserId: user.id });
  });
  revalidatePath(back);
  revalidatePath("/");
}

export async function withdrawApplication(fd: FormData) {
  const { supabase } = await requireUser();
  const listingId = str(fd, "listingId");
  const back = `/ilan/${listingId}`;
  const { error } = await supabase.rpc("withdraw_application", { p_listing: listingId });
  if (error) fail(back, rpcMessage(error, "Başvuru geri çekilemedi"));
  revalidatePath(back);
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------------

/**
 * Sohbet mesajı atılınca göndericinin tarayıcısı çağırır (mesaj doğrudan veritabanına yazıldığı için sunucu bilmez).
 * Mesajın gerçekten çağıranın, yeni ve metin olduğu doğrulanır; grup üyelerine (gönderen hariç) bildirim gider.
 * Aynı gruptan 10 dakikada en fazla 1 bildirim alınır (birleştirme notify içinde).
 */
export async function notifyChatMessage(groupId: string, messageId: number) {
  const { supabase, user } = await requireUser();
  const { data: msg } = await supabase
    .from("group_messages")
    .select("id, kind, body, created_at, group_players(user_id, display_name)")
    .eq("id", messageId)
    .eq("group_id", groupId)
    .maybeSingle();
  const author = Array.isArray(msg?.group_players) ? msg?.group_players[0] : msg?.group_players;
  if (!msg || msg.kind !== "text" || !author || (author as { user_id: string | null }).user_id !== user.id) return;
  if (Date.now() - new Date(msg.created_at).getTime() > 60_000) return; // eski mesaj için bildirim yok
  const authorName = (author as { display_name: string }).display_name;
  later(async () => {
    const admin = createAdminClient();
    const [ids, name] = await Promise.all([groupMemberIds(admin, groupId), groupName(admin, groupId)]);
    await notify(ids, "chat", text.chat(name, groupId, authorName, msg.body), { excludeUserId: user.id });
  });
}

/** Bildirim kutusunu okundu işaretle (boşsa hepsi) */
export async function markNotificationsRead(ids?: string[]) {
  const { supabase } = await requireUser();
  await supabase.rpc("mark_notifications_read", { p_ids: ids?.length ? ids : null });
  revalidatePath("/bildirimler");
}

/** Cihazın push aboneliğini kaydet / kaldır (RPC: aynı cihaz başka kullanıcıya geçebilir) */
export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    p_user_agent: userAgent.slice(0, 300),
  });
  return { ok: !error, error: error ? rpcMessage(error, "Abonelik kaydedilemedi") : undefined };
}

export async function removePushSubscription(endpoint: string) {
  const { supabase } = await requireUser();
  await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint });
}

/** Bildirim kategorisi aç/kapat (satır yoksa oluşturur) */
export async function setNotificationPref(key: string, value: boolean) {
  const { supabase, user } = await requireUser();
  if (!["votes", "matches", "offers", "chat"].includes(key)) return;
  await supabase.from("notification_prefs").upsert({ user_id: user.id, [key]: value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  revalidatePath("/profil");
}

// ---------------------------------------------------------------------------
// Yetenek değerlendirmesi
// ---------------------------------------------------------------------------

/** Birlikte oynadığın bir oyuncuyu 6 yetenekte 1-10 puanla; boş bırakılan "bilmiyorum" demektir */
export async function submitSkillRating(fd: FormData) {
  const { supabase, user } = await requireUser();
  const playerId = str(fd, "playerId");
  const keeper = str(fd, "keeper") === "1";
  const scores: Record<string, number | null> = {};
  for (const { key } of skillSet(keeper)) {
    const raw = str(fd, `score_${key}`);
    scores[key] = raw === "" ? null : Number(raw);
  }
  const { error } = await supabase.rpc("submit_skill_rating", { p_target_player: playerId, p_scores: scores });
  if (error) fail("/yetenek", rpcMessage(error, "Değerlendirme kaydedilemedi"));
  // Oy verenin normalizasyonu değiştiği için tüm hedefleri yeniden hesaplanır; yanıttan sonra
  later(async () => {
    await recomputeSkillsForVoter(createAdminClient(), user.id);
  });
  revalidatePath("/yetenek");
  redirect("/yetenek?saved=1");
}

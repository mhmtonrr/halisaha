"use server";
// Birleşik çağrı işlemleri (0035). Yetki ve kurallar veritabanında; burada sadece çağrı, bildirim ve yönlendirme.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds, groupName } from "@/lib/recipients";
import { balanceTeams } from "@/lib/teams";
import { formatDate, parseLocalDateTime, POSITIONS, type Position } from "@/lib/data";
import { isValidSize } from "@/lib/formations";
import { callWhen, dayTimeToIso, reserveOrder, type Responder } from "@/lib/call-rules";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const sizeOf = (fd: FormData) => {
  const n = Number(fd.get("size"));
  return isValidSize(n) ? n : null;
};
/**
 * Toplama çağrısının kontenjanı: grupta kendi aramızda oynanır (iki taraf, kişi × 2),
 * takımda rakibe karşı (tek taraf, kişi kadar). null → RPC kişi × 2 hesaplar.
 */
async function gatherCapacity(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], groupId: string, size: number | null) {
  if (size === null) return null;
  const { data } = await supabase.from("groups").select("kind").eq("id", groupId).maybeSingle();
  return data?.kind === "team" ? size : size * 2;
}
const asPosition = (v: string): Position | null => (POSITIONS.includes(v as Position) ? (v as Position) : null);

function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string) {
  return error?.code === "P0001" && error.message ? error.message : fallback;
}
const callPath = (groupId: string, pollId: string) => `/g/${groupId}/cagri/${pollId}`;

/** Toplama çağrısı ("Maç ayarla") — gün zorunlu, gerisi isteğe bağlı */
export async function createGatherPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}/cagri/yeni`;
  const day = str(fd, "day");
  if (!day) fail(back, "Maç gününü seçin");
  const time = str(fd, "time");
  const startsAt = time ? dayTimeToIso(day, time) : null;
  if (time && !startsAt) fail(back, "Saat geçersiz");
  const decideBy = str(fd, "decideBy");
  const venue = str(fd, "venue").slice(0, 80) || null;
  const { data, error } = await supabase.rpc("create_gather_poll", {
    p_group: groupId,
    p_play_on: day,
    p_starts_at: startsAt,
    p_venue: venue,
    p_team_size: sizeOf(fd),
    p_capacity: await gatherCapacity(supabase, groupId, sizeOf(fd)),
    p_decide_by: decideBy ? parseLocalDateTime(decideBy) : null,
    p_note: str(fd, "note").slice(0, 300) || null,
  });
  if (error || !data) fail(back, rpcMessage(error, "Çağrı açılamadı"));
  const pollId = data as string;
  later(async () => {
    const admin = createAdminClient();
    const [ids, name] = await Promise.all([groupMemberIds(admin, groupId, { broadcast: true }), groupName(admin, groupId)]);
    await notify(ids, "poll", text.pollOpened(name, groupId, pollId, callWhen({ play_on: day, starts_at: startsAt }), venue), { excludeUserId: user.id });
  });
  redirect(callPath(groupId, pollId));
}

/** Toplama çağrısını netleştir (saat, saha, kişi sayısı, karar zamanı, not); yanıt verenlere haber gider */
export async function updateGatherPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = callPath(groupId, pollId);
  const day = str(fd, "day");
  const time = str(fd, "time");
  const startsAt = time ? dayTimeToIso(day, time) : null;
  const decideBy = str(fd, "decideBy");
  const venue = str(fd, "venue").slice(0, 80) || null;
  const { error } = await supabase.rpc("update_gather_poll", {
    p_poll: pollId,
    p_starts_at: startsAt,
    p_venue: venue,
    p_team_size: sizeOf(fd),
    p_capacity: await gatherCapacity(supabase, groupId, sizeOf(fd)),
    p_decide_by: decideBy ? parseLocalDateTime(decideBy) : null,
    p_note: str(fd, "note").slice(0, 300) || null,
  });
  if (error) fail(`${back}?duzenle=1`, rpcMessage(error, "Çağrı güncellenemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: rows }, name] = await Promise.all([
      admin.from("poll_responses").select("user_id").eq("poll_id", pollId).in("answer", ["yes", "maybe"]),
      groupName(admin, groupId),
    ]);
    const ids = (rows ?? []).map((r) => r.user_id as string);
    await notify(ids, "poll", text.pollUpdated(name, groupId, pollId, callWhen({ play_on: day, starts_at: startsAt }), venue), { excludeUserId: user.id });
  });
  revalidatePath(back);
  redirect(back);
}

/** Geliyorum / Belki / Gelemem (+ mevki, not) */
export async function respondPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  // Ana sayfadan hızlı yanıtta oraya dönülür (sadece "/" kabul: açık yönlendirme olmasın)
  const back = str(fd, "returnTo") === "/" ? "/" : callPath(groupId, pollId);
  const answer = str(fd, "answer");
  const { error } = await supabase.rpc("respond_poll", {
    p_poll: pollId,
    p_answer: answer,
    p_position: asPosition(str(fd, "position")),
    p_note: str(fd, "note").slice(0, 200) || null,
  });
  if (error) fail(back, rpcMessage(error, "Yanıt kaydedilemedi"));
  if (answer === "yes") {
    // Adam aramaya veya kesinleşmiş çağrıya gelen "geliyorum": organizatör kabul edecek, haber ver
    later(async () => {
      const admin = createAdminClient();
      const [{ data: poll }, { data: me }] = await Promise.all([
        admin.from("match_polls").select("created_by, purpose, status").eq("id", pollId).maybeSingle(),
        admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (!poll || (poll.purpose !== "fill" && poll.status === "open")) return;
      await notify([poll.created_by as string], "poll", text.pollApplied(me?.display_name ?? "Bir oyuncu", groupId, pollId), { excludeUserId: user.id });
    });
  }
  revalidatePath(callPath(groupId, pollId));
  revalidatePath("/");
  redirect(back);
}

/**
 * Kadroyu kesinleştir: seçilenlerle maçı kur. Kendi aramızda: taraflar dengeli bölünür (kaleci işaretlenenler ayrı);
 * rakibe karşı: seçilen takımda, takım üyesi olmayanlar ödünç. Seçilmeyen "geliyorum"cular yedek olur.
 */
export async function finalizePoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = `${callPath(groupId, pollId)}?kesinlestir=1`;
  const selected = [...new Set(fd.getAll("players").map(String))];
  const gk = new Set(fd.getAll("gk").map(String));
  const guestIds = [...new Set(fd.getAll("guests").map(String))];
  const kind = str(fd, "kind") === "external" ? "external" : "internal";
  const startsAt = dayTimeToIso(str(fd, "day"), str(fd, "time"));
  if (!startsAt) fail(back, "Maç saatini seçin");
  if (selected.length + guestIds.length < (kind === "internal" ? 4 : 2)) fail(back, kind === "internal" ? "En az 4 oyuncu seçin" : "En az 2 oyuncu seçin");

  const [{ data: rows }, { data: guestRows }] = await Promise.all([
    supabase.rpc("poll_responders", { p_poll: pollId }),
    guestIds.length
      ? supabase.from("poll_guests").select("id, name, position").eq("poll_id", pollId).in("id", guestIds)
      : Promise.resolve({ data: [] as { id: string; name: string; position: string | null }[] }),
  ]);
  const responders = (rows ?? []) as Responder[];
  const byId = new Map(responders.map((r) => [r.user_id, r]));
  const candidates = selected.map((id) => {
    const r = byId.get(id);
    const position = (r?.chosen_position ?? r?.preferred_position ?? null) as Position | null;
    return { id, name: r?.display_name, overall: r?.overall ?? 65, isGoalkeeper: gk.has(id) || position === "GK", position };
  });
  // Misafirin puanı yok: dengelemede başlangıç puanı (65) sayılır
  const guestCandidates = (guestRows ?? []).map((g) => {
    const position = asPosition(g.position ?? "");
    return { id: g.id, name: g.name, overall: 65, isGoalkeeper: gk.has(g.id) || position === "GK", position };
  });
  let inA = new Set([...candidates, ...guestCandidates].map((c) => c.id));
  if (kind === "internal") {
    const [best] = balanceTeams([...candidates, ...guestCandidates]);
    inA = new Set(best.teamA.map((p) => p.id));
  }
  const roster = candidates.map((c) => ({ user_id: c.id, team: inA.has(c.id) ? "A" : "B", gk: c.isGoalkeeper }));
  const guests = guestCandidates.map((g) => ({ id: g.id, team: inA.has(g.id) ? "A" : "B", gk: g.isGoalkeeper }));

  const { data: matchId, error } = await supabase.rpc("finalize_poll", {
    p_poll: pollId,
    p_starts_at: startsAt,
    p_venue: str(fd, "venue").slice(0, 80) || null,
    p_team_size: sizeOf(fd),
    p_kind: kind,
    // "__new": hızlı (geçici) takım kurulur; adı newTeam
    p_team: kind === "external" && str(fd, "teamId") !== "__new" ? str(fd, "teamId") || null : null,
    p_opponent: kind === "external" ? str(fd, "opponent").slice(0, 60) : null,
    p_roster: roster,
    p_new_team: kind === "external" && str(fd, "teamId") === "__new" ? str(fd, "newTeam").slice(0, 60) : null,
    p_guests: guests,
  });
  if (error || !matchId) fail(back, rpcMessage(error, "Kadro kesinleştirilemedi"));
  const { data: created } = await supabase.from("matches").select("group_id").eq("id", matchId as string).single();
  const matchGroup = (created?.group_id as string | undefined) ?? groupId;

  later(async () => {
    const admin = createAdminClient();
    const [{ data: resp }, name] = await Promise.all([
      admin.from("poll_responses").select("user_id, answer, status, responded_at").eq("poll_id", pollId),
      groupName(admin, matchGroup),
    ]);
    const all = (resp ?? []) as Pick<Responder, "user_id" | "answer" | "status" | "responded_at">[];
    const when = formatDate(startsAt);
    const chosen = all.filter((r) => r.status === "selected").map((r) => r.user_id);
    await notify(chosen, "match", text.pollSelected(name, matchGroup, matchId as string, when), { excludeUserId: user.id });
    const reserves = reserveOrder(all as Responder[]);
    for (const [i, r] of reserves.entries()) {
      await notify([r.user_id], "poll", text.pollReserve(name, groupId, pollId, when, i + 1), { excludeUserId: user.id });
    }
  });
  revalidatePath(callPath(groupId, pollId));
  redirect(`/g/${matchGroup}/m/${matchId}`);
}

/** Toplama çağrısına dışarıdan misafir ekle (organizatör; hesabı olmayan oyuncu) */
export async function addPollGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const back = callPath(groupId, pollId);
  const name = str(fd, "name").slice(0, 60);
  if (name.length < 2) fail(back, "Misafirin ismi en az 2 karakter olmalı");
  const { error } = await supabase.rpc("add_poll_guest", { p_poll: pollId, p_name: name, p_position: asPosition(str(fd, "guestPosition")) });
  if (error) fail(back, rpcMessage(error, "Misafir eklenemedi"));
  revalidatePath(back);
  redirect(back);
}

export async function removePollGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const back = callPath(str(fd, "groupId"), str(fd, "pollId"));
  const { error } = await supabase.rpc("remove_poll_guest", { p_guest: str(fd, "guestId") });
  if (error) fail(back, rpcMessage(error, "Misafir çıkarılamadı"));
  revalidatePath(back);
  redirect(back);
}

/** Adam arama başvuranını veya toplama çağrısının yedeğini kadroya al (organizatör) */
export async function acceptResponder(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const userId = str(fd, "userId");
  const back = callPath(groupId, pollId);
  const { error } = await supabase.rpc("accept_responder", { p_poll: pollId, p_user: userId });
  if (error) fail(back, rpcMessage(error, "Kadroya alınamadı"));
  later(async () => {
    const admin = createAdminClient();
    const { data: poll } = await admin.from("match_polls").select("match_id, matches(group_id, played_at)").eq("id", pollId).maybeSingle();
    const m = (Array.isArray(poll?.matches) ? poll?.matches[0] : poll?.matches) as { group_id: string; played_at: string } | undefined;
    if (!poll?.match_id || !m) return;
    await notify([userId], "match", text.pollSelected(await groupName(admin, m.group_id), m.group_id, poll.match_id as string, formatDate(m.played_at)));
  });
  revalidatePath(back);
  redirect(back);
}

export async function rejectResponder(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const userId = str(fd, "userId");
  const back = callPath(groupId, pollId);
  const { error } = await supabase.rpc("reject_responder", { p_poll: pollId, p_user: userId });
  if (error) fail(back, rpcMessage(error, "İşlem yapılamadı"));
  later(async () => {
    const admin = createAdminClient();
    await notify([userId], "poll", text.pollRejected(await groupName(admin, groupId), groupId, pollId));
  });
  revalidatePath(back);
  redirect(back);
}

/** Çağrıyı kapat (toplamayı iptal et / adam aramayı durdur) */
export async function closePoll(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const pollId = str(fd, "pollId");
  const { error } = await supabase.rpc("close_poll", { p_poll_id: pollId });
  if (error) fail(callPath(groupId, pollId), rpcMessage(error, "Çağrı kapatılamadı"));
  revalidatePath(`/g/${groupId}`);
  redirect(callPath(groupId, pollId));
}

/** Adam ara: planlı maçın eksiği; maçın kendi grubunda veya organizatörün maç açabildiği bir toplulukta */
export async function createFillPoll(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = `/g/${groupId}/m/${matchId}`;
  const target = str(fd, "targetGroupId") || groupId;
  const needed = Number(str(fd, "needed"));
  const positions = fd.getAll("positions").map(String).filter((p) => asPosition(p));
  const note = str(fd, "note").slice(0, 300) || null;
  const { data, error } = await supabase.rpc("create_fill_poll", {
    p_match: matchId,
    p_needed: needed,
    p_positions: positions,
    p_note: note,
    p_group: target,
  });
  if (error || !data) fail(back, rpcMessage(error, "Adam arama açılamadı"));
  const pollId = data as string;
  later(async () => {
    const admin = createAdminClient();
    const [ids, name, { data: m }] = await Promise.all([
      groupMemberIds(admin, target, { broadcast: true }),
      groupName(admin, target),
      admin.from("matches").select("played_at").eq("id", matchId).maybeSingle(),
    ]);
    await notify(ids, "poll", text.fillOpened(name, target, pollId, needed, m ? formatDate(m.played_at) : "", positions), { excludeUserId: user.id });
  });
  revalidatePath(back);
  redirect(callPath(target, pollId));
}

// ---------------------------------------------------------------------------
// Üye maç önerisi (0037): sadece öneren ve maç açabilenler görür; onaylanınca öneren adına çağrı açılır
// ---------------------------------------------------------------------------

export async function proposeMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/g/${groupId}`;
  const day = str(fd, "day");
  const time = str(fd, "time");
  const startsAt = time ? dayTimeToIso(day, time) : null;
  const { error } = await supabase.rpc("propose_match", {
    p_group: groupId,
    p_play_on: day || null,
    p_starts_at: startsAt,
    p_venue: str(fd, "venue").slice(0, 80) || null,
    p_note: str(fd, "note").slice(0, 300) || null,
  });
  if (error) fail(`${back}?oner=1`, rpcMessage(error, "Öneri gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [ids, name, { data: me }] = await Promise.all([
      groupMemberIds(admin, groupId, { canCreate: true }),
      groupName(admin, groupId),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    await notify(ids, "poll", text.proposalReceived(me?.display_name ?? "Bir üye", name, groupId, callWhen({ play_on: day, starts_at: startsAt })), { excludeUserId: user.id });
  });
  revalidatePath(back);
  redirect(`${back}?oneri=gonderildi#oneriler`);
}

export async function decideProposal(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const id = str(fd, "proposalId");
  const accept = str(fd, "accept") === "1";
  const back = `/g/${groupId}`;
  const { data: pollId, error } = await supabase.rpc("decide_proposal", { p_id: id, p_accept: accept });
  if (error) fail(`${back}#oneriler`, rpcMessage(error, "Karar kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const [{ data: p }, name] = await Promise.all([
      admin.from("match_proposals").select("proposed_by, play_on, starts_at, venue").eq("id", id).maybeSingle(),
      groupName(admin, groupId),
    ]);
    if (!p) return;
    await notify([p.proposed_by as string], "poll", text.proposalDecided(name, groupId, accept, (pollId as string | null) ?? null));
    if (accept && pollId) {
      // Açılan çağrı normal çağrı gibi gruba duyurulur (öneren ve onaylayan hariç)
      const ids = (await groupMemberIds(admin, groupId, { broadcast: true })).filter((u) => u !== p.proposed_by);
      await notify(ids, "poll", text.pollOpened(name, groupId, pollId as string, callWhen({ play_on: p.play_on as string, starts_at: p.starts_at as string | null }), p.venue as string | null), { excludeUserId: user.id });
    }
  });
  revalidatePath(back);
  redirect(accept && pollId ? callPath(groupId, pollId as string) : `${back}#oneriler`);
}

export async function cancelProposal(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const { error } = await supabase.rpc("cancel_proposal", { p_id: str(fd, "proposalId") });
  if (error) fail(`/g/${groupId}#oneriler`, rpcMessage(error, "Öneri geri çekilemedi"));
  revalidatePath(`/g/${groupId}`);
  redirect(`/g/${groupId}`);
}

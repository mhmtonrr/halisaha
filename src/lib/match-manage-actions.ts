"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds, groupName } from "@/lib/recipients";
import { POSITIONS, type Position } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";
import { splitTeams } from "@/lib/actions";

// Yeniden tasarım 4b: maç ekranı yönetimi (kadro, başvuru, ilan, bağlantı, rakip, kesinleştir/ertele/iptal).
// Yetki hep RPC'de (0042-0044); burada form okunur, bildirim gönderilir.

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string) {
  return error?.code === "P0001" && error.message ? error.message : fallback;
}
const asPosition = (v: string): Position | null => (POSITIONS.includes(v as Position) ? (v as Position) : null);
const matchPath = (groupId: string, matchId: string) => `/g/${groupId}/m/${matchId}`;
/** Form içi dönüş yolu (sadece uygulama içi) */
const backOf = (fd: FormData, fallback: string) => {
  const b = str(fd, "back");
  return b.startsWith("/") && !b.startsWith("//") ? b : fallback;
};

type Admin = ReturnType<typeof createAdminClient>;

/** Bildirim için maçın özeti */
async function matchInfo(admin: Admin, matchId: string) {
  const { data } = await admin
    .from("matches")
    .select("id, group_id, created_by, status, played_at, time_tbd, opponent_name, roster_count, capacity, challenge_id")
    .eq("id", matchId)
    .maybeSingle();
  return data;
}
/** Maçta kaydı şu durumlarda olan hesaplar */
async function entryUsers(admin: Admin, matchId: string, statuses: string[]) {
  const { data } = await admin.from("match_entries").select("user_id").eq("match_id", matchId).in("status", statuses).not("user_id", "is", null);
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}
async function managerIds(admin: Admin, groupId: string, createdBy: string | null) {
  return [...new Set([...(await groupMemberIds(admin, groupId, { adminsOnly: true })), ...(createdBy ? [createdBy] : [])])];
}
async function displayName(admin: Admin, userId: string) {
  const { data } = await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data?.display_name as string | undefined) ?? "Bir oyuncu";
}
const ids = (fd: FormData) => {
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  return { groupId, matchId, back: matchPath(groupId, matchId) };
};
function done(back: string, flash: string): never {
  revalidatePath(back);
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${flash}`);
}

/** Yöneten: kesin gelen ekle / yedekten kadroya al / kadrodan çıkar */
export async function manageEntry(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { matchId, back } = ids(fd);
  const target = str(fd, "userId");
  const op = str(fd, "op");
  if (!UUID_RE.test(target) || !["add", "promote", "remove"].includes(op)) fail(back, "Geçersiz işlem");
  const { error } = await supabase.rpc("manage_entry", { p_match: matchId, p_user: target, p_action: op });
  if (error) fail(back, rpcMessage(error, "Kadro güncellenemedi"));
  later(async () => {
    const admin = createAdminClient();
    const m = await matchInfo(admin, matchId);
    if (!m) return;
    const name = await groupName(admin, m.group_id);
    const when = matchWhen(m.played_at, m.time_tbd);
    if (op === "remove") await notify([target], "match", text.removedFromMatch(name, m.group_id, matchId, when), { excludeUserId: user.id });
    else await notify([target], "match", text.addedToRoster(await displayName(admin, user.id), name, m.group_id, matchId, when), { excludeUserId: user.id });
  });
  done(back, op === "remove" ? "cikarildi" : "eklendi");
}

/** Kaptan/yetkili: misafiri kadrodan çıkar (bu maç için açılan satırı da silinir) */
export async function removeGuest(fd: FormData) {
  const { supabase } = await requireUser();
  const { matchId, back } = ids(fd);
  const { error } = await supabase.rpc("remove_match_guest", { p_match: matchId, p_player: str(fd, "playerId") });
  if (error) fail(back, rpcMessage(error, "Misafir çıkarılamadı"));
  done(back, "cikarildi");
}

/** Yöneten: başvuruyu kabul (yer varsa kadro, yoksa yedek) / ret */
export async function decideApplication(fd: FormData) {
  const { supabase } = await requireUser();
  const { matchId, back } = ids(fd);
  const target = str(fd, "userId");
  const { data: result, error } = await supabase.rpc("decide_application", { p_match: matchId, p_user: target, p_accept: str(fd, "accept") === "1" });
  if (error) fail(back, rpcMessage(error, "Karar kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const m = await matchInfo(admin, matchId);
    if (!m) return;
    const r = result as "in" | "reserve" | "rejected";
    await notify([target], "match", text.applicationDecided(await groupName(admin, m.group_id), m.group_id, matchId, r, matchWhen(m.played_at, m.time_tbd)));
  });
  done(back, `basvuru-${result as string}`);
}

/** İlan veya bağlantıyla başvuru (maçı yönetenin onayına düşer) */
export async function applyMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { matchId, back: matchBack } = ids(fd);
  const back = backOf(fd, matchBack);
  const listing = str(fd, "listingId");
  const code = str(fd, "code");
  const { error } = await supabase.rpc("apply_match", {
    p_match: matchId,
    p_listing: UUID_RE.test(listing) ? listing : null,
    p_code: code || null,
    p_position: asPosition(str(fd, "position")),
    p_note: str(fd, "note").slice(0, 200) || null,
  });
  if (error) fail(back, rpcMessage(error, "Başvuru gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const m = await matchInfo(admin, matchId);
    if (!m) return;
    const managers = await managerIds(admin, m.group_id, m.created_by);
    const content = text.applicationReceived(await displayName(admin, user.id), await groupName(admin, m.group_id), m.group_id, matchId, code ? "bağlantıyla" : "ilandan");
    await notify(managers, "match", content, { excludeUserId: user.id });
  });
  done(back, "basvuru");
}

export async function cancelApplication(fd: FormData) {
  const { supabase } = await requireUser();
  const { matchId, back: matchBack } = ids(fd);
  const back = backOf(fd, matchBack);
  const { error } = await supabase.rpc("cancel_application", { p_match: matchId });
  if (error) fail(back, rpcMessage(error, "Başvuru geri çekilemedi"));
  revalidatePath(back);
  redirect(back);
}

/** Adam ara: Keşfet'e (hedef boş) veya bir gruba ilan; grupta yetkisi yoksa o grubun onayına düşer */
export async function createListing(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { matchId, back } = ids(fd);
  const target = str(fd, "target");
  const positions = fd.getAll("positions").map(String).filter((p) => !!asPosition(p));
  const { data: listingId, error } = await supabase.rpc("create_listing", {
    p_match: matchId,
    p_target: UUID_RE.test(target) ? target : null,
    p_positions: positions,
    p_note: str(fd, "note").slice(0, 200) || null,
  });
  if (error || !listingId) fail(back, rpcMessage(error, "İlan açılamadı"));
  if (UUID_RE.test(target)) {
    later(async () => {
      const admin = createAdminClient();
      const [m, { data: l }] = await Promise.all([
        matchInfo(admin, matchId),
        admin.from("match_listings").select("status").eq("id", listingId as string).maybeSingle(),
      ]);
      if (!m || !l) return;
      const [fromName, targetName] = await Promise.all([groupName(admin, m.group_id), groupName(admin, target)]);
      const when = matchWhen(m.played_at, m.time_tbd);
      if (l.status === "pending") {
        const admins = await groupMemberIds(admin, target, { adminsOnly: true });
        await notify(admins, "listing", text.listingNeedsApproval(await displayName(admin, user.id), fromName, target, when), { excludeUserId: user.id });
      } else {
        const needed = Math.max(1, (m.capacity ?? 0) - m.roster_count);
        const members = await groupMemberIds(admin, target, { broadcast: true });
        await notify(members, "listing", text.listingOpened(fromName, targetName, m.group_id, matchId, needed, when), { excludeUserId: user.id });
      }
    });
  }
  done(back, "ilan");
}

/** Hedef grubun kaptan/yetkilisi: bekleyen ilanı yayınla / reddet (bekleyen istekler sayfasından) */
export async function decideListing(fd: FormData) {
  const { supabase, user } = await requireUser();
  const listingId = str(fd, "listingId");
  const target = str(fd, "groupId");
  const back = `/g/${target}/istekler`;
  const accept = str(fd, "accept") === "1";
  const { error } = await supabase.rpc("decide_listing", { p_listing: listingId, p_accept: accept });
  if (error) fail(back, rpcMessage(error, "Karar kaydedilemedi"));
  if (accept) {
    later(async () => {
      const admin = createAdminClient();
      const { data: l } = await admin.from("match_listings").select("match_id").eq("id", listingId).maybeSingle();
      const m = l ? await matchInfo(admin, l.match_id as string) : null;
      if (!m) return;
      const [fromName, targetName] = await Promise.all([groupName(admin, m.group_id), groupName(admin, target)]);
      const needed = Math.max(1, (m.capacity ?? 0) - m.roster_count);
      const members = await groupMemberIds(admin, target, { broadcast: true });
      await notify(members, "listing", text.listingOpened(fromName, targetName, m.group_id, m.id, needed, matchWhen(m.played_at, m.time_tbd)), { excludeUserId: user.id });
    });
  }
  revalidatePath(`/g/${target}`, "layout");
  redirect(`${back}?sekme=ilan`);
}

export async function closeListing(fd: FormData) {
  const { supabase } = await requireUser();
  const { back } = ids(fd);
  const { error } = await supabase.rpc("close_listing", { p_listing: str(fd, "listingId") });
  if (error) fail(back, rpcMessage(error, "İlan kapatılamadı"));
  done(back, "ilan-kapandi");
}

/** Bağlantı kodunu yenile (eski bağlantı geçersiz olur) */
export async function regenerateMatchCode(fd: FormData) {
  const { supabase } = await requireUser();
  const { matchId, back } = ids(fd);
  const { error } = await supabase.rpc("match_invite_code", { p_match: matchId, p_regenerate: true });
  if (error) fail(back, rpcMessage(error, "Bağlantı yenilenemedi"));
  done(back, "kod");
}

/** Rakip adı (uygulamada olmayan takım) */
export async function setOpponent(fd: FormData) {
  const { supabase } = await requireUser();
  const { matchId, back } = ids(fd);
  const { error } = await supabase.rpc("set_match_opponent", { p_match: matchId, p_name: str(fd, "opponent").slice(0, 60) });
  if (error) fail(back, rpcMessage(error, "Rakip kaydedilemedi"));
  done(back, "rakip");
}

/** Uygulamadaki takıma bu maçtan teklif */
export async function sendChallenge(fd: FormData) {
  const { supabase } = await requireUser();
  const { groupId, matchId, back } = ids(fd);
  const to = str(fd, "toGroupId");
  const { error } = await supabase.rpc("create_challenge_v2", { p_match: matchId, p_to: to, p_message: str(fd, "message").slice(0, 300) || null, p_fee: null });
  if (error) fail(back, rpcMessage(error, "Teklif gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const m = await matchInfo(admin, matchId);
    if (!m) return;
    const admins = await groupMemberIds(admin, to, { adminsOnly: true });
    await notify(admins, "offer", text.challengeReceived(await groupName(admin, groupId), to, matchWhen(m.played_at, m.time_tbd)));
  });
  done(back, "teklif");
}

/** Bekleyen teklife yanıt (sırası gelen taraf; maç ekranından) */
export async function answerChallenge(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { groupId, back } = ids(fd);
  const challengeId = str(fd, "challengeId");
  const accept = str(fd, "accept") === "1";
  const { error } = await supabase.rpc("respond_challenge", { p_challenge_id: challengeId, p_accept: accept });
  if (error) fail(back, rpcMessage(error, "Teklif yanıtlanamadı"));
  later(async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("from_group_id, to_group_id").eq("id", challengeId).maybeSingle();
    if (!c) return;
    const other = c.from_group_id === groupId ? c.to_group_id : c.from_group_id;
    const admins = await groupMemberIds(admin, other, { adminsOnly: true });
    await notify(admins, "offer", text.challengeAnswered(await groupName(admin, groupId), other, accept), { excludeUserId: user.id });
  });
  done(back, accept ? "teklif-kabul" : "teklif-ret");
}

/** Bekleyen teklifte sırası gelen: tarih/saha değiştirip geri yollar (maç ekranı veya teklifler sayfası) */
export async function counterChallenge(fd: FormData) {
  const { supabase } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = backOf(fd, `/g/${groupId}/teklifler`);
  const challengeId = str(fd, "challengeId");
  const time = str(fd, "time");
  const { error } = await supabase.rpc("counter_challenge", {
    p_challenge: challengeId,
    p_day: str(fd, "day"),
    p_time: /^\d{2}:\d{2}$/.test(time) ? time : null,
    p_venue: str(fd, "venue").slice(0, 80) || null,
  });
  if (error) fail(back, rpcMessage(error, "Karşı teklif gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("awaiting_group_id, proposed_at, proposed_tbd").eq("id", challengeId).maybeSingle();
    if (!c?.awaiting_group_id) return;
    const admins = await groupMemberIds(admin, c.awaiting_group_id, { adminsOnly: true });
    await notify(admins, "offer", text.counterOffer(await groupName(admin, groupId), c.awaiting_group_id, matchWhen(c.proposed_at, c.proposed_tbd), false));
  });
  revalidatePath(back);
  redirect(back);
}

/** Bağlı iki maçın (veya tek maçın) kadro ve yedeklerine yeni tarih */
async function notifyRescheduled(matchId: string, actor: string) {
  const admin = createAdminClient();
  const m = await matchInfo(admin, matchId);
  if (!m) return;
  const { data: all } = m.challenge_id
    ? await admin.from("matches").select("id, group_id, status").eq("challenge_id", m.challenge_id)
    : { data: [{ id: m.id, group_id: m.group_id, status: m.status }] };
  for (const x of all ?? []) {
    const users = await entryUsers(admin, x.id as string, ["in", "reserve", "invited"]);
    const content = text.matchRescheduled(await groupName(admin, x.group_id as string), x.group_id as string, x.id as string, matchWhen(m.played_at, m.time_tbd), x.status === "planned");
    await notify(users, "match", content, { excludeUserId: actor });
  }
}

/** Bağlı maçta tarih değişikliği önerisi (rakibin onayına) */
async function proposeLinkedReschedule(fd: FormData, challengeId: string, time: string | null) {
  const { supabase } = await requireUser();
  const { groupId, back } = ids(fd);
  const { error } = await supabase.rpc("propose_reschedule", {
    p_challenge: challengeId,
    p_day: str(fd, "day"),
    p_time: time,
    p_venue: str(fd, "venue").slice(0, 80) || null,
  });
  if (error) fail(back, rpcMessage(error, "Tarih önerisi gönderilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.from("match_challenges").select("awaiting_group_id, pending_at, pending_tbd").eq("id", challengeId).maybeSingle();
    if (!c?.awaiting_group_id || !c.pending_at) return;
    const admins = await groupMemberIds(admin, c.awaiting_group_id, { adminsOnly: true });
    await notify(admins, "offer", text.counterOffer(await groupName(admin, groupId), c.awaiting_group_id, matchWhen(c.pending_at, !!c.pending_tbd), true));
  });
  done(back, "tarih-onerildi");
}

export async function respondReschedule(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { matchId, back } = ids(fd);
  const accept = str(fd, "accept") === "1";
  const { error } = await supabase.rpc("respond_reschedule", { p_challenge: str(fd, "challengeId"), p_accept: accept });
  if (error) fail(back, rpcMessage(error, "Yanıt kaydedilemedi"));
  if (accept) later(() => notifyRescheduled(matchId, user.id));
  done(back, accept ? "ertelendi" : "tarih-reddedildi");
}

/** Kesinleştir: saat zorunlu (saat belli değilse burada seçilir); kendi aramızda taraflar dengelenir */
export async function confirmMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { groupId, matchId, back } = ids(fd);
  const day = str(fd, "day");
  const time = str(fd, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) fail(back, "Kesinleştirmek için gün ve saati seç");
  const { error } = await supabase.rpc("confirm_match", { p_match: matchId, p_starts_at: new Date(`${day}T${time}:00+03:00`).toISOString() });
  if (error) fail(back, rpcMessage(error, "Maç kesinleştirilemedi"));
  const { data: k } = await supabase.from("matches").select("kind").eq("id", matchId).maybeSingle();
  if (k?.kind === "internal") await splitTeams(groupId, matchId);
  later(async () => {
    const admin = createAdminClient();
    const m = await matchInfo(admin, matchId);
    if (!m) return;
    const users = await entryUsers(admin, matchId, ["in"]);
    await notify(users, "match", text.matchConfirmed(await groupName(admin, m.group_id), m.group_id, matchId, matchWhen(m.played_at, false), m.opponent_name), { excludeUserId: user.id });
  });
  done(back, "kesin");
}

/** Ertele: kadro korunur; bağlı maçta rakibe tarih önerisi olarak gider */
export async function rescheduleMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { matchId, back } = ids(fd);
  const day = str(fd, "day");
  const tbd = str(fd, "timeMode") === "tbd";
  const time = tbd ? null : str(fd, "time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (!tbd && !/^\d{2}:\d{2}$/.test(time ?? ""))) fail(back, "Yeni gün ve saati seç");
  const { data: m } = await supabase.from("matches").select("challenge_id").eq("id", matchId).maybeSingle();
  if (m?.challenge_id) return proposeLinkedReschedule(fd, m.challenge_id as string, time);
  const { error } = await supabase.rpc("reschedule_match", { p_match: matchId, p_day: day, p_time: time });
  if (error) fail(back, rpcMessage(error, "Maç ertelenemedi"));
  later(() => notifyRescheduled(matchId, user.id));
  done(back, "ertelendi");
}

/** İptal (silinmez): kadro, yedek, davetli ve başvuranlara; bağlı maçta iki takıma */
export async function cancelMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const { groupId, matchId, back } = ids(fd);
  const admin = createAdminClient();
  const before = await matchInfo(admin, matchId);
  const { error } = await supabase.rpc("cancel_match", { p_match: matchId, p_reason: str(fd, "reason").slice(0, 200) || null });
  if (error) fail(back, rpcMessage(error, "Maç iptal edilemedi"));
  later(async () => {
    if (!before) return;
    const { data: all } = before.challenge_id
      ? await admin.from("matches").select("id, group_id, opponent_name").eq("challenge_id", before.challenge_id)
      : { data: [{ id: before.id, group_id: before.group_id, opponent_name: before.opponent_name }] };
    for (const x of all ?? []) {
      const users = await entryUsers(admin, x.id as string, ["in", "reserve", "invited", "pending"]);
      const content = text.matchCancelled(await groupName(admin, x.group_id as string), x.group_id as string, x.id as string, matchWhen(before.played_at, before.time_tbd), x.opponent_name as string | null);
      await notify(users, "match", content, { excludeUserId: user.id });
    }
  });
  revalidatePath(`/g/${groupId}`);
  revalidatePath("/");
  done(back, "iptal");
}

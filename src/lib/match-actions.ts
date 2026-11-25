"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { later, notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds, groupName } from "@/lib/recipients";
import { isValidSize } from "@/lib/formations";
import { POSITIONS, type Position } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";
import { splitTeams } from "@/lib/actions";

// Yeni maç yapısı (0042-0044) Server Action'ları. Yetki hep RPC'de; burada form okunur, bildirim gönderilir.

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

/** "Maç ayarla": maçı açar (kadro dolu + saat + rakip belliyse direkt kesin), istenirse rakip takıma teklif gönderir */
export async function setupMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const back = `/mac-ayarla?grup=${encodeURIComponent(groupId)}`;
  if (!UUID_RE.test(groupId)) fail("/mac-ayarla", "Takım veya grup seç");
  const day = str(fd, "day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(back, "Maç gününü seç");
  const tbd = str(fd, "timeMode") === "tbd";
  const time = tbd ? "" : str(fd, "time");
  if (!tbd && !/^\d{2}:\d{2}$/.test(time)) fail(back, "Saati seç veya \"Sonra belirlenecek\"i işaretle");
  const size = Number(fd.get("size"));
  if (!isValidSize(size)) fail(back, "Kaç kişilik olduğunu seç");
  const capRaw = Number(fd.get("capacity"));
  const kind = str(fd, "kind") === "internal" ? "internal" : "external";
  const rival = str(fd, "rivalTeam");
  const confirmed = fd.getAll("confirmed").map(String).filter((id) => UUID_RE.test(id) && id !== user.id);
  const guestNames = fd.getAll("guestName").map((v) => String(v).trim());
  const guestPositions = fd.getAll("guestPos").map(String);
  const guests = guestNames
    .map((name, i) => ({ name: name.slice(0, 40), position: asPosition(guestPositions[i] ?? "") }))
    .filter((g) => g.name.length >= 2);

  const { data: matchId, error } = await supabase.rpc("create_match_v2", {
    p_group: groupId,
    p_day: day,
    p_time: tbd ? null : time,
    p_team_size: size,
    p_kind: kind,
    p_opponent: kind === "external" && !rival ? str(fd, "opponent").slice(0, 60) || null : null,
    p_venue: str(fd, "venue").slice(0, 80) || null,
    p_note: str(fd, "note").slice(0, 300) || null,
    p_capacity: Number.isInteger(capRaw) && capRaw >= 2 && capRaw <= 30 ? capRaw : null,
    p_with_me: fd.get("withMe") === "1",
    p_confirmed: confirmed,
    p_guests: guests,
    p_announce: fd.get("announce") === "1",
  });
  if (error || !matchId) fail(back, rpcMessage(error, "Maç ayarlanamadı"));
  const id = matchId as string;

  // Uygulamadaki rakibe teklif (Keşfet "Meydan Oku"dan gelindiyse); başarısızsa maç yine açık kalır
  // Kendi aramızda maç direkt kesin açıldıysa taraflar hemen dengelenir (toplanırken herkes A; kesinleşince bölünür)
  if (kind === "internal") {
    const { data: st } = await supabase.from("matches").select("status").eq("id", id).maybeSingle();
    if (st?.status === "planned") await splitTeams(groupId, id);
  }

  let challengeError: string | null = null;
  if (kind === "external" && UUID_RE.test(rival)) {
    const { error: chErr } = await supabase.rpc("create_challenge_v2", { p_match: id, p_to: rival, p_message: null, p_fee: null });
    if (chErr) challengeError = rpcMessage(chErr, "Teklif gönderilemedi");
  }

  later(async () => {
    const admin = createAdminClient();
    const [{ data: m }, name, { data: me }] = await Promise.all([
      admin.from("matches").select("status, played_at, time_tbd, opponent_name, roster_count, capacity, open_to_members").eq("id", id).maybeSingle(),
      groupName(admin, groupId),
      admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    if (!m) return;
    const when = matchWhen(m.played_at, m.time_tbd);
    const who = me?.display_name ?? "Bir yetkili";
    if (confirmed.length) await notify(confirmed, "match", text.addedToRoster(who, name, groupId, id, when), { excludeUserId: user.id });
    if (m.status === "planned") {
      const { data: rows } = await admin.from("match_entries").select("user_id").eq("match_id", id).eq("status", "in").not("user_id", "is", null);
      const roster = (rows ?? []).map((r) => r.user_id as string).filter((u) => !confirmed.includes(u));
      await notify(roster, "match", text.matchCreated(name, groupId, id, when, m.opponent_name), { excludeUserId: user.id });
    } else if (m.open_to_members) {
      const members = (await groupMemberIds(admin, groupId, { broadcast: true })).filter((u) => !confirmed.includes(u));
      await notify(members, "match", text.matchGathering(name, groupId, id, when, m.roster_count, m.capacity ?? m.roster_count), { excludeUserId: user.id });
    }
    if (kind === "external" && UUID_RE.test(rival) && !challengeError) {
      const rivalAdmins = await groupMemberIds(admin, rival, { adminsOnly: true });
      await notify(rivalAdmins, "offer", text.challengeReceived(name, rival, when));
    }
  });

  revalidatePath(`/g/${groupId}`);
  revalidatePath("/");
  const dest = matchPath(groupId, id);
  if (challengeError) fail(dest, `Maç açıldı ama teklif gönderilemedi: ${challengeError}`);
  redirect(dest);
}

/** Maç ekranında "Geliyorum / Gelemem": yer varsa kadro, doluysa yedek; kadro dolunca yönetenlere haber */
export async function respondMatch(fd: FormData) {
  const { supabase, user } = await requireUser();
  const groupId = str(fd, "groupId");
  const matchId = str(fd, "matchId");
  const back = matchPath(groupId, matchId);
  const answer = str(fd, "answer") === "no" ? "no" : "yes";
  const { data: result, error } = await supabase.rpc("respond_match", {
    p_match: matchId,
    p_answer: answer,
    p_position: asPosition(str(fd, "position")),
    p_note: str(fd, "note").slice(0, 200) || null,
  });
  if (error) fail(back, rpcMessage(error, "Yanıt kaydedilemedi"));
  later(async () => {
    const admin = createAdminClient();
    const { data: m } = await admin
      .from("matches")
      .select("group_id, created_by, roster_count, reserve_count, capacity, status")
      .eq("id", matchId)
      .maybeSingle();
    if (!m || m.status !== "gathering") return;
    const managers = [...new Set([...(await groupMemberIds(admin, m.group_id, { adminsOnly: true })), ...(m.created_by ? [m.created_by] : [])])];
    if (result === "in" && m.capacity && m.roster_count >= m.capacity) {
      await notify(managers, "match", text.rosterFull(await groupName(admin, m.group_id), m.group_id, matchId, m.roster_count), { excludeUserId: user.id });
    }
  });
  revalidatePath(back);
  redirect(`${back}?yanit=${result as string}`);
}

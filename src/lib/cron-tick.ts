import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeExpired } from "@/lib/finalize";
import { sendVoteReminders } from "@/lib/reminders";
import { notify } from "@/lib/notify";
import { text } from "@/lib/notify-rules";
import { groupMemberIds, groupName, matchAccountIds } from "@/lib/recipients";
import { formatDate } from "@/lib/data";
import { matchWhen } from "@/lib/match-rules";

type Admin = ReturnType<typeof createAdminClient>;

const TZ = "Europe/Istanbul";
/** İstanbul'daki gün (YYYY-MM-DD) ve saat */
export function istanbulNow(now: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

const whenText = matchWhen;

/** Aynı etiketli bildirimi zaten almış olanları çıkarır (her iş her kişiye bir kez) */
async function notYetTagged(admin: Admin, userIds: string[], tag: string) {
  if (!userIds.length) return [];
  const { data } = await admin.from("notifications").select("user_id").eq("tag", tag).in("user_id", userIds);
  const done = new Set((data ?? []).map((r) => r.user_id as string));
  return userIds.filter((id) => !done.has(id));
}

/** Maçı yönetenler: kuran + grubun kaptan/yetkilileri */
async function managers(admin: Admin, groupId: string, createdBy: string | null) {
  const ids = await groupMemberIds(admin, groupId, { adminsOnly: true });
  return [...new Set([...ids, ...(createdBy ? [createdBy] : [])])];
}

/**
 * Zamanlanmış işler (her 15 dakikada; pg_cron → /api/cron/tick, Vercel Cron günde 1 yedek). Her adım tek başına
 * tekrar çalıştırılabilir: durum değişiklikleri veritabanında bir kez olur, hatırlatmalar etiketle bir kez gider.
 */
export async function runTick(now = Date.now()) {
  const admin = createAdminClient();
  const out: Record<string, number> = {};

  // 1) Süresi dolan oylamalar kapanır (sonuçlar açıklanır)
  out.finalized = await finalizeExpired();

  // 2) Maça 3 saat kala yedekten otomatik kadroya
  const { data: promoted } = await admin.rpc("cron_promote_reserves");
  out.promoted = 0;
  for (const p of (promoted ?? []) as { match_id: string; group_id: string; user_id: string }[]) {
    const [{ data: m }, name] = await Promise.all([
      admin.from("matches").select("played_at, time_tbd").eq("id", p.match_id).maybeSingle(),
      groupName(admin, p.group_id),
    ]);
    await notify([p.user_id], "match", text.autoPromoted(name, p.group_id, p.match_id, m ? whenText(m.played_at, m.time_tbd) : ""));
    out.promoted++;
  }

  // 3) Saati geçen toplanan maç iptal: kadro, yedek, davetli ve başvuranlara
  const { data: cancelled } = await admin.rpc("cron_cancel_stale");
  out.cancelled = 0;
  for (const c of (cancelled ?? []) as { match_id: string; group_id: string; played_at: string; time_tbd: boolean }[]) {
    const { data: entries } = await admin
      .from("match_entries")
      .select("user_id")
      .eq("match_id", c.match_id)
      .in("status", ["reserve", "invited", "pending"])
      .not("user_id", "is", null);
    const ids = [...(await matchAccountIds(admin, [c.match_id])), ...(entries ?? []).map((e) => e.user_id as string)];
    await notify(ids, "match", text.gatheringExpired(await groupName(admin, c.group_id), c.group_id, c.match_id, whenText(c.played_at, c.time_tbd)));
    out.cancelled++;
  }

  // 4) 2 gün skor girilmeyen kesin maç sonuçsuz kapanır; maçı yönetenlere (kaptan/yetkili + kuran) haber
  const { data: voided } = await admin.rpc("cron_no_result");
  out.noResult = (voided ?? []).length;
  const voidedIds = ((voided ?? []) as { match_id: string }[]).map((v) => v.match_id);
  if (voidedIds.length) {
    const { data: rows } = await admin.from("matches").select("id, group_id, created_by, played_at, time_tbd").in("id", voidedIds);
    for (const m of rows ?? []) {
      const ids = await managers(admin, m.group_id, m.created_by);
      await notify(ids, "match", text.matchNoResult(await groupName(admin, m.group_id), m.group_id, m.id, whenText(m.played_at, m.time_tbd)));
    }
  }

  // 5) Maç günü 10:00'dan sonra: kesin maçın kadrosuna "bugün maç var", hâlâ toplanan maçı yönetenlere uyarı
  const ist = istanbulNow(now);
  out.today = 0;
  if (ist.hour >= 10) {
    const dayStart = new Date(`${ist.day}T00:00:00+03:00`).toISOString();
    const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 3600_000).toISOString();
    const { data: todays } = await admin
      .from("matches")
      .select("id, group_id, status, played_at, time_tbd, opponent_name, created_by, roster_count, capacity")
      .in("status", ["planned", "gathering"])
      .gte("played_at", dayStart)
      .lt("played_at", dayEnd)
      .limit(500);
    for (const m of todays ?? []) {
      if (m.status === "planned" && new Date(m.played_at).getTime() <= now) continue;
      const name = await groupName(admin, m.group_id);
      if (m.status === "planned") {
        const content = text.matchToday(name, m.group_id, m.id, formatDate(m.played_at), m.opponent_name);
        const ids = await notYetTagged(admin, await matchAccountIds(admin, [m.id]), content.tag!);
        out.today += (await notify(ids, "match", content)).stored;
      } else {
        const content = text.gatheringWarning(name, m.group_id, m.id, m.roster_count, m.capacity ?? m.roster_count);
        const ids = await notYetTagged(admin, await managers(admin, m.group_id, m.created_by), content.tag!);
        out.today += (await notify(ids, "match", content)).stored;
      }
    }
  }

  // 6) Skor hatırlatması: maçtan 2 saat sonra, sonra ertesi gün (2 gün dolunca sonuçsuz)
  out.scoreReminders = 0;
  const { data: unscored } = await admin
    .from("matches")
    .select("id, group_id, played_at, created_by")
    .eq("status", "planned")
    .lt("played_at", new Date(now - 2 * 3600_000).toISOString())
    .gt("played_at", new Date(now - 2 * 24 * 3600_000).toISOString())
    .limit(500);
  for (const m of unscored ?? []) {
    const second = new Date(m.played_at).getTime() < now - 24 * 3600_000;
    const content = text.scoreReminder(await groupName(admin, m.group_id), m.group_id, m.id, second);
    const ids = await notYetTagged(admin, await managers(admin, m.group_id, m.created_by), content.tag!);
    out.scoreReminders += (await notify(ids, "match", content)).stored;
  }

  // 7) Oylamanın son 6 saati: oy vermeyenlere
  const votes = await sendVoteReminders(now, 6);
  out.voteReminders = votes.reminded;
  return out;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunks, fetchIn } from "@/lib/fetch-in";
import { computeSkills, isMutualHigh, voterNorm, type Scores, type SkillRating } from "@/lib/skills";

interface RatingRow {
  voter_id: string;
  target_user: string | null;
  target_player: string | null;
  scores: Scores;
}

const COLS = "voter_id, target_user, target_player, scores";

/**
 * Verilen oyuncuların (ve aynı kişinin diğer grup satırlarının) yeteneklerini aldıkları değerlendirmelerden
 * yeniden hesaplayıp `player_skills`'e yazar. Kimlik: hesap sahibinde user_id, misafirde group_players.id.
 * Oy verenin normalizasyonu (herkese ne kadar cömert puan verdiği) onun TÜM değerlendirmelerinden çıkar.
 */
export async function recomputeSkills(admin: SupabaseClient, playerIds: string[]): Promise<void> {
  const ids = [...new Set(playerIds)];
  if (!ids.length) return;

  // 1) Kişiler ve tüm grup satırları
  const seed = await fetchIn<{ id: string; user_id: string | null }>(ids, (part, from, to) =>
    admin.from("group_players").select("id, user_id").in("id", part).range(from, to),
  );
  const userIds = [...new Set(seed.map((p) => p.user_id).filter((x): x is string => !!x))];
  const siblings = userIds.length
    ? await fetchIn<{ id: string; user_id: string | null }>(userIds, (part, from, to) =>
        admin.from("group_players").select("id, user_id").in("user_id", part).range(from, to),
      )
    : [];
  const people = new Map<string, { userId: string | null; rows: Set<string> }>();
  for (const p of [...seed, ...siblings]) {
    const key = p.user_id ?? p.id;
    const cur = people.get(key) ?? people.set(key, { userId: p.user_id, rows: new Set() }).get(key)!;
    cur.rows.add(p.id);
  }
  const allRows = [...people.values()].flatMap((p) => [...p.rows]);
  const allUsers = [...people.values()].map((p) => p.userId).filter((x): x is string => !!x);

  // 2) Bu kişilere verilen değerlendirmeler (hesap: target_user; misafir veya sonradan hesaba aktarılan: target_player)
  const received = [
    ...(await fetchIn<RatingRow>(allUsers, (part, from, to) =>
      admin.from("skill_ratings").select(COLS).in("target_user", part).range(from, to),
    )),
    ...(await fetchIn<RatingRow>(allRows, (part, from, to) =>
      admin.from("skill_ratings").select(COLS).in("target_player", part).range(from, to),
    )),
  ];

  // 3) Normalizasyon ve klik için: bu oy verenlerin ve hedef hesapların verdiği TÜM değerlendirmeler
  const voterIds = [...new Set([...received.map((r) => r.voter_id), ...allUsers])];
  const given = await fetchIn<RatingRow>(voterIds, (part, from, to) =>
    admin.from("skill_ratings").select(COLS).in("voter_id", part).range(from, to),
  );
  const givenBy = new Map<string, RatingRow[]>();
  for (const r of given) (givenBy.get(r.voter_id) ?? givenBy.set(r.voter_id, []).get(r.voter_id)!).push(r);
  const normOf = new Map<string, ReturnType<typeof voterNorm>>();
  const norm = (voter: string) =>
    normOf.get(voter) ?? normOf.set(voter, voterNorm((givenBy.get(voter) ?? []).map((r) => r.scores))).get(voter)!;

  // 4) Kişi başına değerlendirmeleri kur, hesapla
  type W = { skills: Record<string, number | null>; voters: number; ballots: number };
  const userWrites: (W & { user_id: string })[] = [];
  const guestWrites: (W & { player_id: string })[] = [];
  const seen = new Set<string>();
  for (const [, person] of people) {
    const ratings: SkillRating[] = [];
    seen.clear();
    for (const r of received) {
      const mine = (r.target_user && r.target_user === person.userId) || (r.target_player && person.rows.has(r.target_player));
      if (!mine || seen.has(r.voter_id)) continue; // aynı oy veren iki kez sayılmaz (misafir + sonradan hesap)
      seen.add(r.voter_id);
      const back = person.userId ? (givenBy.get(person.userId) ?? []).find((g) => g.target_user === r.voter_id) : undefined;
      ratings.push({
        voterKey: r.voter_id,
        scores: r.scores,
        norm: norm(r.voter_id),
        mutualHigh: isMutualHigh(r.scores, back?.scores),
      });
    }
    const skills: Record<string, number | null> = {};
    for (const keeper of [false, true]) for (const s of computeSkills(ratings, keeper)) skills[s.key] = s.value;
    const w = { skills, voters: ratings.length, ballots: ratings.length };
    // Hesap sahibi: user_skills'e tek satır; misafir: kendi group_players satırı
    if (person.userId) userWrites.push({ user_id: person.userId, ...w });
    else for (const id of person.rows) guestWrites.push({ player_id: id, ...w });
  }

  const now = new Date().toISOString();
  for (const part of chunks(userWrites, 200)) {
    const { error } = await admin.from("user_skills").upsert(part.map((w) => ({ ...w, updated_at: now })), { onConflict: "user_id" });
    if (error) throw error;
  }
  for (const part of chunks(guestWrites, 200)) {
    const { error } = await admin.from("player_skills").upsert(part.map((w) => ({ ...w, updated_at: now })), { onConflict: "player_id" });
    if (error) throw error;
  }
}

/**
 * Bir oy verenin değerlendirdiği herkesin değeri yeniden hesaplanır: oy verenin normalizasyonu (cömertliği)
 * yeni puanla değişir ve hedeflerin hepsini etkiler.
 */
export async function recomputeSkillsForVoter(admin: SupabaseClient, voterId: string): Promise<void> {
  const { data, error } = await admin.from("skill_ratings").select("target_user, target_player").eq("voter_id", voterId);
  if (error) throw error;
  const users = (data ?? []).map((r) => r.target_user).filter((x): x is string => !!x);
  const players = (data ?? []).map((r) => r.target_player).filter((x): x is string => !!x);
  const viaUser = await fetchIn<{ id: string }>(users, (part, from, to) =>
    admin.from("group_players").select("id").in("user_id", part).range(from, to),
  );
  await recomputeSkills(admin, [...players, ...viaUser.map((r) => r.id)]);
}


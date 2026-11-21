import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SKILL_KEYS, computeSkills, type SkillBallot, type SkillKey } from "@/lib/skills";

type GpRow = { id: string; user_id: string | null; position: string | null };
const IN_CHUNK = 100;
const PAGE = 1000;

const chunks = <T,>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** `in (...)` sorgusunu parçalara bölüp sayfalayarak hepsini çeker */
async function fetchIn<T>(
  ids: string[],
  build: (part: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunks(ids, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(part, from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

interface MpRow {
  match_id: string;
  player_id: string;
  position: string | null;
  is_goalkeeper: boolean | null;
}

/**
 * Verilen oyuncuların (ve aynı kişinin diğer grup satırlarının) yeteneklerini oy pusulalarından yeniden hesaplayıp
 * `player_skills`'e yazar. Kimlik: hesap sahibinde user_id, misafirde group_players.id (rating'le aynı).
 * Bağlı (rakip takımla ortak) maçta iki kadro tek havuzdur: pusula havuzdaki herkesi kapsar.
 */
export async function recomputeSkills(admin: SupabaseClient, playerIds: string[]): Promise<void> {
  const ids = [...new Set(playerIds)];
  if (!ids.length) return;

  // 1) Kişi kimlikleri ve kişinin tüm satırları
  const seed = await fetchIn<GpRow>(ids, (part, from, to) =>
    admin.from("group_players").select("id, user_id, position").in("id", part).range(from, to),
  );
  const userIds = [...new Set(seed.map((p) => p.user_id).filter((x): x is string => !!x))];
  const siblings = userIds.length
    ? await fetchIn<GpRow>(userIds, (part, from, to) =>
        admin.from("group_players").select("id, user_id, position").in("user_id", part).range(from, to),
      )
    : [];
  const people = new Map<string, Set<string>>(); // anahtar → satır id'leri
  const keyOf = new Map<string, string>(); // satır id → anahtar
  const gpPos = new Map<string, string | null>(); // satır id → profil mevkisi
  for (const p of [...seed, ...siblings]) {
    const key = p.user_id ?? p.id;
    keyOf.set(p.id, key);
    gpPos.set(p.id, p.position);
    (people.get(key) ?? people.set(key, new Set()).get(key)!).add(p.id);
  }
  const allRows = [...keyOf.keys()];

  // 2) Kişilerin maçları ve bağlı (rakip) maçlar
  const own = await fetchIn<MpRow>(allRows, (part, from, to) =>
    admin.from("match_players").select("match_id, player_id, position, is_goalkeeper").in("player_id", part).range(from, to),
  );
  const ownMatchIds = [...new Set(own.map((r) => r.match_id))];
  const matchRows = await fetchIn<{ id: string; challenge_id: string | null }>(ownMatchIds, (part, from, to) =>
    admin.from("matches").select("id, challenge_id").in("id", part).range(from, to),
  );
  const challengeIds = [...new Set(matchRows.map((m) => m.challenge_id).filter((x): x is string => !!x))];
  const linked = challengeIds.length
    ? await fetchIn<{ id: string; challenge_id: string | null }>(challengeIds, (part, from, to) =>
        admin.from("matches").select("id, challenge_id").in("challenge_id", part).range(from, to),
      )
    : [];
  // Havuz: aynı challenge_id'li maçlar tek havuz, bağsız maç kendi havuzu
  const poolOf = new Map<string, string>();
  for (const m of [...matchRows, ...linked]) poolOf.set(m.id, m.challenge_id ?? m.id);
  const poolMatches = new Map<string, string[]>();
  for (const [mid, pool] of poolOf) (poolMatches.get(pool) ?? poolMatches.set(pool, []).get(pool)!).push(mid);
  const allMatchIds = [...poolOf.keys()];

  // 3) Havuzlardaki kadrolar, pusulalar, işaretler
  const [rosterRows, ballotRows] = await Promise.all([
    fetchIn<MpRow>(allMatchIds, (part, from, to) =>
      admin.from("match_players").select("match_id, player_id, position, is_goalkeeper").in("match_id", part).range(from, to),
    ),
    fetchIn<{ id: string; match_id: string; voter_id: string }>(allMatchIds, (part, from, to) =>
      admin.from("skill_ballots").select("id, match_id, voter_id").in("match_id", part).range(from, to),
    ),
  ]);
  const ballotIds = ballotRows.map((b) => b.id);
  const pickRows = await fetchIn<{ ballot_id: string; category: string; nominee_id: string }>(ballotIds, (part, from, to) =>
    admin.from("skill_picks").select("ballot_id, category, nominee_id").in("ballot_id", part).range(from, to),
  );

  // Kadrodaki herkesin kimlik anahtarı (rakip kadrolar dahil)
  const unknown = [...new Set([...rosterRows.map((r) => r.player_id), ...ballotRows.map((b) => b.voter_id)])].filter((id) => !keyOf.has(id));
  const extra = await fetchIn<GpRow>(unknown, (part, from, to) =>
    admin.from("group_players").select("id, user_id, position").in("id", part).range(from, to),
  );
  const identity = new Map(keyOf);
  for (const p of extra) {
    identity.set(p.id, p.user_id ?? p.id);
    gpPos.set(p.id, p.position);
  }

  const picksByBallot = new Map<string, { category: string; nominee_id: string }[]>();
  for (const p of pickRows) (picksByBallot.get(p.ballot_id) ?? picksByBallot.set(p.ballot_id, []).get(p.ballot_id)!).push(p);
  const rosterByPool = new Map<string, MpRow[]>();
  for (const r of rosterRows) {
    const pool = poolOf.get(r.match_id)!;
    (rosterByPool.get(pool) ?? rosterByPool.set(pool, []).get(pool)!).push(r);
  }
  const ballotsByPool = new Map<string, typeof ballotRows>();
  for (const b of ballotRows) {
    const pool = poolOf.get(b.match_id)!;
    (ballotsByPool.get(pool) ?? ballotsByPool.set(pool, []).get(pool)!).push(b);
  }

  /** Maçtaki mevki: maç satırı, yoksa kaleci işareti, yoksa profil mevkisi (maç sayfası ve RPC'yle aynı kural) */
  const isKeeperRow = (r: MpRow) => (r.position ?? (r.is_goalkeeper ? "GK" : (gpPos.get(r.player_id) ?? ""))) === "GK";
  const FIELD_KEYS = SKILL_KEYS.slice(0, 6);
  const KEEPER_KEYS = SKILL_KEYS.slice(6);

  // 4) Her kişi için pusulaları kur ve değerleri hesapla
  const writes: { player_id: string; skills: Record<string, number | null>; voters: number; ballots: number }[] = [];
  for (const [key, rowIds] of people) {
    // Kişinin içinde olduğu havuzlar ve o havuzdaki sınıfı (kaleci/saha)
    const pools = new Map<string, boolean>(); // havuz → kaleci mi
    for (const r of own) if (rowIds.has(r.player_id)) pools.set(poolOf.get(r.match_id)!, isKeeperRow(r));

    const ballots: SkillBallot[] = [];
    for (const [pool, keeper] of pools) {
      const roster = rosterByPool.get(pool) ?? [];
      const classKeys = keeper ? KEEPER_KEYS : FIELD_KEYS;
      for (const b of ballotsByPool.get(pool) ?? []) {
        const voterKey = identity.get(b.voter_id) ?? b.voter_id;
        if (voterKey === key) continue;
        // Oy verenin seçebileceği aday sayısı: kadro, kendisi hariç, kişinin sınıfında
        const k = new Set(
          roster.filter((r) => identity.get(r.player_id) !== voterKey && isKeeperRow(r) === keeper).map((r) => identity.get(r.player_id) ?? r.player_id),
        ).size;
        const picked: Partial<Record<SkillKey, boolean>> = {};
        const candidates: Partial<Record<SkillKey, number>> = {};
        for (const c of classKeys) candidates[c] = k;
        for (const p of picksByBallot.get(b.id) ?? []) {
          if (rowIds.has(p.nominee_id) && (classKeys as string[]).includes(p.category)) picked[p.category as SkillKey] = true;
        }
        ballots.push({ voterKey, matchId: b.match_id, picked, candidates });
      }
    }

    const skills: Record<string, number | null> = {};
    for (const keeper of [false, true]) for (const s of computeSkills(ballots, keeper)) skills[s.key] = s.value;
    const voters = new Set(ballots.map((b) => b.voterKey)).size;
    const matches = new Set(ballots.map((b) => b.matchId)).size;
    for (const id of rowIds) writes.push({ player_id: id, skills, voters, ballots: matches });
  }

  for (const part of chunks(writes, 200)) {
    const { error } = await admin
      .from("player_skills")
      .upsert(part.map((w) => ({ ...w, updated_at: new Date().toISOString() })), { onConflict: "player_id" });
    if (error) throw error;
  }
}

/** Bir maç havuzundaki (iki bağlı maç dahil) tüm oyuncular: pusula sonrası hepsinin değeri değişir */
export async function recomputeSkillsForMatch(admin: SupabaseClient, matchId: string): Promise<void> {
  const { data: m } = await admin.from("matches").select("challenge_id").eq("id", matchId).maybeSingle();
  const matchIds = [matchId];
  if (m?.challenge_id) {
    const { data: linked } = await admin.from("matches").select("id").eq("challenge_id", m.challenge_id);
    for (const l of linked ?? []) if (!matchIds.includes(l.id)) matchIds.push(l.id);
  }
  const { data: roster, error } = await admin.from("match_players").select("player_id").in("match_id", matchIds);
  if (error) throw error;
  await recomputeSkills(admin, (roster ?? []).map((r) => r.player_id));
}

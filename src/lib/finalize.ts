import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONFIG,
  DEFAULT_OVERALL,
  computeRatings,
  type MatchInput,
  type MatchPlayer,
  type Team,
} from "@/lib/rating";

const PAGE = 1000;
/** `in (...)` listelerinin URL'yi şişirmemesi için parça boyutu */
const IN_CHUNK = 100;
/** Maç başına yüzlerce oy satırı olabildiğinden maç parçaları küçük tutulur */
const MATCH_CHUNK = 20;

/** Supabase tek seferde en fazla 1000 satır döndürür; hepsini sayfa sayfa çeker. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

// ---------------------------------------------------------------------------
// Yükleme: oyuncu kimliği = hesap (user_id); misafirde group_players.id
// ---------------------------------------------------------------------------

/** Rating hesabının kapsamı: belirli oyuncular (ve onların tüm maçları) veya her şey */
export type Scope = { playerIds: string[] } | { all: true };

interface Row {
  /** Oyuncunun kimlik anahtarı (hesap id'si veya misafir satır id'si) */
  key: string;
  /** Oyuncunun kendi maç satırı (bağlı maçta iki ayrı maç satırı var) */
  matchId: string;
  /** group_players.id */
  playerId: string;
}

interface Loaded {
  inputs: MatchInput[];
  /** input.id → o maçın oyuncu satırları (sonuçların hangi maç/oyuncu satırına yazılacağı) */
  rows: Map<string, Row[]>;
  /** Anahtar → kişinin tüm group_players satırları (maç oynamadığı gruplar dahil) */
  playersOfKey: Map<string, string[]>;
  /** Kapsamdaki anahtarlar: bunların rating'i ve maç sonuçları yazılır */
  affected: Set<string>;
}

type GP = { id: string; user_id: string | null };

/** Kapsamdaki kişilerin kapanmış tüm maçlarını (bağlı maçlar tek havuz olarak birleşik) motor girdisine çevirir. */
async function loadInputs(admin: SupabaseClient, scope: Scope): Promise<Loaded> {
  // 1) Kişiler ve tüm group_players satırları
  let allGp: GP[];
  const affected = new Set<string>();
  if ("all" in scope) {
    allGp = await fetchAll<GP>((from, to) =>
      admin.from("group_players").select("id, user_id").order("id").range(from, to),
    );
    for (const g of allGp) affected.add(g.user_id ?? g.id);
  } else {
    const seeds: GP[] = [];
    for (const part of chunks(scope.playerIds, IN_CHUNK)) {
      const { data, error } = await admin.from("group_players").select("id, user_id").in("id", part);
      if (error) throw error;
      seeds.push(...(data ?? []));
    }
    const userIds = [...new Set(seeds.map((g) => g.user_id).filter((u): u is string => !!u))];
    allGp = seeds.filter((g) => !g.user_id);
    for (const part of chunks(userIds, IN_CHUNK)) {
      const rows = await fetchAll<GP>((from, to) =>
        admin.from("group_players").select("id, user_id").in("user_id", part).order("id").range(from, to),
      );
      allGp.push(...rows);
    }
    for (const g of seeds) affected.add(g.user_id ?? g.id);
  }
  const keyOf = new Map(allGp.map((g) => [g.id, g.user_id ?? g.id]));
  const playersOfKey = new Map<string, string[]>();
  for (const g of allGp) {
    const key = g.user_id ?? g.id;
    playersOfKey.set(key, [...(playersOfKey.get(key) ?? []), g.id]);
  }

  // 2) Kapanmış maçlar (+ bağlı maçların eşleri)
  type M = {
    id: string;
    group_id: string;
    played_at: string;
    score_a: number | null;
    score_b: number | null;
    challenge_id: string | null;
    kind: "internal" | "external";
    groups: { kind: string } | { kind: string }[] | null;
  };
  const MATCH_COLS = "id, group_id, played_at, score_a, score_b, challenge_id, kind, groups!matches_group_id_fkey(kind)";
  let seedMatchIds: string[];
  if ("all" in scope) {
    seedMatchIds = (
      await fetchAll<{ id: string }>((from, to) =>
        admin.from("matches").select("id").eq("status", "closed").order("id").range(from, to),
      )
    ).map((m) => m.id);
  } else {
    const ids = new Set<string>();
    for (const part of chunks(allGp.map((g) => g.id), IN_CHUNK)) {
      const rows = await fetchAll<{ match_id: string }>((from, to) =>
        admin
          .from("match_players")
          .select("match_id, matches!inner(status)")
          .in("player_id", part)
          .eq("matches.status", "closed")
          .order("match_id")
          .order("player_id")
          .range(from, to),
      );
      for (const r of rows) ids.add(r.match_id);
    }
    seedMatchIds = [...ids];
  }
  const matches = new Map<string, M>();
  for (const part of chunks(seedMatchIds, IN_CHUNK)) {
    const { data, error } = await admin.from("matches").select(MATCH_COLS).in("id", part).eq("status", "closed");
    if (error) throw error;
    for (const m of (data ?? []) as M[]) matches.set(m.id, m);
  }
  const challengeIds = [...new Set([...matches.values()].map((m) => m.challenge_id).filter((c): c is string => !!c))];
  for (const part of chunks(challengeIds, IN_CHUNK)) {
    const { data, error } = await admin.from("matches").select(MATCH_COLS).in("challenge_id", part).eq("status", "closed");
    if (error) throw error;
    for (const m of (data ?? []) as M[]) matches.set(m.id, m);
  }

  // 3) Kadrolar, oylar, MVP oyları
  const matchIds = [...matches.keys()];
  type MP = {
    match_id: string;
    player_id: string;
    team: Team;
    group_players: { user_id: string | null } | { user_id: string | null }[] | null;
  };
  type V = { match_id: string; voter_id: string; target_id: string; score: number };
  type MV = { match_id: string; voter_id: string; target_id: string };
  const rosterRows: MP[] = [];
  const voteRows: V[] = [];
  const mvpRows: MV[] = [];
  for (const part of chunks(matchIds, MATCH_CHUNK)) {
    rosterRows.push(
      ...(await fetchAll<MP>((from, to) =>
        admin
          .from("match_players")
          .select("match_id, player_id, team, group_players(user_id)")
          .in("match_id", part)
          .order("match_id")
          .order("player_id")
          .range(from, to),
      )),
    );
    voteRows.push(
      ...(await fetchAll<V>((from, to) =>
        admin
          .from("votes")
          .select("match_id, voter_id, target_id, score")
          .in("match_id", part)
          .order("match_id")
          .order("voter_id")
          .order("target_id")
          .range(from, to),
      )),
    );
    mvpRows.push(
      ...(await fetchAll<MV>((from, to) =>
        admin
          .from("mvp_votes")
          .select("match_id, voter_id, target_id")
          .in("match_id", part)
          .order("match_id")
          .order("voter_id")
          .range(from, to),
      )),
    );
  }
  // Maçlarda geçen ama kapsam dışı satırların (rakip takım oyuncuları) kimlik anahtarı da gerekir
  for (const r of rosterRows) {
    if (!keyOf.has(r.player_id)) keyOf.set(r.player_id, one(r.group_players)?.user_id ?? r.player_id);
  }
  const key = (playerId: string) => keyOf.get(playerId) ?? playerId;

  // 4) Girdileri kur: bağlı iki maç tek oylama havuzu, diğerleri tek başına
  const groups = new Map<string, M[]>();
  for (const m of matches.values()) {
    const gk = m.challenge_id ? `pair:${m.challenge_id}` : m.id;
    groups.set(gk, [...(groups.get(gk) ?? []), m]);
  }
  const inputs: MatchInput[] = [];
  const rows = new Map<string, Row[]>();
  for (const [inputId, ms] of groups) {
    const sorted = [...ms].sort((a, b) => a.id.localeCompare(b.id));
    const linked = sorted.length === 2;
    const first = sorted[0];
    const matchSet = new Set(sorted.map((m) => m.id));
    const players: MatchPlayer[] = [];
    const seen = new Set<string>();
    const here: Row[] = [];
    for (const r of rosterRows) {
      if (!matchSet.has(r.match_id)) continue;
      const k = key(r.player_id);
      if (seen.has(k)) continue; // aynı kişi iki kez sayılmaz (veritabanı da engeller)
      seen.add(k);
      // Bağlı maçta ilk maçın oyuncuları A, ikincinin B; tek maçta kayıtlı takım
      const team: Team = linked ? (r.match_id === first.id ? "A" : "B") : r.team;
      players.push({ playerId: k, team, canVote: !!one(r.group_players)?.user_id });
      here.push({ key: k, matchId: r.match_id, playerId: r.player_id });
    }
    inputs.push({
      id: inputId,
      playedAt: first.played_at,
      // Bağlı maçta ilk maçın skoru: score_a = o takımın golü
      scoreA: first.score_a ?? 0,
      scoreB: first.score_b ?? 0,
      players,
      votes: voteRows
        .filter((v) => matchSet.has(v.match_id))
        .map((v) => ({ voterId: key(v.voter_id), targetId: key(v.target_id), score: v.score })),
      mvpVotes: mvpRows
        .filter((v) => matchSet.has(v.match_id))
        .map((v) => ({ voterId: key(v.voter_id), targetId: key(v.target_id) })),
      rivalShare: linked ? CONFIG.RIVAL_SHARE : undefined,
      // Takımın rakibe karşı maçı tam; grup maçı ve antrenman/iç maç yarım etki eder
      importance: sorted.every((m) => m.kind === "external" && one(m.groups)?.kind === "team") ? 1 : CONFIG.CASUAL_IMPORTANCE,
    });
    rows.set(inputId, here);
  }
  return { inputs, rows, playersOfKey, affected };
}

// ---------------------------------------------------------------------------
// Hesaplama ve yazma
// ---------------------------------------------------------------------------

/**
 * Kapsamdaki kişilerin ratinglerini ve maç sonuçlarını baştan hesaplayıp yazar.
 * Rating hesap bazlıdır: kişinin tüm grup ve takımlardaki maçları birlikte sayılır ve
 * sonuç kişinin her group_players satırına (maç oynamadığı gruplar dahil) aynen yazılır.
 * Bir kişinin rating'i sadece kendi oynadığı maçlara bağlı olduğundan kapsam o kişilerin
 * maçlarıyla sınırlanabilir; sonuç tüm veriyle hesaplamayla aynıdır.
 */
export async function recomputeRatings(admin: SupabaseClient, scope: Scope) {
  const { inputs: unsorted, rows, playersOfKey, affected } = await loadInputs(admin, scope);
  const inputs = [...unsorted].sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id));

  // Maç maç ilerle: bu maçtan önceki ve sonraki rating'ler (kronolojik)
  let before: ReturnType<typeof computeRatings>["ratings"] = new Map();
  let final = before;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const { ratings: after, matchResults } = computeRatings(inputs.slice(0, i + 1));
    const result = matchResults.find((r) => r.matchId === input.id);
    const mine = (rows.get(input.id) ?? []).filter((r) => affected.has(r.key));
    if (result && mine.length) {
      const byKey = new Map(result.players.map((p) => [p.playerId, p]));
      const upserts = mine.flatMap((r) => {
        const p = byKey.get(r.key);
        if (!p) return [];
        return [
          {
            match_id: r.matchId,
            player_id: r.playerId,
            performance: p.performance,
            match_score: p.matchScore,
            votes_received: p.votesReceived,
            weight: p.weight,
            rating_before: before.get(r.key)?.overall ?? DEFAULT_OVERALL,
            rating_after: after.get(r.key)?.overall ?? DEFAULT_OVERALL,
            is_mvp: r.key === result.mvpId,
          },
        ];
      });
      for (const part of chunks(upserts, 500)) {
        const { error } = await admin.from("match_results").upsert(part);
        if (error) throw error;
      }
    }
    before = after;
    final = after;
  }

  const now = new Date().toISOString();
  const ratingRows = [...affected].flatMap((k) => {
    const r = final.get(k);
    if (!r) return [];
    return (playersOfKey.get(k) ?? [k]).map((playerId) => ({
      player_id: playerId,
      overall: r.overall,
      raw: r.raw,
      confidence: r.confidence,
      matches_played: r.matchesPlayed,
      updated_at: now,
    }));
  });
  for (const part of chunks(ratingRows, 500)) {
    const { error } = await admin.from("player_ratings").upsert(part);
    if (error) throw error;
  }
}

/** Bir grubun oyuncularının (dolayısıyla onların tüm maçlarının) ratinglerini yeniden hesaplar. */
export async function recomputeGroup(groupId: string) {
  const admin = createAdminClient();
  const rows = await fetchAll<{ id: string }>((from, to) =>
    admin.from("group_players").select("id").eq("group_id", groupId).order("id").range(from, to),
  );
  await recomputeRatings(admin, { playerIds: rows.map((r) => r.id) });
}

/** Herkesin ratingini baştan hesaplar (formül değişince veya geçiş sırasında). */
export async function recomputeAll() {
  await recomputeRatings(createAdminClient(), { all: true });
}

/** Belirli oyuncuların (ve hesapları aynı olanların) ratinglerini yeniden hesaplar (ör. misafir hesaba aktarılınca). */
export async function recomputePlayers(playerIds: string[]) {
  if (!playerIds.length) return;
  await recomputeRatings(createAdminClient(), { playerIds });
}

// ---------------------------------------------------------------------------
// Kapanış
// ---------------------------------------------------------------------------

/**
 * Oylamayı kapatır, maç sonuçlarını ve oyuncuların ratinglerini yeniden hesaplar.
 * Takımlar arası (bağlı) maçta iki maç birlikte kapanır; oylar tek havuzda hesaplanır.
 * Aynı anda iki istek gelirse sadece biri hesaplar. true: bu çağrı kapattı.
 */
export async function finalizeMatch(matchId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: row, error: rowError } = await admin
    .from("matches")
    .select("id, challenge_id")
    .eq("id", matchId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row) return false;

  const claim = admin.from("matches").update({ status: "closed" }).eq("status", "voting");
  const { data: claimed, error: claimError } = await (row.challenge_id
    ? claim.eq("challenge_id", row.challenge_id)
    : claim.eq("id", matchId)
  ).select("id, group_id");
  if (claimError) throw claimError;
  if (!claimed?.length) return false;

  const ids = claimed.map((m) => m.id);
  try {
    const players = await fetchAll<{ player_id: string }>((from, to) =>
      admin
        .from("match_players")
        .select("player_id")
        .in("match_id", ids)
        .order("match_id")
        .order("player_id")
        .range(from, to),
    );
    await recomputeRatings(admin, { playerIds: players.map((p) => p.player_id) });
    await announceResults(admin, claimed);
    return true;
  } catch (e) {
    await admin.from("matches").update({ status: "voting" }).in("id", ids);
    throw e;
  }
}

/** Süresi dolmuş oylamaları kapatır (sayfa açıldığında tetiklenir, cron gerektirmez). */
export async function finalizeExpired(groupId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("matches")
    .select("id")
    .eq("group_id", groupId)
    .eq("status", "voting")
    .lt("voting_deadline", new Date().toISOString());
  for (const m of data ?? []) await finalizeMatch(m.id);
}

/** Sohbete "sonuçlar açıklandı" kartı: maçın adamıyla birlikte (bağlı maçta rakip takımınsa takım adıyla) */
async function announceResults(admin: SupabaseClient, claimed: { id: string; group_id: string }[]) {
  const { data: mvp } = await admin
    .from("match_results")
    .select("group_players(display_name, group_id, groups(name))")
    .in("match_id", claimed.map((m) => m.id))
    .eq("is_mvp", true)
    .limit(1)
    .maybeSingle();
  type GPm = { display_name: string; group_id: string; groups: { name: string } | { name: string }[] | null };
  const gp = one(mvp?.group_players as GPm | GPm[] | null | undefined);
  for (const m of claimed) {
    const teamName = gp && gp.group_id !== m.group_id ? one(gp.groups)?.name : null;
    const who = gp ? `${gp.display_name}${teamName ? ` (${teamName})` : ""}` : null;
    await admin.from("group_messages").insert({
      group_id: m.group_id,
      kind: "system",
      body: who ? `🏆 Sonuçlar açıklandı! Maçın adamı: ${who} ⭐` : "🏆 Maç sonuçları açıklandı!",
      match_id: m.id,
    });
  }
}

/**
 * Halısaha puanlama motoru.
 *
 * Akış:
 * 1. Normalizasyon: Her oy, oyu verenin o maçtaki ortalamasına ve dağılımına
 *    göre "göreli puana" (z) çevrilir. Herkese 9 veren de, herkese 5 veren de
 *    aynı etkiye sahip olur; herkese aynı puanı veren trolün etkisi sıfırdır.
 * 2. İkili tespiti: Geçmiş maçlarda birbirine diğerlerinden sürekli belirgin
 *    yüksek puan veren ikililerin karşılıklı oylarının ağırlığı düşürülür.
 * 3. Maç performansı: Alınan göreli puanların uç değerleri (en yüksek ve en
 *    düşük) atılarak ağırlıklı ortalaması alınır, üstüne küçük bir galibiyet
 *    bonusu eklenir.
 * 4. Genel rating: Yakın maçların daha ağır bastığı, az oy alan maçların etkisi
 *    düşük tutulan ve yeni oyuncuları grup ortalamasına yakın başlatan
 *    ağırlıklı ortalama. Sonuç FIFA tarzı 40-99 ölçeğine çevrilir.
 */

export type Team = "A" | "B";

export interface MatchPlayer {
  playerId: string;
  team: Team;
  /** Oy verebilir mi? Misafirler (hesabı olmayanlar) oy veremez. Varsayılan: evet */
  canVote?: boolean;
}

export interface Vote {
  voterId: string;
  targetId: string;
  /** 1-10 arası tam sayı */
  score: number;
}

export interface MvpVote {
  voterId: string;
  targetId: string;
}

export interface MatchInput {
  id: string;
  /** Maçların kronolojik sıralaması için ISO tarih */
  playedAt: string;
  players: MatchPlayer[];
  scoreA: number;
  scoreB: number;
  votes: Vote[];
  mvpVotes?: MvpVote[];
}

export interface PlayerMatchResult {
  playerId: string;
  /** Göreli performans (0 = maç ortalaması) */
  performance: number;
  /** Kullanıcıya gösterilen maç puanı, 1-10 */
  matchScore: number;
  votesReceived: number;
  /** Bu maçın rating'e etki ağırlığı, 0-1 */
  weight: number;
  outcome: "win" | "draw" | "loss";
}

export interface MatchResult {
  matchId: string;
  players: PlayerMatchResult[];
  mvpId: string | null;
}

export interface PlayerRating {
  playerId: string;
  /** FIFA tarzı genel puan, 40-99 */
  overall: number;
  /** Ham göreli rating */
  raw: number;
  matchesPlayed: number;
  /** Rating'e ne kadar güvenebileceğimiz, 0-1 */
  confidence: number;
}

export const CONFIG = {
  /** Oy verenin dağılımı için alt sınır; çok dar aralıkta oy verenlerin farkları abartılmasın */
  MIN_VOTER_STD: 1.0,
  /** Bir oy verenin oylarının sayılması için en az kaç kişiyi puanlamış olması gerekir */
  MIN_VOTES_PER_VOTER: 3,
  /** Bu sayı ve üstünde oy alan oyuncunun en yüksek ve en düşük oyu atılır */
  TRIM_THRESHOLD: 5,
  /** Oyuncuya oy verebilecek kişilerin (misafirler hariç) en az bu oranı oy verdiyse katılım tam sayılır */
  FULL_WEIGHT_PARTICIPATION: 0.5,
  /** Bu kadar ve üstü oy alan oyuncunun maçı tam güvenle sayılır; altında orantılı azalır */
  FULL_TRUST_VOTES: 4,
  /** Bundan az oy alan oyuncunun maçı rating'e hiç sayılmaz */
  MIN_VOTES_RECEIVED: 2,
  /** Galibiyet/mağlubiyet etkisi (göreli puan cinsinden) */
  RESULT_BONUS: 0.15,
  /** Her eski maçın ağırlığı bir öncekinin bu katı */
  RECENCY_DECAY: 0.85,
  /** Yeni oyuncuyu ortalamaya çeken "sanal maç" sayısı */
  PRIOR_WEIGHT: 2,
  /** İkili tespiti: aynı yönde en az kaç maç */
  COLLUSION_MIN_MATCHES: 3,
  /** İkili tespiti: diğerlerine göre ortalama ne kadar fazla puan */
  COLLUSION_EXCESS: 1.0,
  /** Şüpheli ikililerin karşılıklı oy ağırlığı */
  COLLUSION_WEIGHT: 0.3,
  /** FIFA ölçeği: ortalama oyuncu */
  OVR_BASE: 65,
  /** FIFA ölçeği: 1 birim göreli puan kaç OVR eder */
  OVR_SCALE: 12,
} as const;

interface NormalizedVote {
  voterId: string;
  targetId: string;
  z: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/** Geçersiz oyları (kendine oy, maçta olmayan oyuncu, aralık dışı puan, tekrar) ayıklar. */
export function validVotes(match: MatchInput): Vote[] {
  const inMatch = new Set(match.players.map((p) => p.playerId));
  const seen = new Set<string>();
  return match.votes.filter((v) => {
    const key = `${v.voterId}>${v.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return (
      v.voterId !== v.targetId &&
      inMatch.has(v.voterId) &&
      inMatch.has(v.targetId) &&
      Number.isInteger(v.score) &&
      v.score >= 1 &&
      v.score <= 10
    );
  });
}

/** 1. adım: her oyu, oyu verenin kendi ölçeğine göre göreli puana çevirir. */
export function normalizeVotes(match: MatchInput): NormalizedVote[] {
  const byVoter = new Map<string, Vote[]>();
  for (const v of validVotes(match)) {
    const list = byVoter.get(v.voterId) ?? [];
    list.push(v);
    byVoter.set(v.voterId, list);
  }

  const result: NormalizedVote[] = [];
  for (const [voterId, votes] of byVoter) {
    if (votes.length < CONFIG.MIN_VOTES_PER_VOTER) continue;
    const scores = votes.map((v) => v.score);
    const m = mean(scores);
    const s = Math.max(std(scores), CONFIG.MIN_VOTER_STD);
    for (const v of votes) {
      result.push({ voterId, targetId: v.targetId, z: (v.score - m) / s });
    }
  }
  return result;
}

const pairKey = (a: string, b: string) => `${a}>${b}`;

/**
 * 2. adım: Birbirine sürekli, diğerlerinin verdiğinden belirgin yüksek puan
 * veren ikilileri bulur. Dönen kümede her iki yön de bulunur ("a>b" ve "b>a").
 */
export function detectCollusion(matches: MatchInput[]): Set<string> {
  // excess[a>b] = a'nın b'ye verdiği göreli puan - b'nin o maçta diğerlerinden aldığı ortalama
  const excess = new Map<string, number[]>();

  for (const match of matches) {
    const votes = normalizeVotes(match);
    const byTarget = new Map<string, NormalizedVote[]>();
    for (const v of votes) {
      const list = byTarget.get(v.targetId) ?? [];
      list.push(v);
      byTarget.set(v.targetId, list);
    }
    for (const [, received] of byTarget) {
      if (received.length < 3) continue;
      for (const v of received) {
        const others = received.filter((o) => o.voterId !== v.voterId);
        const diff = v.z - mean(others.map((o) => o.z));
        const key = pairKey(v.voterId, v.targetId);
        const list = excess.get(key) ?? [];
        list.push(diff);
        excess.set(key, list);
      }
    }
  }

  const suspicious = new Set<string>();
  for (const [key, diffs] of excess) {
    const [a, b] = key.split(">");
    const reverse = excess.get(pairKey(b, a));
    if (!reverse) continue;
    const ok = (d: number[]) =>
      d.length >= CONFIG.COLLUSION_MIN_MATCHES &&
      mean(d) >= CONFIG.COLLUSION_EXCESS;
    if (ok(diffs) && ok(reverse)) {
      suspicious.add(key);
      suspicious.add(pairKey(b, a));
    }
  }
  return suspicious;
}

function outcomeFor(team: Team, scoreA: number, scoreB: number) {
  if (scoreA === scoreB) return "draw" as const;
  const won = team === "A" ? scoreA > scoreB : scoreB > scoreA;
  return won ? ("win" as const) : ("loss" as const);
}

/** Uç değerleri atarak ağırlıklı ortalama alır. */
function trimmedWeightedMean(items: { z: number; w: number }[]): number {
  const sorted = [...items].sort((a, b) => a.z - b.z);
  const kept =
    sorted.length >= CONFIG.TRIM_THRESHOLD ? sorted.slice(1, -1) : sorted;
  const totalW = kept.reduce((a, b) => a + b.w, 0);
  if (totalW === 0) return 0;
  return kept.reduce((a, b) => a + b.z * b.w, 0) / totalW;
}

/** MVP: en çok oyu alan; eşitlikte maç performansı yüksek olan. */
function pickMvp(
  match: MatchInput,
  players: PlayerMatchResult[],
): string | null {
  const inMatch = new Set(match.players.map((p) => p.playerId));
  const seenVoters = new Set<string>();
  const counts = new Map<string, number>();
  for (const v of match.mvpVotes ?? []) {
    if (seenVoters.has(v.voterId)) continue;
    if (v.voterId === v.targetId) continue;
    if (!inMatch.has(v.voterId) || !inMatch.has(v.targetId)) continue;
    seenVoters.add(v.voterId);
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const perf = new Map(players.map((p) => [p.playerId, p.performance]));
  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] || (perf.get(b[0]) ?? 0) - (perf.get(a[0]) ?? 0),
  )[0][0];
}

/** 3. adım: tek bir maçın oyuncu bazında sonuçları. */
export function computeMatch(
  match: MatchInput,
  suspiciousPairs: Set<string> = new Set(),
): MatchResult {
  const votes = normalizeVotes(match);
  const voters = match.players.filter((p) => p.canVote !== false).map((p) => p.playerId);

  const players: PlayerMatchResult[] = match.players.map((p) => {
    const received = votes
      .filter((v) => v.targetId === p.playerId)
      .map((v) => ({
        z: v.z,
        w: suspiciousPairs.has(pairKey(v.voterId, v.targetId))
          ? CONFIG.COLLUSION_WEIGHT
          : 1,
      }));

    const outcome = outcomeFor(p.team, match.scoreA, match.scoreB);
    const bonus =
      outcome === "win"
        ? CONFIG.RESULT_BONUS
        : outcome === "loss"
          ? -CONFIG.RESULT_BONUS
          : 0;

    const performance =
      received.length > 0 ? trimmedWeightedMean(received) + bonus : bonus;

    // Bu oyuncuya oy verebilecek kişi sayısı: oy hakkı olanlar, kendisi hariç.
    // Sabit bir eşik kullanmıyoruz; yoksa misafirli küçük maçlarda hesabı olanlar
    // hiçbir zaman yeterli oya ulaşamaz.
    const possibleVoters = voters.filter((id) => id !== p.playerId).length;
    const participation =
      possibleVoters > 0 ? received.length / possibleVoters : 0;
    const weight =
      received.length < CONFIG.MIN_VOTES_RECEIVED
        ? 0
        : Math.min(1, participation / CONFIG.FULL_WEIGHT_PARTICIPATION) *
          Math.min(1, received.length / CONFIG.FULL_TRUST_VOTES);

    return {
      playerId: p.playerId,
      performance,
      matchScore: Math.round(clamp(6.5 + 1.5 * performance, 1, 10) * 10) / 10,
      votesReceived: received.length,
      weight,
      outcome,
    };
  });

  return { matchId: match.id, players, mvpId: pickMvp(match, players) };
}

export function toOverall(raw: number): number {
  return Math.round(clamp(CONFIG.OVR_BASE + CONFIG.OVR_SCALE * raw, 40, 99));
}

/** 4. adım: bir grubun tüm maçlarından oyuncu ratingleri. */
export function computeRatings(matches: MatchInput[]): {
  ratings: Map<string, PlayerRating>;
  matchResults: MatchResult[];
} {
  const ordered = [...matches].sort((a, b) =>
    a.playedAt.localeCompare(b.playedAt),
  );
  const suspicious = detectCollusion(ordered);
  const matchResults = ordered.map((m) => computeMatch(m, suspicious));

  const history = new Map<string, PlayerMatchResult[]>();
  for (const mr of matchResults) {
    for (const p of mr.players) {
      const list = history.get(p.playerId) ?? [];
      list.push(p);
      history.set(p.playerId, list);
    }
  }

  const ratings = new Map<string, PlayerRating>();
  for (const [playerId, results] of history) {
    let sumW = 0;
    let sumWP = 0;
    // En yeni maçtan geriye doğru
    results
      .slice()
      .reverse()
      .forEach((r, i) => {
        const w = r.weight * CONFIG.RECENCY_DECAY ** i;
        sumW += w;
        sumWP += w * r.performance;
      });
    const raw = sumWP / (CONFIG.PRIOR_WEIGHT + sumW);
    ratings.set(playerId, {
      playerId,
      raw,
      overall: toOverall(raw),
      matchesPlayed: results.length,
      confidence: sumW / (CONFIG.PRIOR_WEIGHT + sumW),
    });
  }

  return { ratings, matchResults };
}

/** Hiç maçı olmayan oyuncu için başlangıç rating'i (grup ortalaması). */
export const DEFAULT_OVERALL = CONFIG.OVR_BASE;

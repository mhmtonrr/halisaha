/**
 * Dengeli takım kurma.
 *
 * Kişi sayısı serbesttir (5'e 5, 8'e 8, 7'ye 8...). 24 kişiye kadar tüm olası
 * bölünmeler denenir ve en dengeli olanlar bulunur. Daha kalabalık kadrolarda
 * açgözlü dağıtım + takas iyileştirmesi kullanılır.
 *
 * Kurallar:
 * - Takımlar arası kişi farkı en fazla 1.
 * - Kaleciler iki takıma eşit dağıtılır (fark en fazla 1).
 * - Bir kişi eksik olan takımın oyuncu başı ortalaması EXTRA_PLAYER_BONUS
 *   kadar yüksek olmalı, çünkü fazladan bir oyuncu avantajdır.
 */

export interface TeamCandidate {
  id: string;
  name?: string;
  /** FIFA tarzı genel puan */
  overall: number;
  isGoalkeeper?: boolean;
}

export interface TeamSplit {
  teamA: TeamCandidate[];
  teamB: TeamCandidate[];
  /** Takımların "güç" farkı; 0 mükemmel denge */
  difference: number;
  averageA: number;
  averageB: number;
}

/** Fazladan bir oyuncunun kaç OVR ortalamaya bedel sayıldığı */
export const EXTRA_PLAYER_BONUS = 3;
const EXHAUSTIVE_LIMIT = 24;

const avg = (team: TeamCandidate[]) =>
  team.length === 0 ? 0 : team.reduce((a, p) => a + p.overall, 0) / team.length;

function strength(team: TeamCandidate[], otherSize: number): number {
  return avg(team) + EXTRA_PLAYER_BONUS * (team.length - otherSize) / 2;
}

function evaluate(teamA: TeamCandidate[], teamB: TeamCandidate[]): TeamSplit {
  const difference = Math.abs(
    strength(teamA, teamB.length) - strength(teamB, teamA.length),
  );
  return {
    teamA,
    teamB,
    difference: Math.round(difference * 100) / 100,
    averageA: Math.round(avg(teamA) * 10) / 10,
    averageB: Math.round(avg(teamB) * 10) / 10,
  };
}

function goalkeepersOk(teamA: TeamCandidate[], teamB: TeamCandidate[]) {
  const gk = (t: TeamCandidate[]) => t.filter((p) => p.isGoalkeeper).length;
  return Math.abs(gk(teamA) - gk(teamB)) <= 1;
}

/** Tüm bölünmeleri dener; en iyi `keep` tanesini döndürür. */
function exhaustive(players: TeamCandidate[], keep: number): TeamSplit[] {
  const n = players.length;
  const sizeA = Math.floor(n / 2);
  const best: TeamSplit[] = [];
  const even = n % 2 === 0;

  const consider = (mask: boolean[]) => {
    const teamA: TeamCandidate[] = [];
    const teamB: TeamCandidate[] = [];
    players.forEach((p, i) => (mask[i] ? teamA : teamB).push(p));
    if (!goalkeepersOk(teamA, teamB)) return;
    const split = evaluate(teamA, teamB);
    if (best.length < keep || split.difference < best[best.length - 1].difference) {
      best.push(split);
      best.sort((a, b) => a.difference - b.difference);
      if (best.length > keep) best.pop();
    }
  };

  const mask = new Array<boolean>(n).fill(false);
  // Çift sayıda ayna bölünmeleri tekrar saymamak için ilk oyuncu hep A'da
  const start = even ? 1 : 0;
  if (even) mask[0] = true;
  const need = even ? sizeA - 1 : sizeA;

  const recurse = (from: number, remaining: number) => {
    if (remaining === 0) {
      consider(mask);
      return;
    }
    for (let i = from; i <= n - remaining; i++) {
      mask[i] = true;
      recurse(i + 1, remaining - 1);
      mask[i] = false;
    }
  };
  recurse(start, need);
  return best;
}

/** Kalabalık kadrolar için: yılan dağıtımı + iyileştiren takaslar. */
function heuristic(players: TeamCandidate[]): TeamSplit[] {
  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const gks = sorted.filter((p) => p.isGoalkeeper);
  const field = sorted.filter((p) => !p.isGoalkeeper);
  const teamA: TeamCandidate[] = [];
  const teamB: TeamCandidate[] = [];
  gks.forEach((p, i) => (i % 2 === 0 ? teamA : teamB).push(p));
  field.forEach((p, i) => {
    const target =
      teamA.length < teamB.length
        ? teamA
        : teamB.length < teamA.length
          ? teamB
          : i % 4 === 0 || i % 4 === 3
            ? teamA
            : teamB;
    target.push(p);
  });

  let current = evaluate(teamA, teamB);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.teamA.length; i++) {
      for (let j = 0; j < current.teamB.length; j++) {
        const a = [...current.teamA];
        const b = [...current.teamB];
        [a[i], b[j]] = [b[j], a[i]];
        if (!goalkeepersOk(a, b)) continue;
        const next = evaluate(a, b);
        if (next.difference < current.difference - 1e-9) {
          current = next;
          improved = true;
        }
      }
    }
  }
  return [current];
}

/**
 * En dengeli bölünmeleri, iyiden kötüye sıralı döndürür.
 * Arayüz ilkini önerir; "yeniden karıştır" ile `pickVariant` kullanılabilir.
 */
export function balanceTeams(
  players: TeamCandidate[],
  keep = 10,
): TeamSplit[] {
  if (players.length < 2) {
    return [evaluate([...players], [])];
  }
  return players.length <= EXHAUSTIVE_LIMIT
    ? exhaustive(players, keep)
    : heuristic(players);
}

/**
 * Her hafta aynı takımlar çıkmasın diye en iyiye yakın (fark toleransı
 * içinde) bölünmelerden rastgele birini seçer.
 */
export function pickVariant(
  splits: TeamSplit[],
  tolerance = 1,
  random: () => number = Math.random,
): TeamSplit {
  const best = splits[0].difference;
  const pool = splits.filter((s) => s.difference <= best + tolerance);
  return pool[Math.floor(random() * pool.length)];
}

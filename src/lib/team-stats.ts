// Takım istatistikleri: rakibe karşı karne, form, seri, rakip bazlı geçmiş, oyuncu liderleri.
// Saf fonksiyonlar (veritabanı yok) — src/lib/team-stats.test.ts ile test edilir.

export interface StatMatch {
  id: string;
  playedAt: string;
  /** Rakibe karşı maç (kendi içinde maçlar karneye girmez) */
  external: boolean;
  /** Skor açıklanmış mı (oylama veya kapanmış) */
  finished: boolean;
  /** score_a: bizim golümüz, score_b: rakibin */
  scoreFor: number;
  scoreAgainst: number;
  opponentGroupId: string | null;
  opponentName: string | null;
}

export type Outcome = "W" | "D" | "L";

export interface TeamRecord {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  /** 0-100 */
  winRate: number;
  /** 3-1-0 sistemi */
  points: number;
}

export const outcomeOf = (m: Pick<StatMatch, "scoreFor" | "scoreAgainst">): Outcome =>
  m.scoreFor > m.scoreAgainst ? "W" : m.scoreFor < m.scoreAgainst ? "L" : "D";

const emptyRecord = (): TeamRecord => ({
  played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0, winRate: 0, points: 0,
});

export function recordOf(matches: StatMatch[]): TeamRecord {
  const r = emptyRecord();
  for (const m of matches) {
    r.played++;
    r.goalsFor += m.scoreFor;
    r.goalsAgainst += m.scoreAgainst;
    if (m.scoreAgainst === 0) r.cleanSheets++;
    const o = outcomeOf(m);
    if (o === "W") r.won++;
    else if (o === "D") r.drawn++;
    else r.lost++;
  }
  r.winRate = r.played ? Math.round((r.won / r.played) * 100) : 0;
  r.points = r.won * 3 + r.drawn;
  return r;
}

/** Bitmiş rakip maçları, eskiden yeniye */
export function competitive(matches: StatMatch[]): StatMatch[] {
  return matches
    .filter((m) => m.external && m.finished)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id));
}

/** Son n maçın sonucu, en yeni solda */
export function form(matches: StatMatch[], n = 5): Outcome[] {
  return competitive(matches).slice(-n).reverse().map(outcomeOf);
}

/** Güncel seri: son maçlardan geriye doğru aynı sonuç kaç kez (ör. 3 galibiyet) */
export function streak(matches: StatMatch[]): { outcome: Outcome; length: number } | null {
  const results = form(matches, Infinity);
  if (!results.length) return null;
  const outcome = results[0];
  let length = 0;
  for (const r of results) {
    if (r !== outcome) break;
    length++;
  }
  return { outcome, length };
}

/** En büyük galibiyet ve en ağır mağlubiyet (averaj farkına göre) */
export function extremes(matches: StatMatch[]): { biggestWin: StatMatch | null; biggestLoss: StatMatch | null } {
  let biggestWin: StatMatch | null = null;
  let biggestLoss: StatMatch | null = null;
  for (const m of competitive(matches)) {
    const diff = m.scoreFor - m.scoreAgainst;
    if (diff > 0 && (!biggestWin || diff > biggestWin.scoreFor - biggestWin.scoreAgainst)) biggestWin = m;
    if (diff < 0 && (!biggestLoss || diff < biggestLoss.scoreFor - biggestLoss.scoreAgainst)) biggestLoss = m;
  }
  return { biggestWin, biggestLoss };
}

export interface HeadToHead extends TeamRecord {
  /** Takım hesabı varsa id'si; yoksa (elle yazılmış rakip) null */
  opponentGroupId: string | null;
  opponentName: string;
  lastPlayedAt: string;
}

/** Rakip bazında karne; çok oynanan önce. Takımı olan rakipler id'ye, olmayanlar ada göre birleşir. */
export function headToHead(matches: StatMatch[]): HeadToHead[] {
  const groups = new Map<string, StatMatch[]>();
  for (const m of competitive(matches)) {
    const key = m.opponentGroupId ?? `ad:${(m.opponentName ?? "Rakip").trim().toLocaleLowerCase("tr")}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()]
    .map((ms) => {
      const last = ms[ms.length - 1];
      return {
        ...recordOf(ms),
        opponentGroupId: last.opponentGroupId,
        opponentName: (last.opponentName ?? "").trim() || "Rakip",
        lastPlayedAt: last.playedAt,
      };
    })
    .sort((a, b) => b.played - a.played || b.lastPlayedAt.localeCompare(a.lastPlayedAt));
}

// ---------------------------------------------------------------------------
// Oyuncu liderleri
// ---------------------------------------------------------------------------

export interface PlayerStatRow {
  playerId: string;
  name: string;
  played: number;
  goals: number;
  assists: number;
  saves: number;
  mvps: number;
  overall: number;
}

export type LeaderKey = "goals" | "assists" | "saves" | "mvps";

/** Anahtara göre ilk n oyuncu (0 olanlar listeye girmez); eşitlikte az maçta yapan öne geçer. */
export function leaders(rows: PlayerStatRow[], key: LeaderKey, n = 5): PlayerStatRow[] {
  return rows
    .filter((r) => r[key] > 0)
    .sort(
      (a, b) =>
        b[key] - a[key] ||
        a.played - b.played ||
        b.overall - a.overall ||
        a.name.localeCompare(b.name, "tr"),
    )
    .slice(0, n);
}

/** Oyuncu başına maç başı ortalama (gol/asist verimi) */
export const perMatch = (value: number, played: number) => (played ? Math.round((value / played) * 100) / 100 : 0);

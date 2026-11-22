/**
 * Oyuncu profilindeki istatistikler: bir kişinin TÜM grup ve takımlardaki maç kayıtlarından özetler.
 * Saf fonksiyonlar (profile-stats.test.ts). Kayıtlar `profile-data.ts`'den gelir.
 */
import { totals, type MatchRecord, type PlayerTotals } from "./attributes";

export type Outcome = MatchRecord["outcome"];

export interface ProfileMatch extends MatchRecord {
  groupId: string;
  groupName: string;
  groupKind: "community" | "team";
  scoreUs: number;
  scoreThem: number;
  /** Maçın oynandığı saha/tesis (girilmediyse null) */
  venue?: string | null;
  /** voting: sonuç girildi, oylama sürüyor; closed: puanlar açıklandı */
  status: "voting" | "closed";
}

export interface Split {
  played: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface GroupBreakdown extends Split {
  groupId: string;
  name: string;
  kind: "community" | "team";
  goals: number;
  assists: number;
}

export interface ProfileStats {
  totals: PlayerTotals;
  /** 0-100 tam sayı; maç yoksa null */
  winRate: number | null;
  /** Puanlanmış maçların ortalaması (1-10); yoksa null */
  avgScore: number | null;
  goalsPerMatch: number | null;
  assistsPerMatch: number | null;
  /** Son 5 maç, en yeni başta */
  form: Outcome[];
  /** Şu anki galibiyet serisi ve yenilmezlik serisi (en yeni maçtan geriye) */
  streak: { wins: number; unbeaten: number };
  /** Son 10 puanlı maç, eskiden yeniye (grafik için) */
  recentScores: { matchId: string; playedAt: string; score: number }[];
  external: Split;
  internal: Split;
  byGroup: GroupBreakdown[];
  byPosition: { position: string; count: number }[];
  /** En yüksek maç puanı alınan maç */
  best: ProfileMatch | null;
  mvpRate: number | null;
}

const emptySplit = (): Split => ({ played: 0, wins: 0, draws: 0, losses: 0 });
const add = (s: Split, o: Outcome) => {
  s.played++;
  if (o === "win") s.wins++;
  else if (o === "draw") s.draws++;
  else s.losses++;
};
const rated = (m: ProfileMatch) => m.matchScore !== null && m.weight > 0;

export function computeProfileStats(matches: ProfileMatch[]): ProfileStats {
  const sorted = [...matches].sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  const t = totals(sorted);
  const n = sorted.length;

  const scored = sorted.filter(rated);
  const avgScore = scored.length ? scored.reduce((s, m) => s + m.matchScore!, 0) / scored.length : null;

  let wins = 0;
  for (const m of sorted) {
    if (m.outcome !== "win") break;
    wins++;
  }
  let unbeaten = 0;
  for (const m of sorted) {
    if (m.outcome === "loss") break;
    unbeaten++;
  }

  const external = emptySplit();
  const internal = emptySplit();
  const groups = new Map<string, GroupBreakdown>();
  const positions = new Map<string, number>();
  for (const m of sorted) {
    add(m.kind === "external" ? external : internal, m.outcome);
    const g =
      groups.get(m.groupId) ??
      groups
        .set(m.groupId, { ...emptySplit(), groupId: m.groupId, name: m.groupName, kind: m.groupKind, goals: 0, assists: 0 })
        .get(m.groupId)!;
    add(g, m.outcome);
    g.goals += m.goals;
    g.assists += m.assists;
    if (m.position) positions.set(m.position, (positions.get(m.position) ?? 0) + 1);
  }

  const best = scored.reduce<ProfileMatch | null>((b, m) => (!b || m.matchScore! > b.matchScore! ? m : b), null);

  return {
    totals: t,
    winRate: n ? Math.round((t.wins / n) * 100) : null,
    avgScore,
    goalsPerMatch: n ? t.goals / n : null,
    assistsPerMatch: n ? t.assists / n : null,
    form: sorted.slice(0, 5).map((m) => m.outcome),
    streak: { wins, unbeaten },
    recentScores: scored
      .slice(0, 10)
      .reverse()
      .map((m) => ({ matchId: m.matchId, playedAt: m.playedAt, score: m.matchScore! })),
    external,
    internal,
    byGroup: [...groups.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name, "tr")),
    byPosition: [...positions.entries()].map(([position, count]) => ({ position, count })).sort((a, b) => b.count - a.count),
    best,
    mvpRate: n ? Math.round((t.mvps / n) * 100) : null,
  };
}

/** Serinin kullanıcıya gösterilecek metni; anlamlı seri yoksa null */
export function streakText(s: { wins: number; unbeaten: number }): string | null {
  if (s.wins >= 2) return `${s.wins} maçtır üst üste kazanıyor`;
  if (s.unbeaten >= 3) return `${s.unbeaten} maçtır yenilmiyor`;
  return null;
}

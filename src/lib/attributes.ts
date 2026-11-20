/**
 * Oyuncu kartındaki 6 özellik. Hepsi gerçek maç verisinden hesaplanır, 40-99 ölçeğindedir.
 * 40 "hiç yok" seviyesidir; böylece kartlar FIFA'daki gibi okunur.
 */

export interface MatchRecord {
  matchId: string;
  playedAt: string;
  goals: number;
  assists: number;
  saves: number;
  outcome: "win" | "draw" | "loss";
  /** Oylamadan gelen maç puanı (1-10); maç puanlanmadıysa null */
  matchScore: number | null;
  /** Maçın rating'e etkisi; 0 ise yeterli oy alınmamış */
  weight: number;
  mvp: boolean;
  kind: "internal" | "external";
  opponentName: string | null;
  position: string | null;
}

export type AttributeKey = "FRM" | "IST" | "GOL" | "KRT" | "AST" | "GAL" | "MVP";

export interface Attribute {
  key: AttributeKey;
  label: string;
  value: number | null;
  hint: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** 0'dan sonsuza giden bir oranı 40-99 aralığına doygunlaşarak taşır */
const saturate = (x: number, scale: number) => Math.round(40 + 59 * (1 - Math.exp(-x / scale)));

/** Puanlanmış maçlar, en yeniden eskiye */
function rated(records: MatchRecord[]) {
  return records
    .filter((r) => r.matchScore !== null && r.weight > 0)
    .sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}

export function computeAttributes(records: MatchRecord[], isGoalkeeper: boolean): Attribute[] {
  const n = records.length;
  const scores = rated(records).map((r) => r.matchScore!);
  const last5 = scores.slice(0, 5);
  const per = (f: (r: MatchRecord) => number) => (n ? records.reduce((s, r) => s + f(r), 0) / n : 0);

  const form = last5.length ? clamp(Math.round(mean(last5) * 10), 10, 99) : null;

  let consistency: number | null = null;
  if (scores.length >= 3) {
    const m = mean(scores);
    const sd = Math.sqrt(mean(scores.map((s) => (s - m) ** 2)));
    consistency = clamp(Math.round(97 - 22 * sd), 40, 99);
  }

  const wins = records.filter((r) => r.outcome === "win").length;
  const mvps = records.filter((r) => r.mvp).length;

  const scoring: Attribute = isGoalkeeper
    ? { key: "KRT", label: "Kurtarış", value: n ? saturate(per((r) => r.saves), 4) : null, hint: `Maç başına ${per((r) => r.saves).toFixed(1)} kurtarış` }
    : { key: "GOL", label: "Gol", value: n ? saturate(per((r) => r.goals), 2) : null, hint: `Maç başına ${per((r) => r.goals).toFixed(1)} gol` };

  return [
    { key: "FRM", label: "Form", value: form, hint: last5.length ? `Son ${last5.length} maçın puan ortalaması` : "Henüz puanlanmış maç yok" },
    { key: "IST", label: "İstikrar", value: consistency, hint: consistency === null ? "En az 3 puanlı maç gerekir" : "Maç puanları ne kadar dengeli" },
    scoring,
    { key: "AST", label: "Asist", value: n ? saturate(per((r) => r.assists), 1.5) : null, hint: `Maç başına ${per((r) => r.assists).toFixed(1)} asist` },
    { key: "GAL", label: "Galibiyet", value: n ? Math.round(40 + 59 * (wins / n)) : null, hint: n ? `%${Math.round((wins / n) * 100)} galibiyet` : "Henüz maç yok" },
    { key: "MVP", label: "Liderlik", value: n ? Math.round(40 + 59 * Math.min(1, (mvps / n) * 2.5)) : null, hint: `${mvps} kez maçın adamı` },
  ];
}

export interface PlayerTotals {
  played: number;
  goals: number;
  assists: number;
  saves: number;
  mvps: number;
  wins: number;
  draws: number;
  losses: number;
}

export function totals(records: MatchRecord[]): PlayerTotals {
  return {
    played: records.length,
    goals: records.reduce((s, r) => s + r.goals, 0),
    assists: records.reduce((s, r) => s + r.assists, 0),
    saves: records.reduce((s, r) => s + r.saves, 0),
    mvps: records.filter((r) => r.mvp).length,
    wins: records.filter((r) => r.outcome === "win").length,
    draws: records.filter((r) => r.outcome === "draw").length,
    losses: records.filter((r) => r.outcome === "loss").length,
  };
}

/** Son 5 maçın puan ortalaması (sıralama için); yoksa null */
export function recentForm(records: MatchRecord[]): number | null {
  const last5 = rated(records).slice(0, 5).map((r) => r.matchScore!);
  return last5.length ? mean(last5) : null;
}

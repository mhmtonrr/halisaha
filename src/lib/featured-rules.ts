/**
 * Öne çıkanların bölge adı, takım formu ve oyuncu sırası (saf, testli).
 * Kullanıcı kararı (2026-11-24): her kademe sadece kendi bölgesini gösterir; kayıt azsa üst kademeye geçilmez.
 */

/** Bu kadar puanlı maçı olan önde sıralanır (tek maçlık yıldız öne geçmesin) */
export const FEATURED_MIN_MATCHES = 3;

/**
 * Öne çıkan oyuncu sırası: önce en az FEATURED_MIN_MATCHES maçlılar, sonra puanlı maçı olanlar, en sonda henüz maçı
 * olmayan kayıtlı oyuncular; her grupta rating, eşitlikte maç sayısı. Bölgede az puanlı oyuncu varsa da bölge boş kalmasın.
 */
export function rankFeaturedPlayers<T extends { matches: number; overall: number }>(list: T[]): T[] {
  const band = (p: T) => (p.matches >= FEATURED_MIN_MATCHES ? 2 : p.matches > 0 ? 1 : 0);
  return [...list].sort((a, b) => band(b) - band(a) || b.overall - a.overall || b.matches - a.matches);
}

/** Seçili bölgenin düğmede ve boş listelerde görünen adı */
export function regionLabel(city: string | null, district: string | null): string {
  return city ? (district ? `${district}, ${city}` : city) : "Tüm Türkiye";
}

export interface TeamFormRow {
  teamId: string;
  playedAt: string;
  won: boolean;
  draw?: boolean;
  /** Atılan − yenen gol */
  diff?: number;
}
export interface TeamForm {
  /** Süren üst üste galibiyet */
  streak: number;
  /** Son ACTIVE_DAYS günde oynanan maç */
  recent: number;
  /** Tüm zamanlar: oynanan, galibiyet, beraberlik, mağlubiyet, gol averajı */
  played: number;
  wins: number;
  draws: number;
  losses: number;
  diff: number;
}

export const ACTIVE_DAYS = 30;

/** Takım başına süren galibiyet serisi, son günlerdeki maç sayısı ve G/B/M toplamları (satırlar sırasız olabilir) */
export function teamForms(rows: TeamFormRow[], now = Date.now()): Map<string, TeamForm> {
  const out = new Map<string, TeamForm>();
  const broken = new Set<string>();
  for (const r of [...rows].sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))) {
    const f = out.get(r.teamId) ?? { streak: 0, recent: 0, played: 0, wins: 0, draws: 0, losses: 0, diff: 0 };
    f.played += 1;
    if (r.won) f.wins += 1;
    else if (r.draw) f.draws += 1;
    else f.losses += 1;
    f.diff += r.diff ?? 0;
    if (!r.won) broken.add(r.teamId);
    else if (!broken.has(r.teamId)) f.streak += 1;
    if (Date.parse(r.playedAt) >= now - ACTIVE_DAYS * 864e5) f.recent += 1;
    out.set(r.teamId, f);
  }
  return out;
}

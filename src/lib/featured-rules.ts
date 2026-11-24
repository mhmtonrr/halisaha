/**
 * Öne çıkanların bölge kademeleri ve oyuncu sırası (saf, testli).
 * Kullanıcı kararı (2026-11-24): her kademe sadece kendi bölgesini gösterir; kayıt azsa üst kademeye geçilmez.
 */

export type FeaturedLevel = "ilce" | "il" | "tr";

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

/** Kullanıcının bölgesine göre seçilebilen kademeler, dar → geniş */
export function availableLevels(city: string | null, district: string | null): FeaturedLevel[] {
  return [...(city && district ? (["ilce"] as const) : []), ...(city ? (["il"] as const) : []), "tr"];
}

export function levelLabel(level: FeaturedLevel, city: string | null, district: string | null): string {
  return level === "ilce" ? (district ?? "İlçe") : level === "il" ? (city ?? "İl") : "Türkiye";
}

/** Öne çıkanların bölge kademeleri (saf, testli) */

export type FeaturedLevel = "ilce" | "il" | "tr";

export interface Section<T> {
  items: T[];
  /** Listenin gerçekten geldiği kademe (seçilenden üst olabilir) */
  level: FeaturedLevel;
}

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
/** Kademede bu kadar kayıt yoksa bir üst kademeye çıkılır */
export const FEATURED_MIN_ITEMS = 3;

/** Kullanıcının bölgesine göre seçilebilen kademeler, dar → geniş */
export function availableLevels(city: string | null, district: string | null): FeaturedLevel[] {
  return [...(city && district ? (["ilce"] as const) : []), ...(city ? (["il"] as const) : []), "tr"];
}

/** Seçilen kademeden başlayıp yukarı doğru denenecek kademeler */
export function levelChain(level: FeaturedLevel, city: string | null, district: string | null): FeaturedLevel[] {
  const all = availableLevels(city, district);
  const i = all.indexOf(level);
  return i < 0 ? ["tr"] : all.slice(i);
}

/** Kademeleri sırayla dener; `min` kayıt bulunan ilkini, yoksa en genişini döndürür */
export async function pickSection<T>(chain: FeaturedLevel[], load: (l: FeaturedLevel) => Promise<T[]>, min: number): Promise<Section<T>> {
  let last: Section<T> = { items: [], level: chain[chain.length - 1] ?? "tr" };
  for (const level of chain) {
    const items = await load(level);
    last = { items, level };
    if (items.length >= min) return last;
  }
  return last;
}

export function levelLabel(level: FeaturedLevel, city: string | null, district: string | null): string {
  return level === "ilce" ? (district ?? "İlçe") : level === "il" ? (city ?? "İl") : "Türkiye";
}

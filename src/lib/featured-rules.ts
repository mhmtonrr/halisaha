/** Öne çıkanların bölge kademeleri (saf, testli) */

export type FeaturedLevel = "ilce" | "il" | "tr";

export interface Section<T> {
  items: T[];
  /** Listenin gerçekten geldiği kademe (seçilenden üst olabilir) */
  level: FeaturedLevel;
}

/** Öne çıkması için en az bu kadar puanlı maç (tek maçlık yıldız çıkmasın); kimse yoksa 1'e düşülür */
export const FEATURED_MIN_MATCHES = 3;
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

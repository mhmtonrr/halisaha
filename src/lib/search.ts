/**
 * Ad araması için büyük/küçük harf ve i/ı/İ/I ayrımı yapmayan desen (Postgres `imatch` ve JS RegExp).
 * `ilike` Türkçe İ/ı çiftlerini eşleştiremediği için kullanılır: "istanbul" → "İstanbul", "IŞIK" → "Işık".
 */
export function trPattern(q: string) {
  return q
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[iıİI]/g, "[iıİI]");
}

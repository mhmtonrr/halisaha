/**
 * Davet kodu yardımcıları (saf). Kullanıcı kodu elle yazar veya tüm linki yapıştırır; veritabanı da
 * büyük/küçük harf, boşluk ve tireyi yok sayar (norm_invite), burada aynı normalleştirme istemci tarafında yapılır.
 */

/** "https://site/join/ABCDE12345?x=1", "abcde-12345", " ABCDE 12345 " → "ABCDE12345" */
export function extractInviteCode(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.split(/[?#]/)[0] ?? "";
  if (s.includes("/")) s = s.split("/").filter(Boolean).pop() ?? "";
  return s.replace(/[\s-]/g, "").toLocaleUpperCase("en-US");
}

/** Okunaklı gösterim: 10 karakterlik kod "XXXXX-XXXXX"; eski 12 karakterli kodlar olduğu gibi */
export function formatInviteCode(code: string): string {
  return /^[A-Z0-9]{10}$/i.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}`.toUpperCase() : code;
}

export type JoinKind = "takim" | "grup";

export const parseKind = (v: string | undefined | null): JoinKind | null => (v === "takim" || v === "grup" ? v : null);

/** Seçilen türle kodun ait olduğu türün uyuşup uyuşmadığı (tür seçilmediyse her ikisi de kabul) */
export const kindMatches = (want: JoinKind | null, actual: "team" | "community") =>
  !want || (want === "takim" ? actual === "team" : actual === "community");

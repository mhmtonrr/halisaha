// Oyuncu güvenilirliği: oynadığı maç / (oynadığı + gelmediği maç). Saf fonksiyon — reliability.test.ts ile test edilir.
// "Gelmedi", maç sonucu girilirken kaptan/yetkili tarafından işaretlenir (match_no_shows).

export interface Reliability {
  /** 0-100; hiç maçı yoksa null */
  pct: number | null;
  played: number;
  noShows: number;
  tone: "new" | "good" | "ok" | "bad";
  label: string;
}

/** Güvenilirlik yüzdesinin anlamlı sayılması için en az bu kadar kayıtlı maç gerekir */
export const MIN_SAMPLE = 3;

export function reliability(played: number, noShows: number): Reliability {
  const total = played + noShows;
  if (total === 0) return { pct: null, played, noShows, tone: "new", label: "Yeni oyuncu · henüz kayıtlı maçı yok" };
  const pct = Math.round((played / total) * 100);
  // Az maçla yüzde yanıltıcı olur (1 maçta %100 / %0): örnek az ise "yeni" tonu, ama sayılar gösterilir
  const tone = total < MIN_SAMPLE ? "new" : pct >= 90 ? "good" : pct >= 70 ? "ok" : "bad";
  const counts = `${played} maç · ${noShows} gelmedi`;
  return { pct, played, noShows, tone, label: total < MIN_SAMPLE ? `Yeni · ${counts}` : `%${pct} güvenilir · ${counts}` };
}

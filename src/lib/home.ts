import { istanbulDate } from "./call-rules";

/** Ana sayfa yardımcıları (saf, testli) */

export interface TierProgress {
  name: "Bronz" | "Gümüş" | "Altın";
  /** Sonraki seviye (altında yok) */
  next: "Gümüş" | "Altın" | null;
  /** Sonraki seviyeye kalan puan */
  left: number;
  /** Çubuk doluluğu, 0-100 */
  pct: number;
  lo: number;
  hi: number;
}

// Eşikler PlayerCard.tierOf ile aynı: 64'e kadar bronz, 65-74 gümüş, 75+ altın
const BANDS = [
  { name: "Bronz", next: "Gümüş", lo: 40, hi: 65 },
  { name: "Gümüş", next: "Altın", lo: 65, hi: 75 },
  { name: "Altın", next: null, lo: 75, hi: 99 },
] as const;

export function tierProgress(overall: number): TierProgress {
  const band = overall >= 75 ? BANDS[2] : overall >= 65 ? BANDS[1] : BANDS[0];
  const pct = Math.round(Math.min(100, Math.max(0, ((overall - band.lo) / (band.hi - band.lo)) * 100)));
  return { name: band.name, next: band.next, left: band.next ? band.hi - overall : 0, pct, lo: band.lo, hi: band.hi };
}

/** Maça kalan gün (Türkiye takvimine göre): "Bugün", "Yarın", "3 gün kaldı"; geçmişse null */
export function daysLeftLabel(iso: string, now = Date.now()): string | null {
  const day = (ms: number) => Date.parse(istanbulDate(ms));
  const diff = Math.round((day(Date.parse(iso)) - day(now)) / 86_400_000);
  if (diff < 0) return null;
  if (diff === 0) return "Bugün";
  if (diff === 1) return "Yarın";
  return `${diff} gün kaldı`;
}

/** Kadro kapasitesi: kendi aramızda iki taraf, rakibe karşı sadece bizim taraf; boyut belli değilse null */
export function rosterCapacity(teamSize: number | null | undefined, kind: string): number | null {
  if (!teamSize) return null;
  return kind === "external" ? teamSize : teamSize * 2;
}

/** Maç kartındaki tarih ve saat (Türkiye saati): { date: "21 Kas Cmt", time: "21:00" } */
export function cardDateTime(iso: string, timeTbd: boolean): { date: string; time: string } {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", ...o }).format(d);
  return {
    date: `${part({ day: "numeric", month: "short" })} ${part({ weekday: "short" })}`,
    time: timeTbd ? "Saat belli değil" : part({ hour: "2-digit", minute: "2-digit" }),
  };
}

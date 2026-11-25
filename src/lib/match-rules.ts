// Yeni maç yapısının saf kuralları (sunucu/istemci ortak, testli).

export type MatchKind = "internal" | "external";

/** Kadro sayısı varsayılanı: rakibe karşı bizim taraf (team_size), kendi aramızda iki taraf (2×) */
export function defaultCapacity(kind: MatchKind, teamSize: number): number {
  return kind === "internal" ? teamSize * 2 : teamSize;
}

/** "Cum 28 Kas 21:00" veya saat belli değilse "Cum 28 Kas · saat belli değil" */
export function matchWhen(iso: string, timeTbd: boolean): string {
  const d = new Date(iso);
  if (timeTbd) {
    return `${d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short" })} · saat belli değil`;
  }
  return d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const feeText = (fee: number) => `Kişi başı ${fee} TL`;

/** "vs Yıldızspor" · teklif bekliyorsa "vs Yıldızspor (onay bekliyor)" · rakip yoksa null */
export function opponentLabel(opponent: string | null | undefined, pending?: string | null): string | null {
  if (opponent) return `vs ${opponent}`;
  return pending ? `vs ${pending} (onay bekliyor)` : null;
}

/** Maç açılınca direkt kesin mi: kadro dolu, saat belli, rakibe karşıysa rakip belli (create_match_v2 ile aynı kural) */
export function opensConfirmed(o: { count: number; capacity: number; hasTime: boolean; kind: MatchKind; hasOpponent: boolean }): boolean {
  return o.count >= o.capacity && o.hasTime && (o.kind === "internal" || o.hasOpponent);
}

// Gün/saat yardımcıları (saf, call-rules.test.ts). Eski çağrı kuralları 0047 ile kalktı; ad geriye uyum için kaldı.

/** Gün + isteğe bağlı başlangıç (üye önerisi: match_proposals) */
export interface CallShape {
  play_on: string;
  starts_at: string | null;
}

/** Türkiye'de bugünün tarihi (YYYY-MM-DD) */
export function istanbulDate(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

/** "Cuma 28 Kas · saat belli değil" veya "Cum 28 Kas 21:00" */
export function callWhen(call: CallShape): string {
  if (call.starts_at) {
    return new Date(call.starts_at).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const day = new Date(`${call.play_on}T12:00:00+03:00`).toLocaleDateString("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return `${day} · saat belli değil`;
}

/** Türkiye saatiyle gün + "HH:MM" → ISO (saat boşsa null) */
export function dayTimeToIso(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return new Date(`${day}T${time}:00+03:00`).toISOString();
}

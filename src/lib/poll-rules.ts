// Üye çağrısının maça dönüşme kuralları. Saf fonksiyonlar (veritabanı yok) — poll-rules.test.ts ile test edilir.
//
//  * Kontenjan (2 x kişi sayısı) dolunca maç hemen kurulur.
//  * Son yanıt süresi bitince "geliyorum" diyenler kontenjanın en az %70'iyse onlarla kurulur, değilse çağrı iptal olur.
//  * Kontenjandan fazla "geliyorum" yedek sırasındadır (yanıt sırasına göre); biri vazgeçerse sıradaki girer.

/** Süre bitince maçın kurulması için kontenjanın en az bu oranı gelmeli */
export const MIN_FILL_RATIO = 0.7;

/** Kontenjana göre kurulabilmek için en az kaç kişi gerekir (14 → 10, 10 → 7) */
export const minPlayers = (capacity: number) => Math.max(2, Math.ceil(capacity * MIN_FILL_RATIO));

export type PollDecision = "convert" | "cancel" | "wait";

/** Çağrı şu an ne yapmalı: maça dönüş, iptal ya da beklemeye devam */
export function decidePoll(p: { yes: number; capacity: number; deadlinePassed: boolean }): PollDecision {
  if (p.yes >= p.capacity) return "convert";
  if (!p.deadlinePassed) return "wait";
  return p.yes >= minPlayers(p.capacity) ? "convert" : "cancel";
}

/** Yanıt sırasına göre ilk `capacity` kişi kadroya girer, kalanı yedek sırasında bekler */
export function pickRoster<T extends { id: string; respondedAt: string }>(
  yes: T[],
  capacity: number,
): { roster: T[]; waitlist: T[] } {
  const ordered = [...yes].sort((a, b) => a.respondedAt.localeCompare(b.respondedAt) || a.id.localeCompare(b.id));
  return { roster: ordered.slice(0, capacity), waitlist: ordered.slice(capacity) };
}

/** Çağrıdaki durum özeti: ekranda "10/14 geliyor, en az 10 gerekir" gibi göstermek için */
export function pollProgress(yes: number, capacity: number) {
  const need = minPlayers(capacity);
  return {
    yes: Math.min(yes, capacity),
    waitlist: Math.max(0, yes - capacity),
    capacity,
    need,
    missingForFull: Math.max(0, capacity - yes),
    missingForMin: Math.max(0, need - yes),
    enough: yes >= need,
  };
}

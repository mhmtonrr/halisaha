// Karttaki ad: sığmayan uzun adlar kısaltılır. Saf fonksiyon — card-name.test.ts ile test edilir.

/** Karttaki ad kuşağına sığan en fazla karakter */
export const CARD_NAME_MAX = 15;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const initial = (w: string) => `${w[0]!.toLocaleUpperCase("tr-TR")}.`;

/** "Mehmet Onur Duman" → "Mehmet Onur D."; hâlâ uzunsa "Mehmet D."; hâlâ uzunsa sonuna "…" */
export function fitCardName(name: string, max = CARD_NAME_MAX): string {
  const w = words(name);
  const full = w.join(" ");
  if (full.length <= max || w.length < 2) return full.length <= max ? full : `${full.slice(0, max - 1)}…`;
  const last = initial(w[w.length - 1]);
  const mid = `${w.slice(0, -1).join(" ")} ${last}`;
  if (mid.length <= max) return mid;
  const short = `${w[0]} ${last}`;
  return short.length <= max ? short : `${short.slice(0, max - 1)}…`;
}

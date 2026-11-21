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

// ---- Kartta görünen ad: doğrulama ----

export const CARD_NAME_MIN_LEN = 2;
export const CARD_NAME_MAX_LEN = 20;

/** Küfür kontrolü için: küçük harf, Türkçe harfleri ASCII'ye indir, harf-rakam değişimlerini çöz */
function normalizeForProfanity(s: string): string[] {
  const leet: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "@": "a", "!": "i" };
  const map = (ch: string) =>
    leet[ch] ?? ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" } as Record<string, string>)[ch] ?? ch;
  const lower = s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  const mapped = Array.from(lower).map(map).join("");
  // tekrar eden harfleri teke indir ("siiiik" → "sik"); kelimeleri ayır
  return mapped.split(/[\s.\-_*]+/).map((w) => w.replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1")).filter(Boolean);
}

const collapse = (s: string) => s.replace(/(.)\1+/g, "$1");

/** 4+ harfli kökler: birleştirilmiş metnin herhangi bir yerinde geçerse yakalanır */
const PROFANITY_LONG = [
  "amcik", "orospu", "pezevenk", "yarrak", "gavat", "ibne", "kahpe", "siktir", "sikis", "sikim", "sikik", "sikeyim", "sikerim",
  "yavsak", "aminakoy", "aminakod", "aminisik", "serefsiz", "gerizekali", "gotveren", "gotlek", "tasak", "kaltak", "surtuk",
  "fahise", "dangalak", "dalyarak", "pust", "ananisik", "orosbu", "bokun", "boktan",
].map(collapse);

/** Kısa kökler: sadece tek başına kelime olarak (veya harfleri ayrılmış hâlde) yakalanır; adlarda yanlış alarmı önler */
const PROFANITY_SHORT = ["sik", "amk", "aq", "mk", "oc", "pic", "got", "bok", "sg", "amq", "sktr"].map(collapse);

/** Metin küfür/hakaret içeriyor mu? (büyük/küçük, Türkçe harf, tekrar, bölme ve s1k/ş0t değişimleri yakalanır) */
export function hasProfanity(text: string): boolean {
  const ws = normalizeForProfanity(text);
  if (ws.length === 0) return false;
  const joined = ws.join("");
  if (PROFANITY_LONG.some((p) => joined.includes(p))) return true;
  const joinedCollapsed = collapse(joined);
  return PROFANITY_SHORT.includes(joinedCollapsed) || ws.some((w) => PROFANITY_SHORT.includes(w));
}

export type CardNameResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Kullanıcının yazdığı kart adını doğrular ve sadeleştirir; boş girdi → null (gerçek ad kullanılır) */
export function validateCardName(input: string | null | undefined): CardNameResult {
  const v = (input ?? "").trim().replace(/\s+/g, " ");
  if (v === "") return { ok: true, value: null };
  if (v.length < CARD_NAME_MIN_LEN || v.length > CARD_NAME_MAX_LEN)
    return { ok: false, error: `Kartta görünen ad ${CARD_NAME_MIN_LEN}-${CARD_NAME_MAX_LEN} karakter olmalı.` };
  if (!/^[\p{Script=Latin} .]+$/u.test(v))
    return { ok: false, error: "Kartta görünen adda sadece harf, boşluk ve nokta olabilir." };
  // Nokta: sadece bir harfin hemen arkasından; ardışık iki nokta ve noktayla başlama yok
  if (/(^|[^\p{Script=Latin}])\./u.test(v))
    return { ok: false, error: "Nokta sadece bir harfin hemen arkasından gelebilir (örn. \"Mehmet O.\")." };
  if (hasProfanity(v)) return { ok: false, error: "Bu ad uygun değil, lütfen başka bir ad seç." };
  return { ok: true, value: v };
}

/** Kartta gösterilecek ad: kart adı doluysa o, değilse gerçek ad; ikisi de kısaltma kuralından geçer */
export function cardDisplayName(realName: string, cardName?: string | null, max = CARD_NAME_MAX): string {
  return fitCardName(cardName?.trim() ? cardName : realName, max);
}

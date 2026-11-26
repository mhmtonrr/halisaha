// Takım/grup logosu: saf yardımcılar. `groups.logo` değeri dört türlü olur (0054, `logo_ok`):
// boş → otomatik arma · "crest:<şekil>.<sembol>.<desen>.<ikinci renk>" · "preset:<id>" · depodaki yüklenen görsel adresi.

export const CREST_SHAPES = ["kalkan", "daire", "altigen", "flama"] as const;
export const CREST_EMBLEMS = [
  "harf", "top", "yildiz", "simsek", "tac", "alev", "kale", "capa", "kartal", "aslan", "kurt", "boga",
] as const;
export const CREST_PATTERNS = ["duz", "cizgili", "capraz", "yarim"] as const;

export type CrestShape = (typeof CREST_SHAPES)[number];
export type CrestEmblem = (typeof CREST_EMBLEMS)[number];
export type CrestPattern = (typeof CREST_PATTERNS)[number];

export interface CrestSpec {
  shape: CrestShape;
  emblem: CrestEmblem;
  pattern: CrestPattern;
  /** İkinci renk (#rrggbb); ana renk takım rengidir */
  second: string;
}

/** Hazır logolar: `public/logos/<id>.webp`. Görseller eklenene kadar boş (seçim ekranında sekme gizli). */
export const PRESET_LOGOS: readonly string[] = [];

export const DEFAULT_TEAM_COLOR = "#1a5a36";

/** Otomatik armada kullanılan ikinci renkler (koyu tonlar; beyaz sembol okunur kalsın) */
const AUTO_SECONDS = ["#0b1f14", "#101828", "#3b0a14", "#1e1b4b", "#292524"];

export type Logo =
  | { type: "crest"; spec: CrestSpec }
  | { type: "image"; src: string };

/** Küçük, sabit metin özeti (FNV-1a) */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Seçim yapılmamış takımın arması: kimlikten hep aynı çıkar (ad değişse de değişmez), ortada baş harfler */
export function autoCrest(seed: string): CrestSpec {
  const h = hash(seed);
  return {
    shape: CREST_SHAPES[h % CREST_SHAPES.length],
    emblem: "harf",
    pattern: CREST_PATTERNS[(h >>> 8) % CREST_PATTERNS.length],
    second: AUTO_SECONDS[(h >>> 16) % AUTO_SECONDS.length],
  };
}

export function encodeCrest(s: CrestSpec) {
  return `crest:${s.shape}.${s.emblem}.${s.pattern}.${s.second.replace("#", "").toLowerCase()}`;
}

export function parseCrest(value: string): CrestSpec | null {
  if (!value.startsWith("crest:")) return null;
  const [shape, emblem, pattern, second, ...rest] = value.slice(6).split(".");
  if (rest.length || !/^[0-9a-f]{6}$/.test(second ?? "")) return null;
  if (!(CREST_SHAPES as readonly string[]).includes(shape)) return null;
  if (!(CREST_EMBLEMS as readonly string[]).includes(emblem)) return null;
  if (!(CREST_PATTERNS as readonly string[]).includes(pattern)) return null;
  return { shape: shape as CrestShape, emblem: emblem as CrestEmblem, pattern: pattern as CrestPattern, second: `#${second}` };
}

/** Kayıtlı değeri gösterilecek logoya çevirir; tanınmayan veya kaldırılmış değer otomatik armaya düşer */
export function resolveLogo(logo: string | null | undefined, seed: string): Logo {
  if (logo?.startsWith("https://")) return { type: "image", src: logo };
  if (logo?.startsWith("preset:")) {
    const id = logo.slice(7);
    if (PRESET_LOGOS.includes(id)) return { type: "image", src: `/logos/${id}.webp` };
  }
  return { type: "crest", spec: (logo ? parseCrest(logo) : null) ?? autoCrest(seed) };
}

/**
 * Formdan gelen logo seçimi: boş → null (otomatik), geçerli arma/hazır logo → aynen.
 * Alan yoksa veya tanınmıyorsa (ör. yüklenmiş görsel adresi) undefined: kayıtlı logo değişmez.
 */
export function logoFromForm(value: unknown): string | null | undefined {
  if (value === "") return null;
  if (typeof value !== "string") return undefined;
  if (parseCrest(value)) return value;
  if (value.startsWith("preset:") && PRESET_LOGOS.includes(value.slice(7))) return value;
  return undefined;
}

/** Adın ilk iki kelimesinin baş harfleri (Türkçe büyük harf) */
export function teamInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
      .join("") || "?"
  );
}

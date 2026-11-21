/**
 * Yetenek itibarı: karttaki 6 özellik, birlikte en az 2 maç oynayanların 1-10 puanlarından gelir (bilinmeyen boş).
 *
 * rating.ts ile aynı fikir: **oy verene göre normalizasyon**. Herkese 9 veren de herkese 5 veren de aynı oyuncuyu
 * ortalama görür; sadece birini diğerlerinden ayırması puan sayılır (z). Az puan veren, ortalamaya (6) çekilerek
 * normalize edilir. Karşılıklı yüksek puan verenler (klik) yarım ağırlık alır. Değer, ağırlıklı z ortalamasının
 * 40-99 ölçeğine taşınmasıdır; az oyda ortalamaya (65) çekilir. En az 2 farklı oy veren yoksa değer boş ("—").
 */

export const FIELD_SKILLS = [
  { key: "HIZ", label: "Hız", question: "En hızlı kim?" },
  { key: "ŞUT", label: "Şut", question: "En iyi şut / bitiricilik kimde?" },
  { key: "PAS", label: "Pas", question: "En iyi pas ve oyun görüşü kimde?" },
  { key: "DRİ", label: "Top sürme", question: "Topu en iyi kim sürdü?" },
  { key: "DEF", label: "Savunma", question: "En iyi top kapan / savunmacı kim?" },
  { key: "FİZ", label: "Fizik", question: "En güçlü ve dayanıklı kim?" },
] as const;

export const KEEPER_SKILLS = [
  { key: "REF", label: "Refleks", question: "En iyi refleks kimde?" },
  { key: "ATL", label: "Atılma", question: "En iyi çıkış / birebir kimde?" },
  { key: "HAV", label: "Havadan top", question: "Havadaki topa en hâkim kim?" },
  { key: "YER", label: "Yer tutma", question: "En iyi yer tutan kim?" },
  { key: "DAĞ", label: "Dağıtım", question: "En iyi dağıtan kim?" },
  { key: "İLT", label: "İletişim", question: "Savunmayı en iyi yöneten kim?" },
] as const;

export type SkillKey =
  | (typeof FIELD_SKILLS)[number]["key"]
  | (typeof KEEPER_SKILLS)[number]["key"];

export const ALL_SKILLS = [...FIELD_SKILLS, ...KEEPER_SKILLS];
export const SKILL_KEYS = ALL_SKILLS.map((s) => s.key) as SkillKey[];
export const isSkillKey = (x: string): x is SkillKey => (SKILL_KEYS as string[]).includes(x);
export const skillSet = (isGoalkeeper: boolean) => (isGoalkeeper ? KEEPER_SKILLS : FIELD_SKILLS);

export const SKILL_CONFIG = {
  /** Değerin görünmesi için gereken en az farklı oy veren */
  MIN_VOTERS: 2,
  /** Birlikte oynanması gereken en az maç (veritabanı ve sıra için; burada bilgi amaçlı) */
  MIN_SHARED_MATCHES: 2,
  BASE: 65,
  /** 1 standart sapma üstü = BASE + SCALE */
  SCALE: 11,
  /** Ortalamaya çekme: ağırlık cinsinden ön bilgi (tek oy BASE'e doğru yarı yolda kalır) */
  PRIOR: 1,
  /** Oy verenin normalizasyonu için ön bilgi: tarafsız ortalama, standart sapma ve ağırlığı (puan sayısı cinsinden) */
  NEUTRAL_MEAN: 6,
  NEUTRAL_SD: 1.5,
  NORM_WEIGHT: 3,
  /** İki kişi birbirine ortalama bu puanın üstünü verirse (klik) oyları bu çarpanla sayılır */
  CLIQUE_MEAN: 8.5,
  CLIQUE_WEIGHT: 0.5,
};

export type Scores = Partial<Record<SkillKey, number>>;

export interface VoterNorm {
  mean: Partial<Record<SkillKey, number>>;
  sd: Partial<Record<SkillKey, number>>;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Bir oy verenin verdiği TÜM puanlardan (her hedefe verdikleri) kategori başına ortalama ve sapma.
 * Az puan verdiyse tarafsız ön bilgiye (6, 1,5) çekilir; hiç vermediyse tarafsızdır.
 */
export function voterNorm(given: Scores[]): VoterNorm {
  const mean: VoterNorm["mean"] = {};
  const sd: VoterNorm["sd"] = {};
  for (const key of SKILL_KEYS) {
    const xs = given.map((g) => g[key]).filter((x): x is number => typeof x === "number");
    const n = xs.length;
    const k = SKILL_CONFIG.NORM_WEIGHT;
    const m = (xs.reduce((a, b) => a + b, 0) + SKILL_CONFIG.NEUTRAL_MEAN * k) / (n + k);
    const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0) + SKILL_CONFIG.NEUTRAL_SD ** 2 * k;
    mean[key] = m;
    sd[key] = Math.max(0.75, Math.sqrt(ss / (n + k)));
  }
  return { mean, sd };
}

/** Bir oy verenin bir hedefe verdiği puanlar (normalizasyonuyla) */
export interface SkillRating {
  voterKey: string;
  scores: Scores;
  norm: VoterNorm;
  /** İki kişi birbirine karşılıklı yüksek puan veriyor (klik) */
  mutualHigh?: boolean;
}

const avg = (s: Scores) => {
  const xs = Object.values(s).filter((x): x is number => typeof x === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
};

/** A'nın B'ye ve B'nin A'ya verdiği puanların ortalaması ikisi de eşiğin üstündeyse klik sayılır */
export const isMutualHigh = (aToB: Scores, bToA: Scores | null | undefined) =>
  !!bToA && avg(aToB) >= SKILL_CONFIG.CLIQUE_MEAN && avg(bToA) >= SKILL_CONFIG.CLIQUE_MEAN;

export interface SkillValue {
  key: SkillKey;
  label: string;
  value: number | null;
  /** Bu kategoride puan veren farklı kişi sayısı */
  voters: number;
}

/** Bir oyuncunun aldığı puanlardan yetenek değerleri. `isGoalkeeper` hangi altı kategorinin gösterileceğini belirler. */
export function computeSkills(ratings: SkillRating[], isGoalkeeper: boolean): SkillValue[] {
  return skillSet(isGoalkeeper).map(({ key, label }) => {
    let wz = 0;
    let w = 0;
    const voters = new Set<string>();
    for (const r of ratings) {
      const x = r.scores[key];
      if (typeof x !== "number") continue;
      const z = (x - (r.norm.mean[key] ?? SKILL_CONFIG.NEUTRAL_MEAN)) / (r.norm.sd[key] ?? SKILL_CONFIG.NEUTRAL_SD);
      const weight = r.mutualHigh ? SKILL_CONFIG.CLIQUE_WEIGHT : 1;
      wz += weight * z;
      w += weight;
      voters.add(r.voterKey);
    }
    let value: number | null = null;
    if (voters.size >= SKILL_CONFIG.MIN_VOTERS) {
      value = clamp(Math.round(SKILL_CONFIG.BASE + SKILL_CONFIG.SCALE * (wz / (w + SKILL_CONFIG.PRIOR))), 40, 99);
    }
    return { key, label, value, voters: voters.size };
  });
}

/** Kartta gösterilecek yalın liste (değer yoksa null) */
export const toCardSkills = (skills: SkillValue[]) => skills.map((s) => ({ key: s.key, value: s.value }));

/** Hiç oy yokken kartta gösterilen boş liste */
export const emptySkills = (isGoalkeeper: boolean) =>
  skillSet(isGoalkeeper).map((s) => ({ key: s.key as SkillKey, value: null as number | null }));

/** Veritabanında saklanan değerlerden (anahtar → değer) kartın 6 yeteneğini kurar; kalecide kaleci seti */
export function cardSkills(stored: Record<string, number | null> | null | undefined, isGoalkeeper: boolean) {
  return skillSet(isGoalkeeper).map((s) => ({ key: s.key as SkillKey, value: stored?.[s.key] ?? null }));
}

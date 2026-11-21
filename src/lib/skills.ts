/**
 * Yetenek itibarı: karttaki 6 özellik maç sonrası "kim öne çıktı?" işaretlemesinden gelir.
 *
 * Her oy veren (maçta sahada olan, kendisi hariç) her kategoride en fazla 2 kişi seçer. Bir kişinin değeri,
 * aldığı işaret sayısının, rastgele dağılsaydı alacağı beklenen işarete oranıdır; böylece kadro büyüklüğü
 * ve kaç kişinin oy verdiği sonucu bozmaz. Az oyda ortalamaya (65) çekilir. Yeterli oy yoksa değer boş ("—").
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
  /** Bir oy verenin kategori başına seçebileceği kişi sayısı */
  MAX_PICKS: 2,
  /** Değerin görünmesi için gereken en az farklı oy veren ve oylanmış maç */
  MIN_VOTERS: 2,
  MIN_BALLOTS: 2,
  /** Ortalamaya çekme: kaç "beklenen işaret" değerinde ön bilgi */
  PRIOR: 1,
  BASE: 65,
  /** r=2 (beklenenin iki katı) → BASE + SPREAD */
  SPREAD: 18,
  /** r=0,5 (beklenenin yarısı) → BASE - SPREAD_DOWN; düşüş yönü daha yumuşaktır, ortalama oyuncu 40'a yapışmasın */
  SPREAD_DOWN: 10,
};

/** Bir kişi için tek bir oy pusulası (bir oy verenin bir maçtaki yetenek oyu) */
export interface SkillBallot {
  voterKey: string;
  matchId: string;
  /** Kategori → bu pusulada kişinin işaretlenip işaretlenmediği */
  picked: Partial<Record<SkillKey, boolean>>;
  /** Kategori → oy verenin seçebileceği aday sayısı (kendisi hariç). 0 ise o kategori sayılmaz. */
  candidates: Partial<Record<SkillKey, number>>;
}

export interface SkillValue {
  key: SkillKey;
  label: string;
  value: number | null;
  /** Bu kategoride işaret alan / değerlendirmeye katılan sayısı (ipucu metni için) */
  nominations: number;
  voters: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Bir oyuncunun pusulalarından yetenek değerleri. `isGoalkeeper` hangi altı kategorinin gösterileceğini belirler. */
export function computeSkills(ballots: SkillBallot[], isGoalkeeper: boolean): SkillValue[] {
  return skillSet(isGoalkeeper).map(({ key, label }) => {
    let observed = 0;
    let expected = 0;
    const voters = new Set<string>();
    const matches = new Set<string>();
    for (const b of ballots) {
      const k = b.candidates[key] ?? 0;
      if (k <= 0) continue;
      // Aday sayısı seçim hakkını aşmıyorsa (ör. maçta tek kaleci) herkesi seçmek mümkündür ve işaret bilgi taşımaz:
      // beklenen oran 0,5'e sabitlenir; yani ortalamanın üstüne çıkmak için oy verenlerin çoğunun işaretlemesi gerekir.
      expected += k <= SKILL_CONFIG.MAX_PICKS ? 0.5 : SKILL_CONFIG.MAX_PICKS / k;
      if (b.picked[key]) observed += 1;
      voters.add(b.voterKey);
      matches.add(b.matchId);
    }
    const enough = voters.size >= SKILL_CONFIG.MIN_VOTERS && matches.size >= SKILL_CONFIG.MIN_BALLOTS;
    let value: number | null = null;
    if (enough) {
      const ratio = (observed + SKILL_CONFIG.PRIOR) / (expected + SKILL_CONFIG.PRIOR);
      const spread = ratio >= 1 ? SKILL_CONFIG.SPREAD : SKILL_CONFIG.SPREAD_DOWN;
      value = clamp(Math.round(SKILL_CONFIG.BASE + spread * Math.log2(ratio)), 40, 99);
    }
    return { key, label, value, nominations: observed, voters: voters.size };
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

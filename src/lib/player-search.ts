// Oyuncu arama kuralları: aday listesini süzer ve sıralar. Saf fonksiyonlar — player-search.test.ts ile test edilir.
// Veriyi çeken kısım players-data.ts'dedir.

import type { Foot, Position } from "@/lib/data";
import { ALL_SKILLS, isSkillKey, type SkillKey } from "@/lib/skills";
import { reliability } from "@/lib/reliability";

export interface PublicTeamRef {
  id: string;
  name: string;
  color: string | null;
  logo: string | null;
}

export interface PlayerCandidate {
  userId: string;
  name: string;
  /** Kartta görünen ad (isteğe bağlı) */
  cardName?: string | null;
  /** Kart fotoğrafı (isteğe bağlı) */
  photoUrl?: string | null;
  city: string | null;
  district: string | null;
  position: Position | null;
  secondary: Position[];
  foot: Foot | null;
  shirt: number | null;
  overall: number;
  matches: number;
  /** Kayıtlı yetenek değerleri (en az 2 oy verenle görünür; yoksa boş) */
  skills: Record<string, number | null>;
  noShows: number;
  /** Asıl (ödünç olmayan, ayrılmamış) üyesi olduğu herkese açık takımlar; özel grup asla burada olmaz */
  teams: PublicTeamRef[];
}

export interface PlayerFilter {
  q?: string;
  position?: Position;
  /** Ana mevkinin yanında ikinci mevkileri de eşleştir */
  includeSecondary?: boolean;
  minOverall?: number;
  maxOverall?: number;
  /** En az bu kadar puanlı maçı olanlar */
  minMatches?: number;
  foot?: Foot;
  skill?: SkillKey;
  minSkill?: number;
  /** Gelmediği maç yok veya güvenilirlik ≥ %90 */
  reliable?: boolean;
  /** Hiçbir takımın asıl üyesi değil (ödünç/transfer için aranabilir) */
  teamless?: boolean;
}

/** Yetenek anahtarı da sıralama ölçütüdür (?sirala=HIZ) */
export type PlayerSort = "rating" | "rating-artan" | "yukselen" | "mac" | "guvenilir" | "isim" | SkillKey;

export const SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: "rating", label: "Rating (yüksekten)" },
  { value: "rating-artan", label: "Rating (düşükten)" },
  { value: "yukselen", label: "Yükselenler (30 gün)" },
  { value: "mac", label: "En çok maç" },
  { value: "guvenilir", label: "En güvenilir" },
  { value: "isim", label: "İsim (A-Z)" },
];
export const SORTS: PlayerSort[] = [...SORT_OPTIONS.map((o) => o.value), ...ALL_SKILLS.map((s) => s.key)];

/** Türkçe büyük/küçük harfe duyarsız karşılaştırma ("İ"/"ı" dahil) */
export const fold = (s: string) => s.toLocaleLowerCase("tr-TR").trim();

export const isReliable = (c: Pick<PlayerCandidate, "matches" | "noShows">) => {
  if (c.noShows === 0) return true;
  const r = reliability(c.matches, c.noShows);
  return r.pct !== null && r.pct >= 90;
};

export function matchesFilter(c: PlayerCandidate, f: PlayerFilter): boolean {
  if (f.q && !fold(c.name).includes(fold(f.q))) return false;
  if (f.position && c.position !== f.position && !(f.includeSecondary && c.secondary.includes(f.position))) return false;
  if (f.foot && c.foot !== f.foot) return false;
  // Rating aralığı: hiç maçı olmayanın puanı varsayılandır, aralığa sokulmaz
  if ((f.minOverall !== undefined || f.maxOverall !== undefined) && c.matches === 0) return false;
  if (f.minOverall !== undefined && c.overall < f.minOverall) return false;
  if (f.maxOverall !== undefined && c.overall > f.maxOverall) return false;
  if (f.minMatches !== undefined && c.matches < f.minMatches) return false;
  if (f.skill) {
    const v = c.skills[f.skill];
    if (v === null || v === undefined || v < (f.minSkill ?? 0)) return false;
  }
  if (f.reliable && !isReliable(c)) return false;
  if (f.teamless && c.teams.length > 0) return false;
  return true;
}

export function sortPlayers(
  list: PlayerCandidate[],
  sort: PlayerSort,
  skill?: SkillKey,
  /** "yukselen" için: kullanıcı → rating artışı */
  rising?: Map<string, number>,
): PlayerCandidate[] {
  const byName = (a: PlayerCandidate, b: PlayerCandidate) => a.name.localeCompare(b.name, "tr");
  const out = [...list];
  if (sort === "isim") return out.sort(byName);
  if (sort === "mac") return out.sort((a, b) => b.matches - a.matches || b.overall - a.overall || byName(a, b));
  // Rating: puanlı maçı olanlar önce; yetenek seçiliyse eşitlikte o yetenek
  const byRating = (a: PlayerCandidate, b: PlayerCandidate) =>
    Number(b.matches > 0) - Number(a.matches > 0) ||
    b.overall - a.overall ||
    (skill ? (b.skills[skill] ?? 0) - (a.skills[skill] ?? 0) : 0) ||
    b.matches - a.matches ||
    byName(a, b);
  if (sort === "rating") return out.sort(byRating);
  if (sort === "rating-artan") return out.sort((a, b) => Number(b.matches > 0) - Number(a.matches > 0) || a.overall - b.overall || byName(a, b));
  if (sort === "yukselen") return out.sort((a, b) => (rising?.get(b.userId) ?? 0) - (rising?.get(a.userId) ?? 0) || byRating(a, b));
  if (sort === "guvenilir") {
    // Az örnekli yüzde yanıltır: yeterli kaydı olanlar önce, sonra yüzde, sonra maç sayısı
    const key = (c: PlayerCandidate) => {
      const r = reliability(c.matches, c.noShows);
      return { sample: r.pct === null ? 0 : r.tone === "new" ? 1 : 2, pct: r.pct ?? 0 };
    };
    return out.sort((a, b) => key(b).sample - key(a).sample || key(b).pct - key(a).pct || b.matches - a.matches || byRating(a, b));
  }
  // Yetenek: değeri olanlar yüksekten, olmayanlar sonda
  return out.sort((a, b) => (b.skills[sort] ?? 0) - (a.skills[sort] ?? 0) || byRating(a, b));
}

export function searchCandidates(list: PlayerCandidate[], f: PlayerFilter, sort: PlayerSort = "rating", rising?: Map<string, number>) {
  return sortPlayers(list.filter((c) => matchesFilter(c, f)), sort, f.skill, rising);
}

// --- Adres çubuğu parametreleri ---

const POS = ["GK", "DEF", "MID", "FWD"];
const num = (v: string | undefined, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};

/** `?mevki=MID&min=70…` → süzgeç. Geçersiz değerler yok sayılır. */
export function parseFilter(sp: Record<string, string | undefined>): { filter: PlayerFilter; sort: PlayerSort } {
  const skill = sp.yetenek && isSkillKey(sp.yetenek) ? sp.yetenek : undefined;
  const filter: PlayerFilter = {
    q: sp.q?.trim().slice(0, 40) || undefined,
    position: sp.mevki && POS.includes(sp.mevki) ? (sp.mevki as Position) : undefined,
    includeSecondary: sp.ikinci === "1" || undefined,
    minOverall: num(sp.min, 40, 99),
    maxOverall: num(sp.max, 40, 99),
    minMatches: num(sp.mac, 1, 100),
    foot: sp.ayak === "L" || sp.ayak === "R" || sp.ayak === "B" ? sp.ayak : undefined,
    skill,
    minSkill: skill ? (num(sp.ymin, 40, 99) ?? 60) : undefined,
    reliable: sp.guvenilir === "1" || undefined,
    teamless: sp.takimsiz === "1" || undefined,
  };
  const sort = SORTS.includes(sp.sirala as PlayerSort) ? (sp.sirala as PlayerSort) : "rating";
  return { filter, sort };
}

/** Süzgeç dışındaki sıralama/sayfa dışında kaç filtre etkin (arayüzde rozet) */
export function activeFilterCount(f: PlayerFilter): number {
  return [f.q, f.position, f.minOverall, f.maxOverall, f.minMatches, f.foot, f.skill, f.reliable, f.teamless].filter((x) => x !== undefined).length;
}

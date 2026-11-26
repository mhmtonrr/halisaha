// Keşfet takım sıralaması: seçenekler ve saf sıralama kuralı (team-sort.test.ts)

import { FEATURED_MIN_MATCHES, type TeamForm } from "@/lib/featured-rules";

export const TEAM_SORTS = [
  { value: "rating", label: "Rating" },
  { value: "oran", label: "Galibiyet oranı" },
  { value: "galibiyet", label: "En çok galibiyet" },
  { value: "mac", label: "En çok maç" },
  { value: "seri", label: "Galibiyet serisi" },
  { value: "aktif", label: "Son 30 günde aktif" },
  { value: "averaj", label: "Gol averajı" },
  { value: "kadro", label: "En kalabalık kadro" },
  { value: "isim", label: "İsim (A-Z)" },
] as const;
export type TeamSort = (typeof TEAM_SORTS)[number]["value"];

export const parseTeamSort = (v: string | undefined): TeamSort => TEAM_SORTS.find((s) => s.value === v)?.value ?? "rating";

export const NO_FORM: TeamForm = { streak: 0, recent: 0, played: 0, wins: 0, draws: 0, losses: 0, diff: 0 };

/** Galibiyet yüzdesi; maçı yoksa 0 */
export const winRate = (f: TeamForm) => (f.played ? Math.round((f.wins / f.played) * 100) : 0);

type ByForm = Exclude<TeamSort, "rating" | "isim" | "kadro">;
const band = (f: TeamForm) => (f.played >= FEATURED_MIN_MATCHES ? 2 : f.played > 0 ? 1 : 0);
const COMPARE: Record<ByForm, (a: TeamForm, b: TeamForm) => number> = {
  // Tek maçlık %100 öne geçmesin: yeterli maçı olanlar önce
  oran: (a, b) => band(b) - band(a) || winRate(b) - winRate(a) || b.wins - a.wins,
  galibiyet: (a, b) => b.wins - a.wins || a.played - b.played,
  mac: (a, b) => b.played - a.played,
  seri: (a, b) => b.streak - a.streak,
  aktif: (a, b) => b.recent - a.recent,
  averaj: (a, b) => Number(b.played > 0) - Number(a.played > 0) || b.diff - a.diff,
};

/** Listeyi seçilen ölçüte göre sıralar; gelen sıra (rating) eşitlikte korunur */
export function sortTeams<T extends { id: string; name: string; members: number }>(teams: T[], sort: TeamSort, forms: Map<string, TeamForm>): T[] {
  const out = [...teams];
  if (sort === "rating") return out;
  if (sort === "isim") return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  if (sort === "kadro") return out.sort((a, b) => b.members - a.members);
  return out.sort((a, b) => COMPARE[sort](forms.get(a.id) ?? NO_FORM, forms.get(b.id) ?? NO_FORM));
}

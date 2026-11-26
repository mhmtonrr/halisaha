// Keşfet "Gruplar" ve "Adam arayan" sıralamaları (saf, testli)

export const GROUP_SORTS = [
  { value: "onerilen", label: "Katılabileceklerim önce" },
  { value: "uye", label: "En çok üye" },
  { value: "isim", label: "İsim (A-Z)" },
] as const;
export type GroupSort = (typeof GROUP_SORTS)[number]["value"];

export const CALL_SORTS = [
  { value: "tarih", label: "En yakın tarih" },
  { value: "cok", label: "En çok oyuncu aranan" },
  { value: "az", label: "Tamamlanmaya en yakın" },
] as const;
export type CallSort = (typeof CALL_SORTS)[number]["value"];

/** Geçersiz ya da boş değer ilk (varsayılan) seçenek sayılır */
const parse = <T extends string>(options: readonly { value: T }[], v: string | undefined): T => options.find((o) => o.value === v)?.value ?? options[0].value;
export const parseGroupSort = (v: string | undefined): GroupSort => parse(GROUP_SORTS, v);
export const parseCallSort = (v: string | undefined): CallSort => parse(CALL_SORTS, v);

export function sortGroups<T extends { name: string; member_count: number; accepts_requests: boolean; is_member: boolean }>(list: T[], sort: GroupSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "tr");
  const open = (g: T) => Number(g.accepts_requests && !g.is_member);
  return [...list].sort((a, b) =>
    sort === "uye" ? b.member_count - a.member_count || byName(a, b)
    : sort === "isim" ? byName(a, b)
    : open(b) - open(a) || byName(a, b),
  );
}

export function sortCalls<T extends { played_at: string; capacity: number | null; roster_count: number }>(list: T[], sort: CallSort): T[] {
  const left = (c: T) => Math.max((c.capacity ?? 0) - c.roster_count, 0);
  const byDate = (a: T, b: T) => a.played_at.localeCompare(b.played_at);
  return [...list].sort((a, b) =>
    sort === "cok" ? left(b) - left(a) || byDate(a, b)
    : sort === "az" ? left(a) - left(b) || byDate(a, b)
    : byDate(a, b),
  );
}

/** `in (...)` listelerinin URL'yi şişirmemesi için parça boyutu; Supabase tek seferde en fazla 1000 satır döndürür */
const IN_CHUNK = 100;
const PAGE = 1000;

export const chunks = <T,>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** `in (...)` sorgusunu parçalara bölüp sayfalayarak hepsini çeker */
export async function fetchIn<T>(
  ids: string[],
  build: (part: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunks(ids, IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(part, from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

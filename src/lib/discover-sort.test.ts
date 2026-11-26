import { describe, expect, it } from "vitest";
import { parseCallSort, parseGroupSort, sortCalls, sortGroups } from "./discover-sort";

const g = (name: string, member_count: number, accepts_requests = false) => ({ name, member_count, accepts_requests, is_member: false });
const c = (id: string, played_at: string, roster_count: number) => ({ id, played_at, roster_count, capacity: 14 });

describe("Keşfet grup ve ilan sıralaması", () => {
  const groups = [g("Çınar", 3), g("Ada", 5), g("Bora", 9, true)];
  const names = (s: Parameters<typeof sortGroups>[1]) => sortGroups(groups, s).map((x) => x.name);
  it("gruplar", () => {
    expect(names("onerilen")).toEqual(["Bora", "Ada", "Çınar"]);
    expect(names("uye")).toEqual(["Bora", "Ada", "Çınar"]);
    expect(names("isim")).toEqual(["Ada", "Bora", "Çınar"]);
  });
  const calls = [c("x", "2026-12-03", 13), c("y", "2026-12-01", 10), c("z", "2026-12-02", 5)];
  const ids = (s: Parameters<typeof sortCalls>[1]) => sortCalls(calls, s).map((x) => x.id);
  it("adam arayan maçlar", () => {
    expect(ids("tarih")).toEqual(["y", "z", "x"]);
    expect(ids("cok")).toEqual(["z", "y", "x"]);
    expect(ids("az")).toEqual(["x", "y", "z"]);
  });
  it("geçersiz değer varsayılana döner", () => {
    expect(parseGroupSort("x")).toBe("onerilen");
    expect(parseCallSort(undefined)).toBe("tarih");
  });
});

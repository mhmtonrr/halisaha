import { describe, expect, it } from "vitest";
import { computeSkills, emptySkills, SKILL_CONFIG, type SkillBallot } from "./skills";

const ballot = (i: number, voter: string, picked: boolean, k = 13): SkillBallot => ({
  voterKey: voter,
  matchId: `m${i}`,
  picked: { HIZ: picked },
  candidates: { HIZ: k },
});
const hiz = (b: SkillBallot[]) => computeSkills(b, false).find((s) => s.key === "HIZ")!;

describe("computeSkills", () => {
  it("oy yoksa tüm değerler boş", () => {
    expect(computeSkills([], false).every((s) => s.value === null)).toBe(true);
    expect(emptySkills(true).map((s) => s.key)).toEqual(["REF", "ATL", "HAV", "YER", "DAĞ", "İLT"]);
  });

  it("tek oy veren veya tek maç yetmez", () => {
    expect(hiz([ballot(1, "a", true), ballot(2, "a", true)]).value).toBeNull();
    expect(hiz([ballot(1, "a", true), ballot(1, "b", true)]).value).toBeNull();
    expect(hiz([ballot(1, "a", true), ballot(2, "b", true)]).value).not.toBeNull();
  });

  it("işaret alan ortalamanın üstünde, almayan altında", () => {
    const up = hiz([ballot(1, "a", true), ballot(2, "b", true)]).value!;
    const down = hiz([ballot(1, "a", false), ballot(2, "b", false)]).value!;
    expect(up).toBeGreaterThan(SKILL_CONFIG.BASE);
    expect(down).toBeLessThan(SKILL_CONFIG.BASE);
  });

  it("çok oyda hep işaret alan 99'a, hiç almayan 40'a yaklaşır; sınırlar aşılmaz", () => {
    const many = Array.from({ length: 30 }, (_, i) => ballot(i, `v${i % 6}`, true));
    const none = Array.from({ length: 30 }, (_, i) => ballot(i, `v${i % 6}`, false));
    expect(hiz(many).value).toBe(99);
    expect(hiz(none).value).toBe(40);
  });

  it("kategori adayı yoksa o oy sayılmaz", () => {
    const b: SkillBallot[] = [ballot(1, "a", true, 0), ballot(2, "b", true, 0)];
    expect(hiz(b).value).toBeNull();
  });

  it("küçük kadroda (aday azken) beklenen işaret yüksektir, aynı işaret daha az değer kazandırır", () => {
    const small = hiz([ballot(1, "a", true, 3), ballot(2, "b", true, 3)]).value!;
    const big = hiz([ballot(1, "a", true, 13), ballot(2, "b", true, 13)]).value!;
    expect(big).toBeGreaterThan(small);
  });

  it("tek adaylı kategoride (maçta tek kaleci) seçilmemek ağır ceza değildir, çoğunluk işareti ödüllendirilir", () => {
    const kept = (picks: boolean[]) =>
      computeSkills(picks.map((p, i) => ({ voterKey: `v${i}`, matchId: `m${i % 2}`, picked: { REF: p }, candidates: { REF: 1 } })), true).find((s) => s.key === "REF")!.value!;
    expect(kept([true, true, false])).toBeGreaterThan(SKILL_CONFIG.BASE);
    expect(kept([true, false, false])).toBeLessThan(SKILL_CONFIG.BASE);
    expect(kept([false, false, false])).toBeGreaterThan(40);
  });

  it("kaleciye kaleci kategorileri döner", () => {
    expect(computeSkills([], true).map((s) => s.key)).toEqual(["REF", "ATL", "HAV", "YER", "DAĞ", "İLT"]);
  });
});

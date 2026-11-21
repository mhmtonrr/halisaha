import { describe, expect, it } from "vitest";
import { computeSkills, emptySkills, isMutualHigh, SKILL_CONFIG, voterNorm, type Scores, type SkillRating } from "./skills";

/** Bir oy verenin tüm verdiği puanlardan (hedefler) normalizasyon kurup hedefe verdiğini döndürür */
const rating = (voterKey: string, toTarget: Scores, others: Scores[] = []): SkillRating => ({
  voterKey,
  scores: toTarget,
  norm: voterNorm([toTarget, ...others]),
});
const hiz = (rs: SkillRating[]) => computeSkills(rs, false).find((s) => s.key === "HIZ")!;
const others = (...xs: number[]): Scores[] => xs.map((x) => ({ HIZ: x }));

describe("computeSkills", () => {
  it("puan yoksa tüm değerler boş", () => {
    expect(computeSkills([], false).every((s) => s.value === null)).toBe(true);
    expect(emptySkills(true).map((s) => s.key)).toEqual(["REF", "ATL", "HAV", "YER", "DAĞ", "İLT"]);
  });

  it("tek oy veren yetmez, iki farklı oy veren yeter", () => {
    expect(hiz([rating("a", { HIZ: 9 }, others(5, 5))]).value).toBeNull();
    expect(hiz([rating("a", { HIZ: 9 }, others(5, 5)), rating("a", { HIZ: 9 }, others(5, 5))]).value).toBeNull();
    expect(hiz([rating("a", { HIZ: 9 }, others(5, 5)), rating("b", { HIZ: 9 }, others(5, 5))]).value).not.toBeNull();
  });

  it("diğerlerinden yüksek puan alan ortalamanın üstünde, düşük alan altında", () => {
    const up = hiz([rating("a", { HIZ: 9 }, others(5, 5, 5)), rating("b", { HIZ: 9 }, others(5, 6, 5))]).value!;
    const down = hiz([rating("a", { HIZ: 3 }, others(7, 7, 7)), rating("b", { HIZ: 3 }, others(7, 6, 7))]).value!;
    expect(up).toBeGreaterThan(SKILL_CONFIG.BASE + 5);
    expect(down).toBeLessThan(SKILL_CONFIG.BASE - 5);
  });

  it("herkese 9 veren cömert oy veren ile herkese 5 veren cimri oy veren aynı oyuncuyu ortalama görür", () => {
    const generous = rating("a", { HIZ: 9 }, others(9, 9, 9, 9));
    const stingy = rating("b", { HIZ: 5 }, others(5, 5, 5, 5));
    expect(Math.abs(hiz([generous, stingy]).value! - SKILL_CONFIG.BASE)).toBeLessThanOrEqual(2);
  });

  it("yeterince puan vermiş cömert ve cimri oy verenin ayırdığı oyuncu aynı değeri alır", () => {
    const eight = Array(14).fill(8), four = Array(14).fill(4);
    const gen = hiz([rating("a", { HIZ: 10 }, others(...eight)), rating("b", { HIZ: 10 }, others(...eight))]).value!;
    const stn = hiz([rating("a", { HIZ: 6 }, others(...four)), rating("b", { HIZ: 6 }, others(...four))]).value!;
    // Ham puanlar 10 ve 6 (fark 4 puan ≈ 40 değer puanı olurdu); normalizasyon farkı birkaç puana indirir.
    // Kalan küçük fark, az puanlı oy verenin tarafsız ortalamaya (6) çekilmesinden gelir.
    expect(Math.abs(gen - stn)).toBeLessThanOrEqual(8);
  });

  it("az puan vermiş oy verenin normalizasyonu tarafsız ön bilgiye yaslanır (veri azken güvenme)", () => {
    const eight = Array(3).fill(8);
    const few = hiz([rating("a", { HIZ: 10 }, others(...eight)), rating("b", { HIZ: 10 }, others(...eight))]).value!;
    expect(few).toBeGreaterThan(SKILL_CONFIG.BASE);
    expect(few).toBeLessThan(99);
  });

  it("az puan veren oy verenin tek puanı ağır basmaz (ortalamaya çekilir)", () => {
    const few = hiz([rating("a", { HIZ: 10 }), rating("b", { HIZ: 10 })]).value!;
    const many = hiz([rating("a", { HIZ: 10 }, others(5, 5, 5, 5, 5, 5)), rating("b", { HIZ: 10 }, others(5, 5, 5, 5, 5, 5))]).value!;
    expect(few).toBeLessThan(many);
    expect(few).toBeGreaterThan(SKILL_CONFIG.BASE);
  });

  it("çok oyda değer 40-99 arasında kalır", () => {
    const top = Array.from({ length: 30 }, (_, i) => rating(`v${i}`, { HIZ: 10 }, others(1, 1, 1, 1, 1, 1, 1, 1)));
    const bottom = Array.from({ length: 30 }, (_, i) => rating(`v${i}`, { HIZ: 1 }, others(10, 10, 10, 10, 10, 10, 10, 10)));
    expect(hiz(top).value).toBeLessThanOrEqual(99);
    expect(hiz(bottom).value).toBeGreaterThanOrEqual(40);
    expect(hiz(top).value).toBeGreaterThan(90);
    expect(hiz(bottom).value).toBeLessThan(45);
  });

  it("bilinmeyen (boş) kategori o kategoride oy saymaz", () => {
    const rs = [rating("a", { HIZ: 9 }, others(5, 5)), rating("b", { ŞUT: 9 }, others(5, 5))];
    expect(hiz(rs).value).toBeNull();
    expect(hiz(rs).voters).toBe(1);
  });

  it("klik (karşılıklı yüksek puan) yarım ağırlıkla sayılır", () => {
    const base = (mutual: boolean): SkillRating[] => [
      { ...rating("a", { HIZ: 10 }, others(5, 5, 5, 5)), mutualHigh: mutual },
      rating("b", { HIZ: 5 }, others(5, 5, 5, 5)),
    ];
    expect(hiz(base(true)).value!).toBeLessThan(hiz(base(false)).value!);
    expect(isMutualHigh({ HIZ: 9, ŞUT: 10 }, { PAS: 9 })).toBe(true);
    expect(isMutualHigh({ HIZ: 9 }, { PAS: 6 })).toBe(false);
    expect(isMutualHigh({ HIZ: 9 }, null)).toBe(false);
  });

  it("kaleciye kaleci kategorileri döner", () => {
    expect(computeSkills([], true).map((s) => s.key)).toEqual(["REF", "ATL", "HAV", "YER", "DAĞ", "İLT"]);
  });
});

describe("voterNorm", () => {
  it("hiç puan vermeyen tarafsızdır", () => {
    const n = voterNorm([]);
    expect(n.mean.HIZ).toBe(SKILL_CONFIG.NEUTRAL_MEAN);
    expect(n.sd.HIZ).toBe(SKILL_CONFIG.NEUTRAL_SD);
  });
  it("çok puan verenin ortalaması kendi puanlarına yaklaşır", () => {
    const n = voterNorm(Array.from({ length: 30 }, () => ({ HIZ: 9 })));
    expect(n.mean.HIZ!).toBeGreaterThan(8.7);
  });
});

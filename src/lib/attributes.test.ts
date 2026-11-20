import { describe, expect, it } from "vitest";
import { computeAttributes, totals, type MatchRecord } from "./attributes";

const rec = (i: number, over: Partial<MatchRecord> = {}): MatchRecord => ({
  matchId: `m${i}`,
  playedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
  goals: 0,
  assists: 0,
  saves: 0,
  outcome: "draw",
  matchScore: 6.5,
  weight: 1,
  mvp: false,
  kind: "internal",
  opponentName: null,
  position: null,
  ...over,
});

const get = (attrs: ReturnType<typeof computeAttributes>, key: string) =>
  attrs.find((a) => a.key === key)!.value;

describe("computeAttributes", () => {
  it("maçı olmayan oyuncuda tüm özellikler boş", () => {
    expect(computeAttributes([], false).every((a) => a.value === null)).toBe(true);
  });

  it("form son 5 puanlı maçın ortalaması, eski maçları saymaz", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) => rec(i, { matchScore: 4 })),
      ...Array.from({ length: 5 }, (_, i) => rec(10 + i, { matchScore: 8 })),
    ];
    expect(get(computeAttributes(records, false), "FRM")).toBe(80);
  });

  it("yeterli oy almamış maç formu etkilemez", () => {
    const records = [rec(0, { matchScore: 8 }), rec(1, { matchScore: 2, weight: 0 })];
    expect(get(computeAttributes(records, false), "FRM")).toBe(80);
  });

  it("istikrarlı oyuncunun istikrarı, inişli çıkışlıdan yüksek", () => {
    const steady = [7, 7, 7, 7].map((s, i) => rec(i, { matchScore: s }));
    const swingy = [3, 10, 4, 9].map((s, i) => rec(i, { matchScore: s }));
    expect(get(computeAttributes(steady, false), "IST")!).toBeGreaterThan(
      get(computeAttributes(swingy, false), "IST")!,
    );
    expect(get(computeAttributes(steady.slice(0, 2), false), "IST")).toBeNull();
  });

  it("gol özelliği maç başına gole göre artar, 40-99 arasında kalır", () => {
    const none = computeAttributes([rec(0), rec(1)], false);
    const some = computeAttributes([rec(0, { goals: 2 }), rec(1, { goals: 2 })], false);
    const lots = computeAttributes([rec(0, { goals: 30 })], false);
    expect(get(none, "GOL")).toBe(40);
    expect(get(some, "GOL")!).toBeGreaterThan(70);
    expect(get(lots, "GOL")).toBe(99);
  });

  it("kalecide gol yerine kurtarış gösterilir", () => {
    const attrs = computeAttributes([rec(0, { saves: 8 })], true);
    expect(attrs.some((a) => a.key === "GOL")).toBe(false);
    expect(get(attrs, "KRT")!).toBeGreaterThan(80);
  });

  it("galibiyet ve MVP oranları", () => {
    const records = [
      rec(0, { outcome: "win", mvp: true }),
      rec(1, { outcome: "win" }),
      rec(2, { outcome: "loss" }),
      rec(3, { outcome: "draw" }),
    ];
    const attrs = computeAttributes(records, false);
    expect(get(attrs, "GAL")).toBe(Math.round(40 + 59 * 0.5));
    expect(get(attrs, "MVP")).toBe(Math.round(40 + 59 * 0.625));
    expect(totals(records)).toMatchObject({ played: 4, wins: 2, draws: 1, losses: 1, mvps: 1 });
  });
});

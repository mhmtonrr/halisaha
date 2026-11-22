import { describe, expect, it } from "vitest";
import { computeBadges } from "./badges";
import type { MatchRecord } from "./attributes";

let n = 0;
const m = (over: Partial<MatchRecord> = {}): MatchRecord => {
  n++;
  return {
    matchId: `m${n}`,
    playedAt: `2026-01-${String(n).padStart(2, "0")}T18:00:00Z`,
    goals: 0, assists: 0, saves: 0, outcome: "draw", matchScore: null, weight: 0,
    mvp: false, kind: "internal", opponentName: null, position: null, ...over,
  };
};
const ids = (r: MatchRecord[], ns = 0) => computeBadges(r, ns).map((b) => b.id);

describe("computeBadges", () => {
  it("maçsız oyuncunun rozeti yok", () => expect(ids([])).toEqual([]));
  it("hat-trick sayısını verir", () => {
    const b = computeBadges([m({ goals: 3 }), m({ goals: 4 }), m({ goals: 2 })], 0).find((x) => x.id === "hattrick");
    expect(b?.value).toBe("x2 kez");
  });
  it("yenilmezlik: mağlubiyet seriyi böler", () => {
    const five = [1, 2, 3, 4, 5].map(() => m({ outcome: "win" }));
    expect(ids(five)).toContain("unbeaten");
    const broken = [m(), m(), m({ outcome: "loss" }), m(), m()];
    expect(ids(broken)).not.toContain("unbeaten");
  });
  it("MVP: 3'te avcı, 10'da efendi (ikisi birden değil)", () => {
    expect(ids([1, 2, 3].map(() => m({ mvp: true })))).toContain("mvp3");
    const ten = ids(Array.from({ length: 10 }, () => m({ mvp: true })));
    expect(ten).toContain("mvp10");
    expect(ten).not.toContain("mvp3");
  });
  it("tam güvenilir: 10 maç ve 0 gelmemezlik", () => {
    const ten = Array.from({ length: 10 }, () => m());
    expect(ids(ten, 0)).toContain("reliable");
    expect(ids(ten, 1)).not.toContain("reliable");
  });
});

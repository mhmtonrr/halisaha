import { describe, expect, it } from "vitest";
import { balanceTeams, pickVariant, type TeamCandidate } from "./teams";

const squad = (ratings: number[], gk: number[] = []): TeamCandidate[] =>
  ratings.map((overall, i) => ({
    id: `p${i + 1}`,
    overall,
    isGoalkeeper: gk.includes(i),
  }));

describe("balanceTeams", () => {
  it.each([10, 14, 16, 22])("%i kişiyi eşit sayıda iki takıma böler", (n) => {
    const players = squad(Array.from({ length: n }, (_, i) => 50 + i * 2));
    const [best] = balanceTeams(players);
    expect(best.teamA.length).toBe(n / 2);
    expect(best.teamB.length).toBe(n / 2);
    expect(best.difference).toBeLessThan(1);
    const all = [...best.teamA, ...best.teamB].map((p) => p.id).sort();
    expect(all).toEqual(players.map((p) => p.id).sort());
  });

  it("8'e 8 için mümkün olan en dengeli bölünmeyi bulur", () => {
    const players = squad([90, 85, 80, 75, 72, 70, 68, 66, 64, 62, 60, 58, 55, 52, 50, 45]);
    const [best] = balanceTeams(players);
    expect(best.difference).toBeLessThanOrEqual(0.25);
  });

  it("tek sayıda oyuncuda eksik takıma daha güçlü oyuncular verir", () => {
    const players = squad(Array.from({ length: 15 }, (_, i) => 50 + i * 3));
    const [best] = balanceTeams(players);
    const small = best.teamA.length < best.teamB.length ? best : { ...best, averageA: best.averageB, averageB: best.averageA, teamA: best.teamB, teamB: best.teamA };
    expect(small.teamA.length).toBe(7);
    expect(small.teamB.length).toBe(8);
    expect(small.averageA - small.averageB).toBeGreaterThan(2);
  });

  it("iki kaleciyi farklı takımlara koyar", () => {
    // Kaleciler en güçlü iki oyuncu: dengeye rağmen ayrılmalı
    const players = squad([95, 94, 60, 60, 60, 60, 60, 60, 60, 60], [0, 1]);
    for (const split of balanceTeams(players)) {
      const gkA = split.teamA.filter((p) => p.isGoalkeeper).length;
      const gkB = split.teamB.filter((p) => p.isGoalkeeper).length;
      expect(gkA).toBe(1);
      expect(gkB).toBe(1);
    }
  });

  it("mevkileri iki takıma dengeli dağıtır", () => {
    // 4 defans, 4 forvet; hepsi aynı güçte olsa da defanslar tek takıma yığılmamalı
    const players: TeamCandidate[] = [
      ...[70, 70, 70, 70].map((o, i) => ({ id: `d${i}`, overall: o, position: "DEF" })),
      ...[70, 70, 70, 70].map((o, i) => ({ id: `f${i}`, overall: o, position: "FWD" })),
    ];
    for (const split of balanceTeams(players, 5)) {
      const defA = split.teamA.filter((p) => p.position === "DEF").length;
      expect(defA).toBe(2);
    }
  });

  it("güç farkı büyükse mevki dengesi için gücü feda etmez", () => {
    // İki çok güçlü defans: aynı takıma düşmeleri 2 OVR'den fazla dengesizlik yaratır
    const players: TeamCandidate[] = [
      { id: "a", overall: 90, position: "DEF" },
      { id: "b", overall: 90, position: "DEF" },
      { id: "c", overall: 50, position: "DEF" },
      { id: "d", overall: 50, position: "DEF" },
      { id: "e", overall: 60, position: "FWD" },
      { id: "f", overall: 60, position: "FWD" },
    ];
    const [best] = balanceTeams(players);
    expect(best.difference).toBeLessThanOrEqual(1);
  });

  it("çok kalabalık kadroda da çalışır", () => {
    const players = squad(Array.from({ length: 30 }, (_, i) => 45 + ((i * 37) % 50)), [0, 1]);
    const [best] = balanceTeams(players);
    expect(best.teamA.length).toBe(15);
    expect(best.difference).toBeLessThan(2);
  });

  it("pickVariant toleransın dışındaki bölünmeyi seçmez", () => {
    const players = squad([80, 78, 75, 70, 68, 65, 60, 58, 55, 50]);
    const splits = balanceTeams(players);
    for (let i = 0; i < 20; i++) {
      const v = pickVariant(splits, 1);
      expect(v.difference).toBeLessThanOrEqual(splits[0].difference + 1);
    }
  });
});

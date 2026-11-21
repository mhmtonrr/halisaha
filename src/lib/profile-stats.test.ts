import { describe, expect, it } from "vitest";
import { computeProfileStats, streakText, type ProfileMatch } from "./profile-stats";

let n = 0;
const m = (over: Partial<ProfileMatch> = {}): ProfileMatch => {
  n++;
  return {
    matchId: `m${n}`,
    playedAt: `2026-03-${String(n).padStart(2, "0")}T18:00:00Z`,
    goals: 0,
    assists: 0,
    saves: 0,
    outcome: "draw",
    matchScore: null,
    weight: 0,
    mvp: false,
    kind: "internal",
    opponentName: null,
    position: null,
    groupId: "g1",
    groupName: "Grup",
    groupKind: "community",
    scoreUs: 1,
    scoreThem: 1,
    status: "closed",
    ...over,
  };
};

describe("computeProfileStats", () => {
  it("maçı olmayanda her şey boş", () => {
    const s = computeProfileStats([]);
    expect(s.totals.played).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.avgScore).toBeNull();
    expect(s.best).toBeNull();
    expect(s.form).toEqual([]);
    expect(s.byGroup).toEqual([]);
  });

  it("toplamlar, galibiyet yüzdesi ve maç başı ortalamalar", () => {
    const s = computeProfileStats([
      m({ outcome: "win", goals: 2, assists: 1 }),
      m({ outcome: "win", goals: 1 }),
      m({ outcome: "loss", assists: 1, mvp: true }),
      m({ outcome: "draw" }),
    ]);
    expect(s.totals).toMatchObject({ played: 4, goals: 3, assists: 2, wins: 2, losses: 1, draws: 1, mvps: 1 });
    expect(s.winRate).toBe(50);
    expect(s.goalsPerMatch).toBeCloseTo(0.75);
    expect(s.assistsPerMatch).toBeCloseTo(0.5);
    expect(s.mvpRate).toBe(25);
  });

  it("ortalama puan sadece yeterli oy almış maçlardan; en iyi maç en yüksek puanlı", () => {
    const a = m({ matchScore: 8, weight: 1 });
    const b = m({ matchScore: 6, weight: 1 });
    const c = m({ matchScore: 10, weight: 0 }); // yeterli oy yok: sayılmaz
    const s = computeProfileStats([a, b, c]);
    expect(s.avgScore).toBe(7);
    expect(s.best?.matchId).toBe(a.matchId);
  });

  it("form son 5 maç, en yeni başta; seri en yeniden geriye sayılır", () => {
    const list = [
      m({ outcome: "loss" }),
      m({ outcome: "win" }),
      m({ outcome: "win" }),
      m({ outcome: "draw" }),
      m({ outcome: "win" }),
      m({ outcome: "win" }),
    ];
    const s = computeProfileStats(list);
    expect(s.form).toEqual(["win", "win", "draw", "win", "win"]);
    expect(s.streak).toEqual({ wins: 2, unbeaten: 5 });
    expect(streakText(s.streak)).toBe("2 maçtır üst üste kazanıyor");
  });

  it("anlamlı seri yoksa metin yok", () => {
    expect(streakText({ wins: 1, unbeaten: 2 })).toBeNull();
    expect(streakText({ wins: 0, unbeaten: 3 })).toBe("3 maçtır yenilmiyor");
  });

  it("son maçı kaybedenin serisi sıfır", () => {
    const s = computeProfileStats([m({ outcome: "win" }), m({ outcome: "win" }), m({ outcome: "loss" })]);
    expect(s.streak).toEqual({ wins: 0, unbeaten: 0 });
  });

  it("rakip ve kendi aramızda maçlar ayrı sayılır", () => {
    const s = computeProfileStats([
      m({ kind: "external", outcome: "win" }),
      m({ kind: "external", outcome: "loss" }),
      m({ kind: "internal", outcome: "win" }),
    ]);
    expect(s.external).toEqual({ played: 2, wins: 1, draws: 0, losses: 1 });
    expect(s.internal).toEqual({ played: 1, wins: 1, draws: 0, losses: 0 });
  });

  it("grup bazında döküm, en çok oynanan başta", () => {
    const s = computeProfileStats([
      m({ groupId: "a", groupName: "Takım", groupKind: "team", outcome: "win", goals: 2 }),
      m({ groupId: "b", groupName: "Mahalle", outcome: "loss", assists: 1 }),
      m({ groupId: "b", groupName: "Mahalle", outcome: "win", goals: 1 }),
    ]);
    expect(s.byGroup.map((g) => g.name)).toEqual(["Mahalle", "Takım"]);
    expect(s.byGroup[0]).toMatchObject({ played: 2, wins: 1, losses: 1, goals: 1, assists: 1 });
    expect(s.byGroup[1]).toMatchObject({ kind: "team", goals: 2 });
  });

  it("mevkiler sayıya göre sıralanır, mevkisiz maç sayılmaz", () => {
    const s = computeProfileStats([m({ position: "MID" }), m({ position: "DEF" }), m({ position: "MID" }), m()]);
    expect(s.byPosition).toEqual([
      { position: "MID", count: 2 },
      { position: "DEF", count: 1 },
    ]);
  });

  it("puan grafiği son 10 puanlı maçı eskiden yeniye verir", () => {
    const list = Array.from({ length: 12 }, (_, i) => m({ matchScore: i + 1, weight: 1 }));
    const s = computeProfileStats(list);
    expect(s.recentScores).toHaveLength(10);
    expect(s.recentScores[0].score).toBe(3);
    expect(s.recentScores[9].score).toBe(12);
  });
});

import { describe, expect, it } from "vitest";
import { rankFeaturedPlayers, regionLabel, teamForms } from "./featured-rules";

describe("regionLabel", () => {
  it("bölge adları", () => {
    expect(regionLabel("Kırklareli", "Lüleburgaz")).toBe("Lüleburgaz, Kırklareli");
    expect(regionLabel("Kırklareli", null)).toBe("Kırklareli");
    expect(regionLabel(null, null)).toBe("Tüm Türkiye");
  });
});

describe("teamForms", () => {
  it("seri ilk yenilgide/beraberlikte durur; eski maçlar etkinliğe girmez", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const row = (playedAt: string, won: boolean) => ({ teamId: "a", playedAt, won });
    const f = teamForms([row("2026-09-01T18:00:00Z", true), row("2026-11-20T18:00:00Z", true), row("2026-11-10T18:00:00Z", false), row("2026-11-24T18:00:00Z", true)], now);
    expect(f.get("a")).toMatchObject({ streak: 2, recent: 3, played: 4, wins: 3, losses: 1 });
  });
});

describe("rankFeaturedPlayers", () => {
  it("çok maçlılar önce, sonra puanlı maçı olanlar, en sonda maçı olmayanlar", () => {
    const list = [
      { id: "yeni", matches: 0, overall: 65 },
      { id: "tek", matches: 1, overall: 90 },
      { id: "usta", matches: 5, overall: 70 },
      { id: "iki", matches: 2, overall: 60 },
      { id: "usta2", matches: 3, overall: 80 },
    ];
    expect(rankFeaturedPlayers(list).map((p) => p.id)).toEqual(["usta2", "usta", "tek", "iki", "yeni"]);
  });
  it("bölgede sadece az maçlı ve maçsız oyuncu varsa hepsi listede kalır (Lüleburgaz durumu)", () => {
    const list = [0, 0, 2, 0, 2].map((matches, i) => ({ id: String(i), matches, overall: 65 }));
    expect(rankFeaturedPlayers(list)).toHaveLength(5);
    expect(rankFeaturedPlayers(list).slice(0, 2).every((p) => p.matches === 2)).toBe(true);
  });
});

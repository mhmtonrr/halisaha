import { describe, expect, it } from "vitest";
import { availableLevels, levelLabel, rankFeaturedPlayers } from "./featured-rules";

describe("availableLevels", () => {
  it("ilçe, il ve Türkiye", () => {
    expect(availableLevels("Kırklareli", "Lüleburgaz")).toEqual(["ilce", "il", "tr"]);
    expect(availableLevels("Kırklareli", null)).toEqual(["il", "tr"]);
    expect(availableLevels(null, null)).toEqual(["tr"]);
  });
});

describe("levelLabel", () => {
  it("bölge adları", () => {
    expect(levelLabel("ilce", "Kırklareli", "Lüleburgaz")).toBe("Lüleburgaz");
    expect(levelLabel("il", "Kırklareli", "Lüleburgaz")).toBe("Kırklareli");
    expect(levelLabel("tr", "Kırklareli", "Lüleburgaz")).toBe("Türkiye");
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

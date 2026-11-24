import { describe, expect, it } from "vitest";
import { availableLevels, levelChain, levelLabel, pickSection, rankFeaturedPlayers } from "./featured-rules";

describe("availableLevels", () => {
  it("ilçe, il ve Türkiye", () => {
    expect(availableLevels("Kırklareli", "Lüleburgaz")).toEqual(["ilce", "il", "tr"]);
    expect(availableLevels("Kırklareli", null)).toEqual(["il", "tr"]);
    expect(availableLevels(null, null)).toEqual(["tr"]);
  });
});

describe("levelChain", () => {
  it("seçilenden yukarı", () => {
    expect(levelChain("ilce", "Kırklareli", "Lüleburgaz")).toEqual(["ilce", "il", "tr"]);
    expect(levelChain("il", "Kırklareli", "Lüleburgaz")).toEqual(["il", "tr"]);
  });
  it("kullanılamayan kademe Türkiye'ye düşer", () => {
    expect(levelChain("ilce", null, null)).toEqual(["tr"]);
  });
});

describe("pickSection", () => {
  const data: Record<string, number[]> = { ilce: [1], il: [1, 2, 3], tr: [1, 2, 3, 4] };
  const load = async (l: string) => data[l];
  it("yeterli kaydı olan ilk kademe", async () => {
    expect(await pickSection(["ilce", "il", "tr"], load, 3)).toEqual({ items: [1, 2, 3], level: "il" });
  });
  it("hiçbiri yetmezse en geniş kademe", async () => {
    expect(await pickSection(["ilce", "il", "tr"], load, 9)).toEqual({ items: [1, 2, 3, 4], level: "tr" });
  });
  it("ilk kademe yeterliyse üst kademeyi yüklemez", async () => {
    const asked: string[] = [];
    await pickSection(["il", "tr"], async (l) => (asked.push(l), data[l]), 3);
    expect(asked).toEqual(["il"]);
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

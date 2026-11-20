import { describe, expect, it } from "vitest";
import { teamRating } from "./teams-data";

describe("teamRating", () => {
  it("boş kadroda varsayılan 65", () => expect(teamRating([])).toBe(65));
  it("en iyi 7 oyuncunun ortalaması; yedekler puanı düşürmez", () => {
    const starters = [80, 78, 76, 74, 72, 70, 68];
    expect(teamRating(starters)).toBe(74);
    expect(teamRating([...starters, 50, 45, 40])).toBe(74);
  });
  it("7'den az oyuncuda hepsinin ortalaması", () => expect(teamRating([70, 60])).toBe(65));
});

import { describe, expect, it } from "vitest";
import { PROVINCES, formatRegion, isProvince } from "./regions";

describe("regions", () => {
  it("81 il var ve tekrar yok", () => {
    expect(PROVINCES.length).toBe(81);
    expect(new Set(PROVINCES).size).toBe(81);
  });
  it("Türkçe alfabetik sıralı", () => {
    const sorted = [...PROVINCES].sort((a, b) => a.localeCompare(b, "tr"));
    expect([...PROVINCES]).toEqual(sorted);
  });
  it("il doğrulama ve bölge yazımı", () => {
    expect(isProvince("İstanbul")).toBe(true);
    expect(isProvince("Istanbul")).toBe(false);
    expect(formatRegion("İstanbul", "Kadıköy")).toBe("Kadıköy, İstanbul");
    expect(formatRegion("Ankara", null)).toBe("Ankara");
  });
});

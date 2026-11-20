import { describe, expect, it } from "vitest";
import { DISTRICTS, PROVINCES, canonicalDistrict, districtsOf, formatRegion, isProvince } from "./regions";

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

  it("her ilin ilçe listesi var; toplam 973 ilçe", () => {
    expect(Object.keys(DISTRICTS).sort()).toEqual([...PROVINCES].sort());
    expect(Object.values(DISTRICTS).flat().length).toBe(973);
    expect(districtsOf("İstanbul")).toHaveLength(39);
    expect(districtsOf("Ankara")).toHaveLength(25);
    expect(districtsOf("İzmir")).toHaveLength(30);
    expect(districtsOf("İstanbul")).toContain("Kadıköy");
    expect(districtsOf("Kırıkkale")).toContain("Bahşılı");
  });
  it("ilçeler Türkçe alfabetik sıralı", () => {
    for (const list of Object.values(DISTRICTS))
      expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, "tr")));
  });
  it("ilçe doğrulama ile bağlı", () => {
    expect(canonicalDistrict("İstanbul", "kadıköy")).toBe("Kadıköy");
    expect(canonicalDistrict("İstanbul", "Çankaya")).toBeNull();
    expect(canonicalDistrict("Ankara", "Çankaya")).toBe("Çankaya");
    expect(canonicalDistrict(null, "Kadıköy")).toBeNull();
  });
});

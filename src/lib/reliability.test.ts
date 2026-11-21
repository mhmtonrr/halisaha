import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, reliability } from "@/lib/reliability";

describe("güvenilirlik", () => {
  it("hiç kaydı olmayan yeni oyuncudur", () => {
    expect(reliability(0, 0)).toMatchObject({ pct: null, tone: "new" });
  });
  it("hiç gelmeyen kaçırmamış oyuncu %100", () => {
    expect(reliability(8, 0)).toMatchObject({ pct: 100, tone: "good" });
  });
  it("yüzdeyi oynadığı / toplam olarak hesaplar", () => {
    expect(reliability(9, 1).pct).toBe(90);
    expect(reliability(7, 3).pct).toBe(70);
    expect(reliability(2, 3).pct).toBe(40);
  });
  it("tonlar: ≥%90 iyi, ≥%70 orta, altı kötü", () => {
    expect(reliability(9, 1).tone).toBe("good");
    expect(reliability(7, 3).tone).toBe("ok");
    expect(reliability(5, 5).tone).toBe("bad");
  });
  it("az örnekte yüzde yanıltmasın: 'yeni' tonu ama sayılar görünür", () => {
    const r = reliability(1, 1);
    expect(MIN_SAMPLE).toBe(3);
    expect(r.tone).toBe("new");
    expect(r.label).toContain("1 maç");
    expect(r.label).toContain("1 gelmedi");
    expect(reliability(2, 0).tone).toBe("new"); // 2 maç, az örnek
  });
  it("yeterli örnekte etiket yüzdeyi içerir", () => {
    expect(reliability(10, 0).label).toBe("%100 güvenilir · 10 maç · 0 gelmedi");
  });
});

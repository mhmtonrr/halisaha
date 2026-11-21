import { describe, expect, it } from "vitest";
import {
  SIZES,
  autoLineup,
  buildSlots,
  defaultFormation,
  formationsFor,
  getFormation,
  inferSize,
  isValidSize,
  validAssignment,
  type Candidate,
} from "@/lib/formations";

describe("hazır dizilişler", () => {
  it("5'ten 11'e her kişi sayısı için en az 4 diziliş var", () => {
    expect(SIZES).toEqual([5, 6, 7, 8, 9, 10, 11]);
    for (const n of SIZES) expect(formationsFor(n).length).toBeGreaterThanOrEqual(4);
  });

  it("her dizilişte oyuncu sayısı kişi sayısına eşit (kaleci + hatlar)", () => {
    for (const n of SIZES) {
      for (const f of formationsFor(n)) {
        expect(f.lines.reduce((a, b) => a + b, 0) + 1, `${n}: ${f.id}`).toBe(n);
        expect(f.slots).toHaveLength(n);
      }
    }
  });

  it("slot sırası ardışık, ilk slot kaleci, kalan roller savunmadan hücuma", () => {
    for (const n of SIZES) {
      for (const f of formationsFor(n)) {
        expect(f.slots.map((s) => s.index)).toEqual(f.slots.map((_, i) => i));
        expect(f.slots[0].role).toBe("GK");
        const order = ["DEF", "MID", "FWD"];
        const roles = f.slots.slice(1).map((s) => order.indexOf(s.role));
        expect(roles).toEqual([...roles].sort((a, b) => a - b));
      }
    }
  });

  it("koordinatlar sahanın içinde ve hiçbir iki oyuncu üst üste değil", () => {
    for (const n of SIZES) {
      for (const f of formationsFor(n)) {
        const seen = new Set<string>();
        for (const s of f.slots) {
          expect(s.x).toBeGreaterThan(0);
          expect(s.x).toBeLessThan(100);
          expect(s.y).toBeGreaterThan(0);
          expect(s.y).toBeLessThan(100);
          const key = `${s.x},${s.y}`;
          expect(seen.has(key), `${f.id} ${key}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it("kale altta, hücum yukarıda: kaleci en büyük y, forvet en küçük y", () => {
    const f = getFormation(7, "2-3-1")!;
    const y = (role: string) => f.slots.filter((s) => s.role === role).map((s) => s.y);
    expect(y("GK")[0]).toBeGreaterThan(Math.max(...y("DEF")));
    expect(Math.max(...y("MID"))).toBeLessThan(Math.min(...y("DEF")));
    expect(y("FWD")[0]).toBeLessThan(Math.min(...y("MID")));
  });

  it("varsayılan ve arama", () => {
    expect(defaultFormation(7).id).toBe("2-3-1");
    expect(defaultFormation(11).id).toBe("4-4-2");
    expect(getFormation(7, "9-9")).toBeNull();
    expect(getFormation(7, "4-4-2")).toBeNull(); // 7 kişilikte 11'lik diziliş yok
  });

  it("tek hatlı diziliş ortada", () => {
    const s = buildSlots([4]);
    expect(s).toHaveLength(5);
    expect(s[1].y).toBe(44);
  });

  it("kişi sayısı doğrulama ve tahmin", () => {
    expect(isValidSize(4)).toBe(false);
    expect(isValidSize(5)).toBe(true);
    expect(isValidSize(12)).toBe(false);
    expect(isValidSize(7.5)).toBe(false);
    expect(isValidSize("7")).toBe(false);
    expect(inferSize(3)).toBe(5);
    expect(inferSize(8)).toBe(8);
    expect(inferSize(20)).toBe(11);
  });
});

describe("otomatik yerleştirme", () => {
  const c = (id: string, position: Candidate["position"], overall = 65): Candidate => ({ id, position, overall });
  const squad = [
    c("gk", "GK", 70), c("d1", "DEF", 66), c("d2", "DEF", 64), c("m1", "MID", 72),
    c("m2", "MID", 68), c("m3", "MID", 60), c("f1", "FWD", 75),
  ];
  const f = getFormation(7, "2-3-1")!;

  it("kaleciyi kaleye, mevkileri kendi hattına dizer", () => {
    const a = autoLineup(squad, f);
    expect(a.gk).toBe(0);
    const roleOf = (id: string) => f.slots[a[id]!].role;
    expect(["d1", "d2"].map(roleOf)).toEqual(["DEF", "DEF"]);
    expect(["m1", "m2", "m3"].map(roleOf)).toEqual(["MID", "MID", "MID"]);
    expect(roleOf("f1")).toBe("FWD");
    expect(validAssignment(a, f)).toBe(true);
  });

  it("kadro fazlaysa yedekte kalanlar null, en uygun/iyi oyuncular sahada", () => {
    const a = autoLineup([...squad, c("m4", "MID", 50), c("d3", "DEF", 40)], f);
    expect(a.m4).toBeNull();
    expect(a.d3).toBeNull();
    expect(Object.values(a).filter((s) => s !== null)).toHaveLength(7);
  });

  it("kadro azsa boş slot kalır, kimse iki yere dizilmez", () => {
    const a = autoLineup(squad.slice(0, 4), f);
    expect(Object.values(a).filter((s) => s !== null)).toHaveLength(4);
    expect(validAssignment(a, f)).toBe(true);
  });

  it("mevkisi bilinmeyenler boş kalan yerleri doldurur", () => {
    const a = autoLineup([c("a", null, 60), c("b", "DEF", 60)], f);
    expect(a.a).toBe(0); // kaleci yok: mevkisi bilinmeyen oyuncu kaleye geçer
    expect(f.slots[a.b!].role).toBe("DEF");
  });

  it("kadroda kaleci yoksa kaleye savunmacı geçer; forvet ve en iyi oyuncular sahada kalır", () => {
    const a = autoLineup([c("def", "DEF", 60), c("fwd", "FWD", 80), c("mid", "MID", 70)], f);
    expect(a.def).toBe(0);
    expect(a.fwd).not.toBe(0);
    expect(a.mid).not.toBe(0);
    // iki savunmacıdan zayıf olan kaleye geçer
    const b = autoLineup([c("strong", "DEF", 80), c("weak", "DEF", 55), c("fwd", "FWD", 70)], f);
    expect(b.weak).toBe(0);
  });

  it("gerçek kaleci her zaman kaleye geçer (rating'i düşük de olsa)", () => {
    const a = autoLineup([c("gk", "GK", 45), c("d", "DEF", 90), c("f", "FWD", 90)], f);
    expect(a.gk).toBe(0);
  });

  it("tercih edilenler eşit uygunlukta sahada kalır (diziliş değişirken)", () => {
    const extra = [c("e1", "MID", 65), c("e2", "MID", 65), c("e3", "MID", 65)];
    const a = autoLineup([...squad.filter((p) => p.id !== "m3"), ...extra], f, ["e2"]);
    expect(a.e2).not.toBeNull();
  });

  it("diziliş değişince slotlar yeni dizilişe göre", () => {
    const f2 = getFormation(7, "3-2-1")!;
    const a = autoLineup(squad, f2, Object.keys(autoLineup(squad, f)));
    const defCount = Object.values(a).filter((s) => s !== null && f2.slots[s].role === "DEF").length;
    expect(defCount).toBe(3);
  });
});

describe("atama doğrulama", () => {
  const f = getFormation(7, "2-3-1")!;
  it("aralık dışı ve çakışan slotları reddeder", () => {
    expect(validAssignment({ a: 0, b: 1 }, f)).toBe(true);
    expect(validAssignment({ a: 0, b: 0 }, f)).toBe(false);
    expect(validAssignment({ a: 7 }, f)).toBe(false);
    expect(validAssignment({ a: -1 }, f)).toBe(false);
    expect(validAssignment({ a: 1.5 }, f)).toBe(false);
    expect(validAssignment({ a: null, b: null }, f)).toBe(true);
  });
});

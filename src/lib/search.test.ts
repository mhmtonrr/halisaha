import { describe, expect, it } from "vitest";
import { trPattern } from "./search";

const match = (q: string, s: string) => new RegExp(trPattern(q), "i").test(s);

describe("trPattern", () => {
  it("i/ı/İ/I ayrımı yapmaz", () => {
    expect(match("ist", "İstanbul Gücü")).toBe(true);
    expect(match("IŞIK", "ışıkspor")).toBe(true);
    expect(match("şişli", "ŞİŞLİ")).toBe(true);
    expect(match("yıldız", "YILDIZSPOR")).toBe(true);
  });
  it("özel karakterleri düz metin sayar", () => {
    expect(match("a.b", "axb")).toBe(false);
    expect(match("(1)", "Takım (1)")).toBe(true);
    expect(() => new RegExp(trPattern("[*\\"))).not.toThrow();
  });
});

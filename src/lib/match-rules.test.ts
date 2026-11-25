import { describe, expect, it } from "vitest";
import { defaultCapacity, matchWhen, opensConfirmed } from "./match-rules";

describe("match-rules", () => {
  it("kapasite: rakibe karşı tek taraf, kendi aramızda iki taraf", () => {
    expect(defaultCapacity("external", 8)).toBe(8);
    expect(defaultCapacity("internal", 8)).toBe(16);
  });
  it("saat belli değilse sadece gün", () => {
    expect(matchWhen("2026-11-27T09:00:00.000Z", true)).toMatch(/saat belli değil$/);
    expect(matchWhen("2026-11-27T18:00:00.000Z", false)).toMatch(/21:00/);
  });
  it("direkt kesin: dolu + saat + (takımda) rakip", () => {
    const base = { count: 8, capacity: 8, hasTime: true, kind: "external" as const, hasOpponent: true };
    expect(opensConfirmed(base)).toBe(true);
    expect(opensConfirmed({ ...base, hasOpponent: false })).toBe(false);
    expect(opensConfirmed({ ...base, hasTime: false })).toBe(false);
    expect(opensConfirmed({ ...base, count: 7 })).toBe(false);
    expect(opensConfirmed({ ...base, kind: "internal", hasOpponent: false, capacity: 8 })).toBe(true);
  });
});

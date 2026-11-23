import { describe, expect, it } from "vitest";
import { daysLeftLabel, rosterCapacity, tierProgress } from "./home";

describe("tierProgress", () => {
  it("gümüşte altına kalan puanı verir", () => {
    expect(tierProgress(67)).toMatchObject({ name: "Gümüş", next: "Altın", left: 8, pct: 20 });
  });
  it("eşik değerleri tierOf ile aynı", () => {
    expect(tierProgress(64).name).toBe("Bronz");
    expect(tierProgress(65).name).toBe("Gümüş");
    expect(tierProgress(75)).toMatchObject({ name: "Altın", next: null, left: 0 });
  });
  it("çubuk 0-100 arasında kalır", () => {
    expect(tierProgress(20).pct).toBe(0);
    expect(tierProgress(120).pct).toBe(100);
  });
});

describe("daysLeftLabel", () => {
  // 2026-11-24 12:00 Türkiye
  const now = Date.parse("2026-11-24T09:00:00Z");
  it("bugün / yarın / n gün", () => {
    expect(daysLeftLabel("2026-11-24T19:00:00Z", now)).toBe("Bugün");
    expect(daysLeftLabel("2026-11-25T18:00:00Z", now)).toBe("Yarın");
    expect(daysLeftLabel("2026-11-28T18:00:00Z", now)).toBe("4 gün kaldı");
  });
  it("Türkiye gece yarısını sayar (UTC değil)", () => {
    // 24 Kas 22:30 UTC = 25 Kas 01:30 Türkiye → yarın
    expect(daysLeftLabel("2026-11-24T22:30:00Z", now)).toBe("Yarın");
  });
  it("geçmiş maçta null", () => {
    expect(daysLeftLabel("2026-11-23T18:00:00Z", now)).toBeNull();
  });
});

describe("rosterCapacity", () => {
  it("kendi aramızda iki taraf, rakibe karşı tek taraf", () => {
    expect(rosterCapacity(7, "internal")).toBe(14);
    expect(rosterCapacity(7, "external")).toBe(7);
    expect(rosterCapacity(null, "internal")).toBeNull();
  });
});

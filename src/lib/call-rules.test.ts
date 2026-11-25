import { describe, expect, it } from "vitest";
import { callWhen, dayTimeToIso, istanbulDate } from "./call-rules";

describe("zaman metinleri", () => {
  it("saat yoksa gün + 'saat belli değil'", () => {
    expect(callWhen({ play_on: "2026-11-27", starts_at: null })).toBe("27 Kas Cuma · saat belli değil");
  });
  it("gün + saat Türkiye saatine çevrilir", () => {
    expect(dayTimeToIso("2026-11-27", "21:00")).toBe("2026-11-27T18:00:00.000Z");
    expect(dayTimeToIso("2026-11-27", "")).toBeNull();
  });
  it("Türkiye günü gece yarısından sonra ertesi gün", () => {
    expect(istanbulDate(Date.parse("2026-11-26T21:30:00Z"))).toBe("2026-11-27");
  });
});

import { describe, expect, it } from "vitest";
import { callWhen, dayTimeToIso, decisionDue, defaultSelection, isoToTime, pendingApplicants, reserveOrder, type Responder } from "./call-rules";

const r = (id: string, answer: Responder["answer"], at: string, status: Responder["status"] = null): Responder => ({
  user_id: id,
  display_name: id,
  answer,
  chosen_position: null,
  preferred_position: null,
  note: null,
  status,
  responded_at: `2026-11-20T10:${at}:00Z`,
  overall: 65,
  played: null,
  no_shows: null,
});

describe("varsayılan seçim", () => {
  const list = [r("c", "yes", "03"), r("a", "yes", "01"), r("m", "maybe", "00"), r("n", "no", "00"), r("b", "yes", "02"), r("x", "yes", "00", "rejected")];
  it("geliyorum diyenler yanıt sırasıyla, kontenjan kadar; belki/gelemem/reddedilen yok", () => {
    expect(defaultSelection(list, 2)).toEqual(["a", "b"]);
  });
  it("kontenjan yoksa tüm geliyorumcular", () => {
    expect(defaultSelection(list, null)).toEqual(["a", "b", "c"]);
  });
});

describe("yedek ve başvuru sırası", () => {
  const list = [r("b", "yes", "05", "reserve"), r("a", "yes", "02", "reserve"), r("s", "yes", "00", "selected"), r("p", "yes", "09"), r("w", "no", "01", "withdrawn")];
  it("yedek: sadece yedekler, yanıt sırasıyla", () => {
    expect(reserveOrder(list).map((x) => x.user_id)).toEqual(["a", "b"]);
  });
  it("bekleyen başvuru: kabul edilmemiş geliyorumcular", () => {
    expect(pendingApplicants(list).map((x) => x.user_id)).toEqual(["a", "b", "p"]);
  });
});

describe("karar zamanı", () => {
  const base = { purpose: "gather" as const, status: "open" as const, play_on: "2026-11-27", starts_at: null, capacity: 10, team_size: 5 };
  it("açık toplama çağrısında karar zamanı geçince uyarı", () => {
    expect(decisionDue({ ...base, decide_by: "2026-11-26T17:00:00Z" }, Date.parse("2026-11-26T18:00:00Z"))).toBe(true);
    expect(decisionDue({ ...base, decide_by: "2026-11-26T17:00:00Z" }, Date.parse("2026-11-26T16:00:00Z"))).toBe(false);
  });
  it("karar zamanı yoksa veya kesinleştiyse uyarı yok", () => {
    expect(decisionDue({ ...base, decide_by: null })).toBe(false);
    expect(decisionDue({ ...base, status: "converted", decide_by: "2020-01-01T00:00:00Z" })).toBe(false);
  });
});

describe("zaman metinleri", () => {
  it("saat yoksa gün + 'saat belli değil'", () => {
    expect(callWhen({ play_on: "2026-11-27", starts_at: null })).toBe("27 Kas Cuma · saat belli değil");
  });
  it("gün + saat Türkiye saatine çevrilir ve geri okunur", () => {
    const iso = dayTimeToIso("2026-11-27", "21:00");
    expect(iso).toBe("2026-11-27T18:00:00.000Z");
    expect(isoToTime(iso)).toBe("21:00");
    expect(dayTimeToIso("2026-11-27", "")).toBeNull();
  });
});

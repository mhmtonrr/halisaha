import { describe, expect, it } from "vitest";
import { decidePoll, minPlayers, pickRoster, pollProgress } from "@/lib/poll-rules";

describe("en az kişi", () => {
  it("kontenjanın %70'i, yukarı yuvarlanır", () => {
    expect(minPlayers(14)).toBe(10);
    expect(minPlayers(10)).toBe(7);
    expect(minPlayers(12)).toBe(9); // 8.4 → 9
    expect(minPlayers(22)).toBe(16); // 15.4 → 16
  });
  it("küçük kontenjanda en az 2", () => {
    expect(minPlayers(2)).toBe(2);
    expect(minPlayers(1)).toBe(2);
  });
});

describe("çağrı kararı", () => {
  it("dolunca süre dolmasa da hemen kurulur", () => {
    expect(decidePoll({ yes: 14, capacity: 14, deadlinePassed: false })).toBe("convert");
    expect(decidePoll({ yes: 16, capacity: 14, deadlinePassed: false })).toBe("convert");
  });
  it("süre dolmadan ve dolmadıysa beklenir", () => {
    expect(decidePoll({ yes: 13, capacity: 14, deadlinePassed: false })).toBe("wait");
    expect(decidePoll({ yes: 1, capacity: 14, deadlinePassed: false })).toBe("wait");
  });
  it("süre bitince %70'e ulaşıldıysa eksik kadroyla da kurulur", () => {
    expect(decidePoll({ yes: 10, capacity: 14, deadlinePassed: true })).toBe("convert");
    expect(decidePoll({ yes: 13, capacity: 14, deadlinePassed: true })).toBe("convert");
  });
  it("süre bitince yeterli kişi yoksa iptal", () => {
    expect(decidePoll({ yes: 9, capacity: 14, deadlinePassed: true })).toBe("cancel");
    expect(decidePoll({ yes: 0, capacity: 14, deadlinePassed: true })).toBe("cancel");
  });
});

describe("kadro ve yedek sırası", () => {
  const r = (id: string, at: string) => ({ id, respondedAt: `2026-01-01T10:00:0${at}Z` });
  it("yanıt sırasına göre ilk N kadroda, kalanı yedekte", () => {
    const { roster, waitlist } = pickRoster([r("c", "3"), r("a", "1"), r("d", "4"), r("b", "2")], 3);
    expect(roster.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(waitlist.map((x) => x.id)).toEqual(["d"]);
  });
  it("aynı anda gelenlerde kararlı sıra (id)", () => {
    const { roster } = pickRoster([r("b", "1"), r("a", "1")], 1);
    expect(roster[0].id).toBe("a");
  });
  it("kontenjandan az yanıt varsa yedek boş", () => {
    expect(pickRoster([r("a", "1")], 4).waitlist).toEqual([]);
  });
});

describe("ilerleme özeti", () => {
  it("eksik sayıları ve yeterlilik durumunu verir", () => {
    expect(pollProgress(8, 14)).toMatchObject({ yes: 8, waitlist: 0, need: 10, missingForFull: 6, missingForMin: 2, enough: false });
    expect(pollProgress(10, 14)).toMatchObject({ missingForMin: 0, enough: true });
    expect(pollProgress(16, 14)).toMatchObject({ yes: 14, waitlist: 2, missingForFull: 0 });
  });
});

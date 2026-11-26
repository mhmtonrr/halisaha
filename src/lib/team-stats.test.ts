import { describe, expect, it } from "vitest";
import {
  competitive,
  extremes,
  form,
  headToHead,
  leagueTable,
  outcomeOf,
  perMatch,
  recordOf,
  streak,
  type StatMatch,
  type TableRow,
} from "@/lib/team-stats";

let n = 0;
const m = (day: number, f: number, a: number, extra: Partial<StatMatch> = {}): StatMatch => ({
  id: `m${++n}`,
  playedAt: `2026-03-${String(day).padStart(2, "0")}T18:00:00Z`,
  external: true,
  finished: true,
  scoreFor: f,
  scoreAgainst: a,
  opponentGroupId: null,
  opponentName: "Rakip",
  ...extra,
});

describe("sonuç ve karne", () => {
  it("galibiyet, beraberlik, mağlubiyeti ayırır", () => {
    expect(outcomeOf(m(1, 3, 1))).toBe("W");
    expect(outcomeOf(m(1, 2, 2))).toBe("D");
    expect(outcomeOf(m(1, 0, 4))).toBe("L");
  });

  it("gol, averaj, puan ve galibiyet oranını hesaplar", () => {
    const r = recordOf([m(1, 5, 3), m(2, 2, 2), m(3, 0, 1), m(4, 4, 0)]);
    expect(r).toMatchObject({ played: 4, won: 2, drawn: 1, lost: 1, goalsFor: 11, goalsAgainst: 6, cleanSheets: 1, winRate: 50, points: 7 });
  });

  it("maç yoksa sıfır döner", () => {
    expect(recordOf([])).toMatchObject({ played: 0, winRate: 0, points: 0 });
  });
});

describe("rakip maçları filtresi", () => {
  it("kendi içinde ve skoru açıklanmamış maçları dışarıda bırakır, eskiden yeniye sıralar", () => {
    const list = competitive([
      m(9, 1, 0),
      m(2, 1, 0, { external: false }),
      m(3, 1, 0, { finished: false }),
      m(5, 2, 1),
    ]);
    expect(list.map((x) => x.playedAt.slice(8, 10))).toEqual(["05", "09"]);
  });
});

describe("form ve seri", () => {
  const list = [m(1, 1, 0), m(2, 0, 1), m(3, 2, 0), m(4, 3, 1), m(5, 1, 1), m(6, 4, 0)];
  it("son 5 maç, en yeni solda", () => {
    expect(form(list)).toEqual(["W", "D", "W", "W", "L"]);
  });
  it("güncel seriyi bulur", () => {
    expect(streak(list)).toEqual({ outcome: "W", length: 1 });
    expect(streak([...list, m(7, 2, 0)])).toEqual({ outcome: "W", length: 2 });
    expect(streak([m(1, 0, 0), m(2, 1, 1)])).toEqual({ outcome: "D", length: 2 });
  });
  it("maç yoksa seri yok", () => {
    expect(streak([])).toBeNull();
  });
});

describe("en büyük galibiyet / mağlubiyet", () => {
  it("averaj farkına göre seçer", () => {
    const { biggestWin, biggestLoss } = extremes([m(1, 6, 1), m(2, 3, 0), m(3, 0, 4), m(4, 1, 2)]);
    expect(`${biggestWin?.scoreFor}-${biggestWin?.scoreAgainst}`).toBe("6-1");
    expect(`${biggestLoss?.scoreFor}-${biggestLoss?.scoreAgainst}`).toBe("0-4");
  });
  it("hiç yenilmediyse mağlubiyet boş", () => {
    expect(extremes([m(1, 2, 0)]).biggestLoss).toBeNull();
  });
});

describe("rakip bazlı geçmiş", () => {
  it("takımı olan rakipleri id'ye, olmayanları ada göre birleştirir", () => {
    const h = headToHead([
      m(1, 3, 1, { opponentGroupId: "g1", opponentName: "Aslanlar" }),
      m(2, 0, 2, { opponentGroupId: "g1", opponentName: "Aslanlar FK" }),
      m(3, 1, 1, { opponentGroupId: null, opponentName: "Mahalle" }),
      m(4, 2, 0, { opponentGroupId: null, opponentName: "  mahalle " }),
      m(5, 5, 0, { opponentGroupId: "g2", opponentName: "Kaplanlar" }),
    ]);
    expect(h.map((x) => [x.opponentName, x.played])).toEqual([
      ["mahalle", 2],
      ["Aslanlar FK", 2],
      ["Kaplanlar", 1],
    ]);
    const aslan = h.find((x) => x.opponentGroupId === "g1")!;
    expect(aslan).toMatchObject({ won: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, opponentName: "Aslanlar FK" });
  });
});

describe("maç başı ortalama", () => {
  it("iki basamağa yuvarlar, maçsız 0", () => {
    expect(perMatch(7, 3)).toBe(2.33);
    expect(perMatch(5, 0)).toBe(0);
  });
});

describe("puan tablosu", () => {
  const row = (name: string, o: Partial<TableRow> = {}): TableRow => ({
    playerId: name, name, played: 3, goals: 0, assists: 0, saves: 0, mvps: 0, overall: 70, last: null, ...o,
  });
  const last = (ratingDelta: number, goals = 0, assists = 0) => ({ ratingDelta, goals, assists });
  const names = (rows: TableRow[]) => leagueTable(rows).map((r) => r.name);

  it("rating'e göre sıralar; eşitlikte maç, gol, asist, sonra Türkçe ad sırası", () => {
    expect(names([row("Az", { overall: 60 }), row("Çok", { overall: 80 })])).toEqual(["Çok", "Az"]);
    expect(names([row("A", { played: 2 }), row("B")])).toEqual(["B", "A"]);
    expect(names([row("A", { goals: 1 }), row("B", { goals: 2 })])).toEqual(["B", "A"]);
    expect(names([row("A", { assists: 1 }), row("B", { assists: 2 })])).toEqual(["B", "A"]);
    expect(names([row("Şan"), row("Sel"), row("Ilgın"), row("İpek")])).toEqual(["Ilgın", "İpek", "Sel", "Şan"]);
  });
  it("hiç maçı olmayanı tabloya almaz", () => {
    expect(names([row("A"), row("B", { played: 0, overall: 90 })])).toEqual(["A"]);
    expect(leagueTable([])).toEqual([]);
  });
  it("son maçın rating değişimine göre yükselen ve düşeni gösterir", () => {
    const t = leagueTable([row("Ali", { overall: 74, last: last(6) }), row("Veli", { overall: 72, last: last(-1) }), row("Can", { overall: 60 })]);
    expect(t.map((r) => [r.name, r.rank, r.move])).toEqual([["Ali", 1, 1], ["Veli", 2, -1], ["Can", 3, 0]]);
  });
  it("ilk maçını son maçta oynayan yeni sayılır, geçtikleri düşer", () => {
    const t = leagueTable([row("Yeni", { played: 1, overall: 80, last: last(15) }), row("Eski")]);
    expect(t.map((r) => [r.name, r.move])).toEqual([["Yeni", null], ["Eski", -1]]);
  });
  it("önceki sırada eşitliği son maçtaki gol hariç tutularak çözer", () => {
    const t = leagueTable([row("Ali", { goals: 5, last: last(0, 4) }), row("Veli", { goals: 3 })]);
    expect(t.map((r) => [r.name, r.move])).toEqual([["Ali", 1], ["Veli", -1]]);
  });
  it("girdiyi değiştirmez, ek alanları korur", () => {
    const rows = [{ ...row("A", { last: last(2, 1) }), photoUrl: "x" }];
    expect(leagueTable(rows)[0]).toMatchObject({ photoUrl: "x", overall: 70, played: 3, rank: 1 });
    expect(rows[0]).not.toHaveProperty("rank");
  });
});

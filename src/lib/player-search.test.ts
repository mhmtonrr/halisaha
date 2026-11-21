import { describe, expect, it } from "vitest";
import { parseFilter, searchCandidates, type PlayerCandidate } from "./player-search";

const P = (o: Partial<PlayerCandidate>): PlayerCandidate => ({
  userId: o.name ?? "x", name: "X", city: "İstanbul", district: null, position: "MID", secondary: [], foot: "R", shirt: null,
  overall: 65, matches: 0, skills: {}, noShows: 0, teams: [], ...o,
});
const list = [
  P({ name: "Ali", overall: 80, matches: 10, position: "FWD", secondary: ["MID"], skills: { HIZ: 82 }, teams: [{ id: "t", name: "T", color: null }] }),
  P({ name: "Işıl", overall: 70, matches: 4, position: "DEF", noShows: 2 }),
  P({ name: "Can", overall: 65, matches: 0, position: "GK", foot: "L" }),
  P({ name: "İlker", overall: 75, matches: 6, position: "MID", skills: { HIZ: 61 } }),
];
const names = (f: Parameters<typeof searchCandidates>[1], sort?: Parameters<typeof searchCandidates>[2]) => searchCandidates(list, f, sort).map((c) => c.name);

describe("oyuncu arama", () => {
  it("rating'e göre sıralar, maçsızlar sona", () => expect(names({})).toEqual(["Ali", "İlker", "Işıl", "Can"]));
  it("Türkçe harfe duyarsız ad arar", () => {
    expect(names({ q: "ışıl" })).toEqual(["Işıl"]);
    expect(names({ q: "İLK" })).toEqual(["İlker"]);
  });
  it("mevki; ikinci mevki isteğe bağlı", () => {
    expect(names({ position: "MID" })).toEqual(["İlker"]);
    expect(names({ position: "MID", includeSecondary: true })).toEqual(["Ali", "İlker"]);
  });
  it("rating aralığı maçsız oyuncuyu dışlar", () => {
    expect(names({ minOverall: 60 })).toEqual(["Ali", "İlker", "Işıl"]);
    expect(names({ maxOverall: 70 })).toEqual(["Işıl"]);
  });
  it("ayak, deneyim, yetenek eşiği", () => {
    expect(names({ foot: "L" })).toEqual(["Can"]);
    expect(names({ minMatches: 5 })).toEqual(["Ali", "İlker"]);
    expect(names({ skill: "HIZ", minSkill: 70 })).toEqual(["Ali"]);
  });
  it("güvenilir: gelmedi yoksa veya %90+", () => expect(names({ reliable: true })).toEqual(["Ali", "İlker", "Can"]));
  it("takımsız", () => expect(names({ teamless: true })).toEqual(["İlker", "Işıl", "Can"]));
  it("diğer sıralamalar", () => {
    expect(names({}, "mac")).toEqual(["Ali", "İlker", "Işıl", "Can"]);
    expect(names({}, "isim")).toEqual(["Ali", "Can", "Işıl", "İlker"]);
  });
});

describe("parseFilter", () => {
  it("geçersiz değerleri yok sayar", () => {
    const { filter, sort } = parseFilter({ mevki: "XX", min: "abc", max: "500", ayak: "Z", yetenek: "YOK", sirala: "?" });
    expect(filter).toMatchObject({ position: undefined, minOverall: undefined, maxOverall: undefined, foot: undefined, skill: undefined });
    expect(sort).toBe("rating");
  });
  it("geçerli değerleri okur; yetenek eşiği varsayılanı 60", () => {
    const { filter } = parseFilter({ mevki: "GK", min: "70", yetenek: "REF", ikinci: "1", guvenilir: "1" });
    expect(filter).toMatchObject({ position: "GK", minOverall: 70, skill: "REF", minSkill: 60, includeSecondary: true, reliable: true });
  });
  it("boş parametre filtre sayılmaz", () => expect(parseFilter({ min: "", mac: "", q: " " }).filter.minOverall).toBeUndefined());
});

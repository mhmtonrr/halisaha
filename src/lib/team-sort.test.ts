import { describe, expect, it } from "vitest";
import { NO_FORM, parseTeamSort, sortTeams } from "./team-sort";

const teams = ["A", "B", "C"].map((n) => ({ id: n, name: n, members: 7 }));
const forms = new Map([
  ["B", { ...NO_FORM, played: 1, wins: 1 }],
  ["C", { ...NO_FORM, played: 4, wins: 3, losses: 1 }],
]);
const ids = (s: Parameters<typeof sortTeams>[1]) => sortTeams(teams, s, forms).map((t) => t.id);

describe("takım sıralaması", () => {
  it("rating: gelen sıra korunur", () => expect(ids("rating")).toEqual(["A", "B", "C"]));
  it("oran: yeterli maçlılar önce, maçsız sonda", () => expect(ids("oran")).toEqual(["C", "B", "A"]));
  it("maç sayısı", () => expect(ids("mac")).toEqual(["C", "B", "A"]));
  it("geçersiz değer rating sayılır", () => expect(parseTeamSort("x")).toBe("rating"));
});

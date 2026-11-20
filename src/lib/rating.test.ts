import { describe, expect, it } from "vitest";
import {
  computeMatch,
  computeRatings,
  detectCollusion,
  normalizeVotes,
  type MatchInput,
  type Vote,
} from "./rating";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Herkesin herkese "gerçek seviye + oy verenin kişisel kayması" puanı verdiği maç */
function makeMatch(opts: {
  id: string;
  playedAt: string;
  players: string[];
  skill: Record<string, number>;
  voterShift?: Record<string, number>;
  scoreA?: number;
  scoreB?: number;
  override?: (voter: string, target: string) => number | undefined;
}): MatchInput {
  const half = Math.ceil(opts.players.length / 2);
  const votes: Vote[] = [];
  for (const voter of opts.players) {
    for (const target of opts.players) {
      if (voter === target) continue;
      const forced = opts.override?.(voter, target);
      const raw =
        forced ?? opts.skill[target] + (opts.voterShift?.[voter] ?? 0);
      votes.push({
        voterId: voter,
        targetId: target,
        score: Math.max(1, Math.min(10, Math.round(raw))),
      });
    }
  }
  return {
    id: opts.id,
    playedAt: opts.playedAt,
    players: opts.players.map((p, i) => ({
      playerId: p,
      team: i < half ? "A" : "B",
    })),
    scoreA: opts.scoreA ?? 5,
    scoreB: opts.scoreB ?? 5,
    votes,
  };
}

describe("normalizeVotes", () => {
  it("cömert ve sert oy verenler aynı göreli puanı üretir", () => {
    const players = ids(5);
    const match: MatchInput = {
      id: "m",
      playedAt: "2026-01-01",
      players: players.map((p) => ({ playerId: p, team: "A" })),
      scoreA: 0,
      scoreB: 0,
      votes: [
        // p1 cömert: 7,8,9,10 ; p2 sert: 2,3,4,5 — aynı sıralama
        { voterId: "p1", targetId: "p2", score: 7 },
        { voterId: "p1", targetId: "p3", score: 8 },
        { voterId: "p1", targetId: "p4", score: 9 },
        { voterId: "p1", targetId: "p5", score: 10 },
        { voterId: "p2", targetId: "p1", score: 2 },
        { voterId: "p2", targetId: "p3", score: 3 },
        { voterId: "p2", targetId: "p4", score: 4 },
        { voterId: "p2", targetId: "p5", score: 5 },
      ],
    };
    const z = normalizeVotes(match);
    const p1z = z.filter((v) => v.voterId === "p1").map((v) => v.z);
    const p2z = z.filter((v) => v.voterId === "p2").map((v) => v.z);
    expect(p1z).toEqual(p2z);
  });

  it("herkese aynı puanı veren trolün etkisi sıfırdır", () => {
    const players = ids(5);
    const match: MatchInput = {
      id: "m",
      playedAt: "2026-01-01",
      players: players.map((p) => ({ playerId: p, team: "A" })),
      scoreA: 0,
      scoreB: 0,
      votes: players
        .filter((p) => p !== "p1")
        .map((t) => ({ voterId: "p1", targetId: t, score: 1 })),
    };
    expect(normalizeVotes(match).every((v) => v.z === 0)).toBe(true);
  });

  it("kendine oy, maç dışı oyuncu ve aralık dışı puan sayılmaz", () => {
    const match: MatchInput = {
      id: "m",
      playedAt: "2026-01-01",
      players: ids(4).map((p) => ({ playerId: p, team: "A" })),
      scoreA: 0,
      scoreB: 0,
      votes: [
        { voterId: "p1", targetId: "p1", score: 10 },
        { voterId: "p1", targetId: "x9", score: 10 },
        { voterId: "p1", targetId: "p2", score: 11 },
        { voterId: "p1", targetId: "p3", score: 0 },
      ],
    };
    expect(normalizeVotes(match)).toHaveLength(0);
  });
});

describe("computeMatch", () => {
  const players = ids(16); // 8'e 8
  const skill = Object.fromEntries(players.map((p, i) => [p, 3 + (i % 8)]));

  it("8'e 8 maçta daha iyi oynayanlar daha yüksek puan alır", () => {
    const match = makeMatch({ id: "m", playedAt: "2026-01-01", players, skill });
    const res = computeMatch(match);
    const byId = Object.fromEntries(res.players.map((p) => [p.playerId, p]));
    expect(byId.p8.performance).toBeGreaterThan(byId.p1.performance);
    expect(byId.p8.matchScore).toBeGreaterThan(byId.p1.matchScore);
    expect(byId.p1.votesReceived).toBe(15);
    expect(byId.p1.weight).toBe(1);
  });

  it("tek bir kötü niyetli oy uç değer olarak atılır", () => {
    const base = makeMatch({ id: "m", playedAt: "2026-01-01", players, skill });
    const hater = makeMatch({
      id: "m",
      playedAt: "2026-01-01",
      players,
      skill,
      override: (v, t) => (v === "p2" && t === "p8" ? 1 : undefined),
    });
    const a = computeMatch(base).players.find((p) => p.playerId === "p8")!;
    const b = computeMatch(hater).players.find((p) => p.playerId === "p8")!;
    expect(Math.abs(a.performance - b.performance)).toBeLessThan(0.1);
  });

  it("az oy alan maçın ağırlığı düşük, çok az oyda sıfırdır", () => {
    const five = ids(10); // 5'e 5
    const full = makeMatch({
      id: "m",
      playedAt: "2026-01-01",
      players: five,
      skill: Object.fromEntries(five.map((p, i) => [p, 3 + i % 5])),
    });
    // Sadece 3 kişi oy vermiş olsun (p1-p3)
    const partial = {
      ...full,
      votes: full.votes.filter((v) => ["p1", "p2", "p3"].includes(v.voterId)),
    };
    const res = computeMatch(partial);
    const p5 = res.players.find((p) => p.playerId === "p5")!;
    expect(p5.votesReceived).toBe(3);
    expect(p5.weight).toBeCloseTo(3 / 9 / 0.5);
    const p1 = res.players.find((p) => p.playerId === "p1")!;
    expect(p1.votesReceived).toBe(2);
    expect(p1.weight).toBe(0);
  });

  it("MVP en çok oyu alandır, kendine oy sayılmaz", () => {
    const match = makeMatch({ id: "m", playedAt: "2026-01-01", players, skill });
    match.mvpVotes = [
      { voterId: "p1", targetId: "p5" },
      { voterId: "p2", targetId: "p5" },
      { voterId: "p3", targetId: "p6" },
      { voterId: "p6", targetId: "p6" },
      { voterId: "p6", targetId: "p6" },
    ];
    expect(computeMatch(match).mvpId).toBe("p5");
  });

  it("galibiyet küçük bir bonus verir", () => {
    const flat = Object.fromEntries(players.map((p) => [p, 6]));
    const match = makeMatch({
      id: "m",
      playedAt: "2026-01-01",
      players,
      skill: flat,
      scoreA: 7,
      scoreB: 4,
    });
    const res = computeMatch(match);
    const winner = res.players.find((p) => p.playerId === "p1")!;
    const loser = res.players.find((p) => p.playerId === "p16")!;
    expect(winner.outcome).toBe("win");
    expect(loser.outcome).toBe("loss");
    expect(winner.performance).toBeGreaterThan(loser.performance);
  });
});

describe("computeRatings", () => {
  const players = ids(14);
  const skill = Object.fromEntries(players.map((p, i) => [p, 3 + (i % 7)]));
  const season = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeMatch({
        id: `m${i}`,
        playedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
        players,
        skill,
      }),
    );

  it("ratingler 40-99 arasında ve seviyeye göre sıralı", () => {
    const { ratings } = computeRatings(season(8));
    const ovr = (id: string) => ratings.get(id)!.overall;
    for (const r of ratings.values()) {
      expect(r.overall).toBeGreaterThanOrEqual(40);
      expect(r.overall).toBeLessThanOrEqual(99);
    }
    expect(ovr("p7")).toBeGreaterThan(ovr("p4"));
    expect(ovr("p4")).toBeGreaterThan(ovr("p1"));
  });

  it("tek maçta parlayan yeni oyuncu doğrudan zirveye çıkmaz", () => {
    const { ratings } = computeRatings(season(10));
    const veteranTop = ratings.get("p7")!.overall;

    const newcomerMatch = makeMatch({
      id: "new",
      playedAt: "2026-02-01",
      players: [...players, "rookie"],
      skill: { ...skill, rookie: 10 },
    });
    const after = computeRatings([...season(10), newcomerMatch]).ratings;
    expect(after.get("rookie")!.overall).toBeLessThan(veteranTop);
    expect(after.get("rookie")!.confidence).toBeLessThan(
      after.get("p7")!.confidence,
    );
  });

  it("tek kişinin şişirdiği oy zaten uç değer olarak atılır", () => {
    const matches = Array.from({ length: 6 }, (_, i) =>
      makeMatch({
        id: `m${i}`,
        playedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
        players,
        skill,
        override: (v, t) =>
          (v === "p1" && t === "p2") || (v === "p2" && t === "p1")
            ? 10
            : undefined,
      }),
    );
    const suspicious = detectCollusion(matches);
    expect([...suspicious].sort()).toEqual(["p1>p2", "p2>p1"]);
    const honest = computeRatings(season(6)).ratings.get("p1")!.overall;
    expect(computeRatings(matches).ratings.get("p1")!.overall).toBe(honest);
  });

  it("birbirini şişiren üçlü tespit edilir ve etkisi büyük ölçüde silinir", () => {
    const clique = new Set(["p1", "p2", "p3"]);
    const matches = Array.from({ length: 6 }, (_, i) =>
      makeMatch({
        id: `m${i}`,
        playedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
        players,
        skill,
        override: (v, t) => (clique.has(v) && clique.has(t) ? 10 : undefined),
      }),
    );
    const suspicious = detectCollusion(matches);
    expect(suspicious.size).toBe(6); // 3 ikili, iki yönlü

    const avgPerf = (results: { players: { playerId: string; performance: number }[] }[]) =>
      results
        .map((r) => r.players.find((p) => p.playerId === "p1")!.performance)
        .reduce((a, b) => a + b, 0) / results.length;

    const honest = avgPerf(computeRatings(season(6)).matchResults);
    const undetected = avgPerf(matches.map((m) => computeMatch(m)));
    const detected = avgPerf(computeRatings(matches).matchResults);

    expect(undetected).toBeGreaterThan(honest);
    // Tespit sonrası haksız kazancın en az yarısı geri alınır
    expect(detected - honest).toBeLessThan((undetected - honest) / 2);
  });

  it("sadece bir maçta birbirini öven arkadaşlar suçlanmaz", () => {
    const matches = season(6);
    matches[0] = makeMatch({
      id: "m0",
      playedAt: "2026-01-01",
      players,
      skill,
      override: (v, t) =>
        (v === "p1" && t === "p2") || (v === "p2" && t === "p1")
          ? 10
          : undefined,
    });
    expect(detectCollusion(matches).size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeMatch,
  CONFIG,
  computeRatings,
  detectCollusion,
  normalizeVotes,
  shareWeights,
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

  it("az oy alan maçın ağırlığı düşük, tek oyda sıfırdır", () => {
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
    // katılım 3/9 (tam ağırlığın %67'si) × örneklem 3/4
    expect(p5.weight).toBeCloseTo((3 / 9 / 0.5) * (3 / 4));
    const p1 = res.players.find((p) => p.playerId === "p1")!;
    expect(p1.votesReceived).toBe(2);
    expect(p1.weight).toBeCloseTo((2 / 9 / 0.5) * (2 / 4));

    // Sadece tek kişi oy verdiyse maç kimse için sayılmaz
    const single = computeMatch({ ...full, votes: full.votes.filter((v) => v.voterId === "p1") });
    expect(single.players.every((p) => p.weight === 0)).toBe(true);
  });

  it("misafirli küçük maçta hesabı olanlar da puan alır", () => {
    // 5 kişi: 3 hesap sahibi (u1-u3) herkesi puanlar, 2 misafir (g1, g2) oy veremez.
    // Hesap sahiplerine en fazla 2 oy gelebilir; yine de maçları sayılmalı.
    const ids5 = ["u1", "u2", "u3", "g1", "g2"];
    const skill: Record<string, number> = { u1: 9, u2: 8, u3: 5, g1: 6, g2: 4 };
    const base = makeMatch({ id: "m", playedAt: "2026-01-01", players: ids5, skill });
    const match: MatchInput = {
      ...base,
      players: base.players.map((p) => ({ ...p, canVote: p.playerId.startsWith("u") })),
      votes: base.votes.filter((v) => v.voterId.startsWith("u")),
    };
    const byId = Object.fromEntries(computeMatch(match).players.map((p) => [p.playerId, p]));
    for (const u of ["u1", "u2", "u3"]) {
      expect(byId[u].votesReceived).toBe(2);
      expect(byId[u].weight).toBeCloseTo(0.5); // 2/2 katılım × 2/4 örneklem
    }
    expect(byId.g1.weight).toBeCloseTo(0.75); // 3/3 katılım × 3/4 örneklem
    expect(byId.u1.performance).toBeGreaterThan(byId.u3.performance);
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

describe("takımlar arası maçta kendi/rakip oy payı", () => {
  // A takımı: a1,a2,a3 — B takımı: b1,b2,b3. Herkes herkese oy verir.
  const players = ["a1", "a2", "a3", "b1", "b2", "b3"].map((id) => ({
    playerId: id,
    team: (id[0] === "a" ? "A" : "B") as "A" | "B",
  }));
  const ids = players.map((p) => p.playerId);
  /** score(voter, target) ile tam oylama matrisi: herkes kendi dışındaki herkese oy verir */
  const matchWith = (score: (v: string, t: string) => number, rivalShare?: number): MatchInput => ({
    id: "m",
    playedAt: "2026-01-01T18:00:00Z",
    players,
    scoreA: 2,
    scoreB: 2,
    rivalShare,
    votes: ids.flatMap((v) =>
      ids
        .filter((t) => t !== v)
        .map((t) => ({ voterId: v, targetId: t, score: score(v, t) })),
    ),
  });
  // Herkes kendi takımına 9, rakibe 5 verir (kendi takımı şişirme)
  const partisan = (v: string, t: string) => (v[0] === t[0] ? 9 : 5);
  const perf = (m: MatchInput, id: string) => computeMatch(m).players.find((p) => p.playerId === id)!.performance;

  it("rakip payı yükseldikçe kendi takımının şişirmesinin etkisi azalır", () => {
    const equal = perf(matchWith(partisan, 0.5), "a1");
    const rivalHeavy = perf(matchWith(partisan, 0.6), "a1");
    const mostlyRival = perf(matchWith(partisan, 0.9), "a1");
    expect(rivalHeavy).toBeLessThan(equal);
    expect(mostlyRival).toBeLessThan(rivalHeavy);
  });

  it("rakip hiç oy vermediyse kendi takımının oyları tam sayılır", () => {
    const m = matchWith(partisan, 0.6);
    m.votes = m.votes.filter((v) => v.voterId[0] === "a");
    const withShare = perf(m, "a1");
    const noShare = perf({ ...m, rivalShare: undefined }, "a1");
    expect(withShare).toBeCloseTo(noShare, 10);
  });

  it("shareWeights: toplam ağırlıklar tam pay oranında", () => {
    const w = shareWeights(
      [
        { z: 1, w: 1, rival: false },
        { z: 1, w: 1, rival: false },
        { z: -1, w: 1, rival: true },
      ],
      0.6,
    );
    const own = w[0].w + w[1].w;
    const rival = w[2].w;
    expect(rival / (own + rival)).toBeCloseTo(0.6, 10);
  });
});

describe("maçın önemi (resmî takım maçı tam, arkadaş/antrenman maçı yarım)", () => {
  const players = ids(6);
  // Oy ölçeğinde (1-10) farklı seviyeler: p1 en iyi, p6 en zayıf
  const skill = Object.fromEntries(players.map((p, i) => [p, 9 - i * 1.2]));
  const build = (importance?: number) => ({
    ...makeMatch({ id: "m1", playedAt: "2026-01-01T18:00:00Z", players, skill }),
    importance,
  });

  it("önem çarpanı maçın ağırlığını orantılı düşürür, maç puanını değiştirmez", () => {
    const full = computeMatch(build()).players[0];
    const half = computeMatch(build(CONFIG.CASUAL_IMPORTANCE)).players[0];
    expect(full.weight).toBeGreaterThan(0); // 0 = 0 ile boşa geçmesin
    expect(full.performance).toBeGreaterThan(0);
    expect(half.weight).toBeCloseTo(full.weight * CONFIG.CASUAL_IMPORTANCE, 10);
    expect(half.matchScore).toBe(full.matchScore);
    expect(half.performance).toBe(full.performance);
  });

  it("tanımsız önem 1'e eşittir (eski davranış)", () => {
    expect(computeMatch(build(undefined)).players[0].weight).toBe(computeMatch(build(1)).players[0].weight);
  });

  it("yarım etkili maç rating'i ortalamaya (65) daha az uzaklaştırır", () => {
    const rating = (importance: number | undefined) =>
      computeRatings([build(importance)]).ratings.get(players[0])!.overall;
    const full = rating(undefined);
    const half = rating(CONFIG.CASUAL_IMPORTANCE);
    expect(full).toBeGreaterThan(65);
    expect(half).toBeGreaterThan(65);
    expect(half).toBeLessThan(full);
  });

  it("az oylu maç yine hiç sayılmaz (önem çarpanı eşiği gevşetmez)", () => {
    const m = build(CONFIG.CASUAL_IMPORTANCE);
    m.votes = m.votes.filter((v) => v.voterId === "p1" || v.voterId === "p2").slice(0, 3);
    expect(computeMatch(m).players.every((p) => p.weight === 0 || p.votesReceived >= CONFIG.MIN_VOTES_RECEIVED)).toBe(true);
  });
});

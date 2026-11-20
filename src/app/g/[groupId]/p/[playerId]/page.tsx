import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { formatDate, getGroupPlayers, getGroupStats, one, statsFor } from "@/lib/data";
import { Card, Header, SectionTitle, cx } from "@/components/ui";
import { PlayerCard } from "@/components/PlayerCard";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ groupId: string; playerId: string }>;
}) {
  const { groupId, playerId } = await params;
  const { supabase } = await requireUser();

  const [players, stats, { data: history }] = await Promise.all([
    getGroupPlayers(supabase, groupId),
    getGroupStats(supabase, groupId),
    supabase
      .from("match_results")
      .select("match_id, match_score, rating_after, rating_before, is_mvp, weight, matches!inner(played_at, score_a, score_b, group_id)")
      .eq("player_id", playerId)
      .eq("matches.group_id", groupId)
      .limit(200),
  ]);
  const player = players.find((p) => p.id === playerId);
  if (!player) notFound();

  const s = statsFor(stats, playerId);
  const ranked = [...players].filter((p) => p.matches_played > 0).sort((a, b) => b.overall - a.overall);
  const rank = ranked.findIndex((p) => p.id === playerId) + 1;

  type M = { played_at: string; score_a: number; score_b: number };
  const matches = (history ?? [])
    .map((h) => ({ ...h, m: one(h.matches as M | M[])! }))
    .sort((a, b) => b.m.played_at.localeCompare(a.m.played_at));

  const { data: teams } = await supabase
    .from("match_players")
    .select("match_id, team, goals, assists")
    .eq("player_id", playerId)
    .in("match_id", matches.slice(0, 20).map((m) => m.match_id));
  const teamOf = new Map((teams ?? []).map((t) => [t.match_id, t]));

  const form = matches.slice(0, 5).reverse();
  const winRate = s.played ? Math.round((s.wins / s.played) * 100) : 0;

  return (
    <main>
      <Header title={player.display_name} back={`/g/${groupId}`} />

      <PlayerCard
        name={player.display_name}
        overall={player.overall}
        position={player.position}
        provisional={player.matches_played > 0 && player.confidence < 0.6}
        stats={[
          { label: "MAÇ", value: s.played },
          { label: "GOL", value: s.goals },
          { label: "AST", value: s.assists },
          { label: "MVP", value: s.mvps },
          { label: "GAL%", value: winRate },
          { label: player.position === "GK" ? "KRT" : "SIRA", value: player.position === "GK" ? s.saves : rank || "–" },
        ]}
      />

      {player.matches_played === 0 && (
        <p className="mt-4 text-center text-sm text-muted">
          Henüz puanlanmış maçı yok. Herkes 65 puanla başlar, birkaç maçta gerçek seviyesine oturur.
        </p>
      )}

      {form.length > 0 && (
        <>
          <SectionTitle>Form · son {form.length} maç</SectionTitle>
          <Card>
            <div className="flex h-32 items-end justify-around gap-2">
              {form.map((f) => (
                <div key={f.match_id} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-bold tabular-nums">{f.match_score.toFixed(1)}</span>
                  <div
                    className={cx(
                      "w-full max-w-10 rounded-t-md",
                      f.match_score >= 7.5 ? "bg-accent" : f.match_score >= 5.5 ? "bg-accent/50" : "bg-red-400/60",
                    )}
                    style={{ height: `${Math.max(8, f.match_score * 9)}px` }}
                  />
                  <span className="text-[10px] text-muted">
                    {new Date(f.m.played_at).toLocaleDateString("tr-TR", { day: "numeric", month: "numeric", timeZone: "Europe/Istanbul" })}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {matches.length > 0 && (
        <>
          <SectionTitle>Maç geçmişi</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {matches.slice(0, 20).map((h) => {
                const t = teamOf.get(h.match_id);
                const mine = t?.team === "A" ? h.m.score_a : h.m.score_b;
                const theirs = t?.team === "A" ? h.m.score_b : h.m.score_a;
                const res = mine > theirs ? "G" : mine < theirs ? "M" : "B";
                const delta = h.rating_after - h.rating_before;
                return (
                  <li key={h.match_id}>
                    <Link
                      href={`/g/${groupId}/m/${h.match_id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800"
                    >
                      <span
                        className={cx(
                          "flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold",
                          res === "G" ? "bg-accent/20 text-accent" : res === "M" ? "bg-red-400/20 text-red-300" : "bg-pitch-700 text-muted",
                        )}
                      >
                        {res}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <div>
                          {formatDate(h.m.played_at)} {h.is_mvp && "⭐"}
                        </div>
                        <div className="text-xs text-muted">
                          {mine}-{theirs}
                          {t && t.goals > 0 && ` · ${t.goals} gol`}
                          {t && t.assists > 0 && ` · ${t.assists} asist`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-black tabular-nums">{h.weight > 0 ? h.match_score.toFixed(1) : "–"}</div>
                        <div className={cx("text-xs tabular-nums", delta > 0 ? "text-accent" : delta < 0 ? "text-red-400" : "text-muted")}>
                          {delta > 0 ? `+${delta}` : delta < 0 ? delta : "±0"}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </main>
  );
}

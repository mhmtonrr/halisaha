import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { PositionChip } from "@/components/PlayerCard";
import { cx } from "@/components/ui";
import { getGroupSummaries, isSquadMember, type Position } from "@/lib/data";
import { requireUser } from "@/lib/supabase/server";
import { TeamTable } from "@/components/team/TeamTable";
import { ResultTabs } from "./ResultTabs";

export interface ResultPlayer {
  id: string;
  name: string;
  photoUrl: string | null;
  position: Position | null;
  goals: number;
  assists: number;
  saves: number;
  /** Takım rengi (halka) */
  color: string;
}

const statLine = (p: ResultPlayer) =>
  [p.goals && `${p.goals} gol`, p.assists && `${p.assists} asist`, p.saves && `${p.saves} kurtarış`].filter(Boolean).join(" · ");

const RANK_STYLE = ["bg-amber-400 text-pitch-950", "bg-silver-1 text-pitch-950", "bg-bronze-1 text-pitch-950"];

function Delta({ value }: { value: number }) {
  return (
    <span className={cx("font-semibold tabular-nums", value > 0 ? "text-accent" : value < 0 ? "text-red-400" : "text-white/40")}>
      {value > 0 ? `▲${value}` : value < 0 ? `▼${-value}` : "±0"}
    </span>
  );
}

/**
 * Kapanmış maçın sonuçları (kendi takımım ve rakip aynı görünümü kullanır): maçın adamı, benim sonucum,
 * performans sıralaması; takımlarda ayrıca tüm zamanların puan tablosu.
 */
export async function ResultsView({
  groupId,
  matchId,
  roster,
  myId,
  isTeam,
}: {
  groupId: string;
  matchId: string;
  roster: ResultPlayer[];
  myId?: string;
  isTeam: boolean;
}) {
  const { supabase } = await requireUser();
  const { data: results } = await supabase
    .from("match_results")
    .select("player_id, match_score, votes_received, rating_before, rating_after, is_mvp, weight")
    .eq("match_id", matchId);
  const byId = new Map((results ?? []).map((r) => [r.player_id, r]));
  // Yeterli oy alamayanlar (ağırlık 0) sıralamanın sonunda, puansız
  const scoreOf = (id: string) => {
    const r = byId.get(id);
    return r && r.weight > 0 ? r.match_score : -1;
  };
  const rows = roster
    .map((p) => ({ p, r: byId.get(p.id) }))
    .sort((a, b) => scoreOf(b.p.id) - scoreOf(a.p.id) || a.p.name.localeCompare(b.p.name, "tr"));
  const mvp = rows.find((x) => x.r?.is_mvp);
  const myIndex = rows.findIndex((x) => x.p.id === myId);
  const mine = myIndex >= 0 && rows[myIndex].r ? { ...rows[myIndex], r: rows[myIndex].r! } : null;
  const squad = isTeam ? (await getGroupSummaries(supabase, groupId)).filter(isSquadMember) : [];

  const match = (
    <>
      {mvp && (
        <div className="relative isolate overflow-hidden px-4 py-6 text-center">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.28),transparent_65%)]" />
          <div className="t-label-caps flex items-center justify-center gap-1 uppercase text-amber-300">
            <Icon name="star" fill className="text-[16px]" />
            Maçın adamı
          </div>
          <Link href={`/g/${groupId}/p/${mvp.p.id}`} className="mt-3 block">
            <span className="inline-block rounded-full shadow-[0_0_0_3px_#fbbf24,0_0_28px_rgba(251,191,36,0.45)]">
              <Avatar name={mvp.p.name} photoUrl={mvp.p.photoUrl} className="h-24 w-24 bg-white/10 text-2xl text-white" />
            </span>
            <div className="mt-3 truncate font-display text-2xl font-black">{mvp.p.name}</div>
          </Link>
          <div className="mt-0.5 text-sm text-white/60">
            {[mvp.r!.weight > 0 && `Maç puanı ${mvp.r!.match_score.toFixed(1)}`, statLine(mvp.p)].filter(Boolean).join(" · ")}
          </div>
        </div>
      )}

      {mine && (
        <section aria-label="Senin sonucun" className="mx-3 mb-3 mt-3 rounded-2xl border border-accent/40 bg-accent/10 p-3">
          <div className="t-label-caps mb-2 uppercase text-accent">Senin sonucun</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="font-display text-3xl font-black tabular-nums leading-none">
                {mine.r.weight > 0 ? mine.r.match_score.toFixed(1) : "–"}
              </div>
              <div className="mt-1 text-[11px] text-white/55">Maç puanı</div>
            </div>
            <div>
              <div className="font-display text-3xl font-black tabular-nums leading-none">
                {mine.r.weight > 0 ? `${myIndex + 1}.` : "–"}
              </div>
              <div className="mt-1 text-[11px] text-white/55">{roster.length} kişide sıran</div>
            </div>
            <div>
              <div className="font-display text-3xl font-black tabular-nums leading-none">{mine.r.rating_after}</div>
              <div className="mt-1 text-[11px] text-white/55">
                Rating <Delta value={mine.r.rating_after - mine.r.rating_before} />
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-xs text-white/55">
            {[statLine(mine.p), `${mine.r.votes_received} oy aldın`].filter(Boolean).join(" · ")}
            {mine.r.weight === 0 && " · puan için yeterli oy yok"}
          </div>
        </section>
      )}

      <div className="t-label-caps px-4 pb-2 pt-1 uppercase text-white/50">Performans sıralaması</div>
      <ol className="space-y-1.5 px-3 pb-3">
        {rows.map(({ p, r }, i) => {
          const rated = !!r && r.weight > 0;
          return (
            <li key={p.id}>
              <Link
                href={`/g/${groupId}/p/${p.id}`}
                className={cx(
                  "flex items-center gap-2.5 rounded-2xl border px-2.5 py-2 transition hover:bg-white/10",
                  p.id === myId ? "border-accent/50 bg-accent/10" : "border-white/10 bg-white/5",
                )}
              >
                <span
                  className={cx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-black tabular-nums",
                    (rated && RANK_STYLE[i]) || "text-white/45",
                  )}
                >
                  {i + 1}
                </span>
                <span className="shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${p.color}` }}>
                  <Avatar name={p.name} photoUrl={p.photoUrl} className="h-9 w-9 bg-white/10 text-xs text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <PositionChip position={p.position} />
                    {r?.is_mvp && <Icon name="star" fill className="text-[15px] text-gold-1" />}
                  </span>
                  {statLine(p) && <span className="block truncate text-xs text-white/50">{statLine(p)}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-xl font-black tabular-nums leading-tight">
                    {rated ? r.match_score.toFixed(1) : "–"}
                  </span>
                  {r && (
                    <span className="block text-[11px] tabular-nums text-white/55">
                      {r.rating_after} <Delta value={r.rating_after - r.rating_before} />
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="px-4 pb-4 text-center text-xs text-white/45">
        Puanlar, herkesin kendi oy verme ölçeğine göre düzeltilmiş ve uç oylar atılmış ortalamadır.
      </p>
    </>
  );

  return (
    <section aria-label="Maç sonuçları" className="-mx-4 mb-4 overflow-hidden bg-[#060d14] text-white sm:mx-0 sm:rounded-3xl sm:border sm:border-white/10">
      {isTeam ? <ResultTabs match={match} table={<TeamTable supabase={supabase} groupId={groupId} squad={squad} myId={myId} />} /> : match}
    </section>
  );
}

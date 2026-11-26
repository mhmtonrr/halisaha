import { cx } from "@/components/ui";

export interface SummarySide {
  key: string;
  title: string;
  color: string;
  score: number | null;
  players: { id: string; name: string; goals: number; assists: number; saves: number }[];
}

/**
 * Maç özeti (oylamada ve sonrasında): skor ve kim kaç gol/asist/kurtarış yaptı.
 * `sides` tek elemanlıysa (rakip sistemde yok) skorun karşı tarafı `rival` ile verilir.
 */
export function MatchSummary({ sides, rival }: { sides: SummarySide[]; rival?: { title: string; score: number | null } }) {
  const scores = [...sides, ...(rival ? [rival] : [])];
  const lists = sides.map((s) => ({
    ...s,
    contributors: s.players
      .filter((p) => p.goals || p.assists || p.saves)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.saves - a.saves || a.name.localeCompare(b.name, "tr")),
  }));
  const any = lists.some((s) => s.contributors.length > 0);

  return (
    <section aria-label="Maç özeti" className="-mx-4 mb-4 bg-[#060d14] text-white sm:mx-0 sm:rounded-3xl sm:border sm:border-white/10">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5">
        {scores.map((s, i) => (
          <div key={i} className="contents">
            {i === 1 && <span className="text-2xl text-white/35">-</span>}
            <div className="min-w-0 text-center">
              <div className="font-display text-5xl font-black tabular-nums leading-none">{s.score}</div>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                {"color" in s && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: (s as SummarySide).color }} />}
                <span className="truncate text-xs font-bold uppercase text-white/60">{s.title}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {any ? (
        <div className={cx("grid border-t border-white/10", lists.length > 1 && "grid-cols-2 divide-x divide-white/10")}>
          {lists.map((s) => (
            <ul key={s.key} aria-label={`${s.title} katkıları`} className="min-w-0 space-y-2.5 p-3">
              {s.contributors.length === 0 && <li className="text-center text-xs text-white/40">Kayıt yok</li>}
              {s.contributors.map((p) => (
                <li key={p.id} className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold tabular-nums">
                    {p.goals > 0 && <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-accent">{p.goals} gol</span>}
                    {p.assists > 0 && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-white/80">{p.assists} asist</span>}
                    {p.saves > 0 && <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-amber-300">{p.saves} kurtarış</span>}
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : (
        <p className="border-t border-white/10 px-4 py-3 text-center text-xs text-white/45">Gol, asist ve kurtarış girilmedi.</p>
      )}
    </section>
  );
}

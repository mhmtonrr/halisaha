import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { cx } from "@/components/ui";
import { perMatch, type TableRank } from "@/lib/team-stats";

const COLS = "grid grid-cols-[2.25rem_minmax(0,1fr)_1.5rem_1.5rem_2.25rem_1.5rem_2rem_2rem] items-center gap-1 px-2";

/** Klasik lig tablosu: rating sırası, son takım maçına göre ▲▼ */
export function LeagueTable({
  groupId,
  rows,
  myId,
}: {
  groupId: string;
  rows: (TableRank & { photoUrl: string | null })[];
  myId?: string;
}) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-white/50">Henüz tabloya girecek maç yok.</p>;
  return (
    <>
      <div className={cx(COLS, "border-b border-white/10 py-2 text-center text-[10px] font-bold uppercase text-white/45")}>
        <span>#</span>
        <span className="text-left">Oyuncu</span>
        <abbr title="Maç" className="no-underline">M</abbr>
        <abbr title="Gol" className="no-underline">G</abbr>
        <abbr title="Maç başı gol" className="no-underline">G/M</abbr>
        <abbr title="Asist" className="no-underline">A</abbr>
        <span>MVP</span>
        <abbr title="Rating" className="no-underline">RTG</abbr>
      </div>
      <ol className="divide-y divide-white/5">
        {rows.map((r) => (
          <li key={r.playerId}>
            <Link
              href={`/g/${groupId}/p/${r.playerId}`}
              className={cx(COLS, "py-2 text-center text-xs tabular-nums transition hover:bg-white/10", r.playerId === myId && "bg-accent/10")}
            >
              <span className="flex flex-col items-center leading-none">
                <span className="text-sm font-black">{r.rank}</span>
                <span
                  className={cx(
                    "mt-0.5 text-[9px] font-bold",
                    r.move === null ? "text-sky-300" : r.move > 0 ? "text-accent" : r.move < 0 ? "text-red-400" : "text-white/30",
                  )}
                >
                  {r.move === null ? "YENİ" : r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : "–"}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-left">
                <Avatar name={r.name} photoUrl={r.photoUrl} className="h-7 w-7 bg-white/10 text-[10px] text-white" />
                <span className="truncate text-[13px] font-semibold">{r.name}</span>
              </span>
              <span className="text-white/60">{r.played}</span>
              <span className="font-bold">{r.goals}</span>
              <span className="text-white/60">{perMatch(r.goals, r.played)}</span>
              <span>{r.assists}</span>
              <span className="text-gold-1">{r.mvps}</span>
              <span className="font-display text-sm font-black text-accent">{r.overall}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="px-4 py-3 text-center text-xs text-white/45">
        Tüm zamanlar, asıl kadro. Sıra rating&apos;e göredir; ▲▼ takımın son maçından beri değişim.
      </p>
    </>
  );
}

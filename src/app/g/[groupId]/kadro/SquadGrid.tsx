"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlayerCard } from "@/components/PlayerCard";
import { cx } from "@/components/ui";
import { POSITION_NAME, POSITIONS, type Position } from "@/lib/data";

interface SquadPlayer {
  id: string;
  name: string;
  overall: number;
  position: Position | null;
  secondary: Position[];
  shirt: number | null;
  provisional: boolean;
  hasMatches: boolean;
  guest: boolean;
  city: string | null;
  district: string | null;
  /** Ödünç oyuncu (misafirler sekmesinde "ödünç" olarak görünür) */
  loan?: boolean;
  form: number | null;
  goals: number;
  played: number;
  skills: { key: string; value: number | null }[];
}

type SortKey = "overall" | "form" | "goals" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "overall", label: "Rating" },
  { key: "form", label: "Form" },
  { key: "goals", label: "Gol" },
  { key: "name", label: "İsim" },
];

export function SquadGrid({ groupId, players }: { groupId: string; players: SquadPlayer[] }) {
  const [filter, setFilter] = useState<Position | "ALL">("ALL");
  const [sort, setSort] = useState<SortKey>("overall");

  const shown = useMemo(() => {
    const list = players.filter(
      (p) => filter === "ALL" || p.position === filter || p.secondary.includes(filter),
    );
    const cmp: Record<SortKey, (a: SquadPlayer, b: SquadPlayer) => number> = {
      overall: (a, b) => Number(b.hasMatches) - Number(a.hasMatches) || b.overall - a.overall,
      form: (a, b) => (b.form ?? -1) - (a.form ?? -1),
      goals: (a, b) => b.goals - a.goals,
      name: (a, b) => a.name.localeCompare(b.name, "tr"),
    };
    return list.sort((a, b) => cmp[sort](a, b) || a.name.localeCompare(b.name, "tr"));
  }, [players, filter, sort]);

  const counts = Object.fromEntries(
    POSITIONS.map((pos) => [pos, players.filter((p) => p.position === pos).length]),
  ) as Record<Position, number>;

  const pill = (active: boolean) =>
    cx(
      "shrink-0 rounded-full px-3 py-1.5 text-sm transition",
      active ? "bg-accent text-pitch-950 font-semibold" : "bg-pitch-800 text-muted hover:bg-pitch-700",
    );

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className={pill(filter === "ALL")} onClick={() => setFilter("ALL")}>
          Tümü · {players.length}
        </button>
        {POSITIONS.map((pos) => (
          <button key={pos} className={pill(filter === pos)} onClick={() => setFilter(pos)}>
            {POSITION_NAME[pos]} · {counts[pos]}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        Sırala:
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={cx("rounded-lg px-2 py-1", sort === s.key ? "bg-pitch-700 text-white" : "hover:bg-pitch-800")}
          >
            {s.label}
          </button>
        ))}
      </div>

      {filter !== "ALL" && (
        <p className="mt-2 text-xs text-muted">Ana mevkisi veya oynayabildiği mevkiler arasında {POSITION_NAME[filter].toLocaleLowerCase("tr")} olanlar.</p>
      )}

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-muted">Bu mevkide oyuncu yok.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5">
          {shown.map((p) => (
            <Link key={p.id} href={`/g/${groupId}/p/${p.id}`} className="transition hover:scale-[1.02]">
              <PlayerCard
                size="sm"
                name={p.name}
                overall={p.overall}
                position={p.position}
                shirtNumber={p.shirt}
                provisional={p.provisional}
                skills={p.skills}
                city={p.city}
                district={p.district}
                unrated={!p.hasMatches}
              />
              <div className="mt-1 text-center text-[11px] text-muted">
                {p.played} maç{p.loan ? " · ödünç" : p.guest ? " · misafir" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted">
        HIZ hız · ŞUT şut · PAS pas · DRİ top sürme · DEF savunma · FİZ fizik (kalecide REF refleks · ATL atılma · HAV havadan top · YER yer tutma · DAĞ dağıtım · İLT iletişim). Değerler, birlikte oynayanların 1-10 puanlarından oluşur; “–” henüz yeterli puan yok demek.
      </p>
    </>
  );
}

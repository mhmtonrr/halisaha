"use client";

import Link from "next/link";
import { useState } from "react";
import { cx } from "@/components/ui";
import { PositionChip } from "@/components/PlayerCard";
import { formatDate, type Position } from "@/lib/data";
import type { Outcome, ProfileMatch } from "@/lib/profile-stats";

const letter: Record<Outcome, string> = { win: "G", draw: "B", loss: "M" };
const chipStyle: Record<Outcome, string> = {
  win: "bg-accent/20 text-accent",
  draw: "bg-tertiary/20 text-tertiary",
  loss: "bg-error-container/60 text-error",
};
const edge: Record<Outcome, string> = { win: "border-l-accent", draw: "border-l-tertiary", loss: "border-l-error" };
const scoreColor = (s: number) => (s >= 7.5 ? "text-accent" : s >= 5.5 ? "text-on-surface" : "text-error");

type Filter = "all" | Outcome;

/** Geçmiş maçlar: sonuç filtresi + sol kenarı sonuca göre renkli kartlar */
export function MatchesList({ matches, isMe, viewerGroups }: { matches: ProfileMatch[]; isMe: boolean; viewerGroups: string[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const open = new Set(viewerGroups);
  const count = (o: Outcome) => matches.filter((m) => m.outcome === o).length;
  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "Tümü", n: matches.length },
    { key: "win", label: "Galibiyet", n: count("win") },
    { key: "loss", label: "Mağlubiyet", n: count("loss") },
    { key: "draw", label: "Beraberlik", n: count("draw") },
  ];
  const shown = matches.filter((m) => filter === "all" || m.outcome === filter).slice(0, 50);

  return (
    <>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            aria-pressed={filter === c.key}
            className={cx(
              "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
              filter === c.key ? "border-accent bg-accent text-on-primary" : "border-line bg-surface-container text-on-surface-variant",
            )}
          >
            {c.label}
            <span className={cx("rounded-full px-1.5 tabular-nums", filter === c.key ? "bg-black/15" : "bg-white/10")}>{c.n}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider">
          <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
          Geçmiş maçlar
        </h2>
        <span className="text-xs text-muted">Son {shown.length} müsabaka</span>
      </div>
      {shown.length === 0 && <p className="rounded-2xl border border-line bg-surface-container p-4 text-center text-sm text-muted">Bu filtrede maç yok.</p>}
      <ul className="space-y-3">
        {shown.map((h) => {
          const nameOpen = isMe || h.groupKind === "team" || open.has(h.groupId);
          const linkable = h.groupKind === "team" || open.has(h.groupId);
          const title = h.kind === "external" ? `${h.groupName} ${h.scoreUs}-${h.scoreThem} ${h.opponentName ?? "Rakip"}` : `Kendi aramızda ${h.scoreUs}-${h.scoreThem}`;
          const shownTitle = nameOpen || h.kind !== "external" ? title : `Özel grup ${h.scoreUs}-${h.scoreThem} ${h.opponentName ?? "Rakip"}`;
          const body = (
            <div className={cx("rounded-2xl border border-l-4 border-line bg-surface-container p-4", edge[h.outcome])}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-muted">
                    {formatDate(h.playedAt)} · {nameOpen ? h.groupName : "Özel grup"}
                  </div>
                  <div className="mt-1 font-display text-base font-bold leading-snug">{shownTitle}</div>
                </div>
                <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", chipStyle[h.outcome])}>{letter[h.outcome]}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-low px-3 py-2 text-xs">
                {h.status === "voting" ? (
                  <span className="text-muted">oylamada</span>
                ) : h.matchScore !== null && h.weight > 0 ? (
                  <span className={cx("font-display text-xl font-black tabular-nums", scoreColor(h.matchScore))}>
                    {h.matchScore.toFixed(1)}
                    <span className="text-xs font-normal text-muted"> /10</span>
                  </span>
                ) : (
                  <span className="text-muted">puan yok</span>
                )}
                {h.mvp && <span className="rounded-full bg-accent/20 px-2 py-0.5 font-bold text-accent">MVP</span>}
                {h.goals > 0 && <span className="rounded-md bg-white/5 px-2 py-0.5">⚽ {h.goals} gol</span>}
                {h.assists > 0 && <span className="rounded-md bg-white/5 px-2 py-0.5">{h.assists} asist</span>}
                {h.saves > 0 && <span className="rounded-md bg-white/5 px-2 py-0.5">{h.saves} kurtarış</span>}
                <span className="ml-auto"><PositionChip position={h.position as Position | null} /></span>
              </div>
            </div>
          );
          return (
            <li key={h.matchId}>
              {linkable ? (
                <Link href={`/g/${h.groupId}/m/${h.matchId}`} className="block transition hover:brightness-110">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

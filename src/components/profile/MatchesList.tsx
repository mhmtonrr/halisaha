"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Outcome, ProfileMatch } from "@/lib/profile-stats";

const letter: Record<Outcome, string> = { win: "G", draw: "B", loss: "M" };
const chip: Record<Outcome, string> = { win: "bg-primary/20 text-primary", draw: "bg-tertiary/20 text-tertiary", loss: "bg-error/20 text-error" };
const bar: Record<Outcome, string> = { win: "bg-primary", draw: "bg-tertiary", loss: "bg-error" };
const scoreText: Record<Outcome, string> = { win: "text-primary", draw: "text-tertiary", loss: "text-error" };
const dot: Record<Outcome, string> = { win: "bg-primary", draw: "bg-tertiary", loss: "bg-error" };

type Filter = "all" | Outcome;

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });

/** Geçmiş maçlar: sonuç filtresi (Tümü/Galibiyet/Mağlubiyet/Beraberlik) + sol kenarı sonuca göre renkli kartlar */
export function MatchesList({ matches, isMe, viewerGroups, between }: { matches: ProfileMatch[]; isMe: boolean; viewerGroups: string[]; between?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const open = new Set(viewerGroups);
  const count = (o: Outcome) => matches.filter((m) => m.outcome === o).length;
  const filters: { key: Filter; label: string; n: number; o?: Outcome }[] = [
    { key: "all", label: "Tümü", n: matches.length },
    { key: "win", label: "Galibiyet", n: count("win"), o: "win" },
    { key: "loss", label: "Mağlubiyet", n: count("loss"), o: "loss" },
    { key: "draw", label: "Beraberlik", n: count("draw"), o: "draw" },
  ];
  const shown = matches.filter((m) => filter === "all" || m.outcome === filter).slice(0, 50);

  return (
    <>
      <section className="flex flex-col gap-2 pb-3 pt-1">
        <div className="no-scrollbar -mx-4 flex items-center gap-1 overflow-x-auto px-4 py-0.5">
          {filters.map((f) =>
            filter === f.key ? (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed className="t-label-caps flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-bold text-on-primary shadow-[0_0_12px_rgba(75,226,119,0.25)]">
                <span>{f.label}</span>
                <span className="rounded-full bg-on-primary/20 px-1.5 text-[10px]">{f.n}</span>
              </button>
            ) : (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={false} className="t-label-caps flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 font-medium text-on-surface-variant hover:text-on-surface">
                {f.o && <span className={cx("h-1.5 w-1.5 rounded-full", dot[f.o])} />}
                <span>{f.label}</span>
                <span className="text-[10px] text-on-surface-variant/70">{f.n}</span>
              </button>
            ),
          )}
        </div>
      </section>

      {between}

      <section className="flex flex-col gap-2 pb-5">
        <div className="flex items-center justify-between">
          <h2 className="t-label-caps uppercase tracking-widest text-on-surface-variant">GEÇMİŞ MAÇLAR</h2>
          <span className="t-body-sm text-on-surface-variant">Son {shown.length} Müsabaka</span>
        </div>
        {shown.length === 0 && <p className="rounded-xl bg-surface-container p-4 text-center text-sm text-on-surface-variant">Bu filtrede maç yok.</p>}
        <div className="flex flex-col gap-2">
          {shown.map((h) => {
            const nameOpen = isMe || h.groupKind === "team" || open.has(h.groupId);
            const linkable = h.groupKind === "team" || open.has(h.groupId);
            const us = nameOpen ? h.groupName : "Özel grup";
            const score = (
              <span className={cx("font-bold", scoreText[h.outcome])}>
                {h.scoreUs} - {h.scoreThem}
              </span>
            );
            const hatTrick = h.goals >= 3;
            const scored = h.status !== "voting" && h.matchScore !== null && h.weight > 0;
            const body = (
              <article className="relative flex flex-col gap-2 overflow-hidden rounded-xl bg-surface-container p-[14px] shadow-md transition-all hover:bg-surface-high">
                <div className={cx("absolute bottom-0 left-0 top-0 w-1", bar[h.outcome])} />
                <div className="flex items-start justify-between gap-2 pl-1">
                  <div className="flex min-w-0 flex-col">
                    <span className="t-body-sm text-on-surface-variant">
                      {dateLabel(h.playedAt)} • {h.venue || us}
                    </span>
                    <span className="t-headline-sm mt-0.5 text-on-surface">
                      {h.kind === "external" ? (
                        <>
                          {us} {score} {h.opponentName ?? "Rakip"}
                        </>
                      ) : (
                        <>
                          Kendi aramızda {score}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className={cx("t-stat-md flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", chip[h.outcome])}>{letter[h.outcome]}</span>
                    {linkable && <Icon name="chevron_right" className="text-[20px] text-on-surface-variant" />}
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-lg bg-surface-low p-2 pl-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {h.mvp && (
                        <div className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-on-primary shadow-[0_0_10px_rgba(75,226,119,0.3)]">
                          <Icon name="military_tech" fill className="text-[15px]" />
                          <span className="t-label-caps font-bold">MVP</span>
                        </div>
                      )}
                      {scored ? (
                        <div className="flex items-baseline gap-0.5">
                          <span className={cx("t-headline-md font-bold", h.outcome === "win" ? (h.matchScore! >= 9 ? "text-primary" : "text-secondary") : scoreText[h.outcome])}>{h.matchScore!.toFixed(1)}</span>
                          <span className="t-body-sm text-on-surface-variant">/10</span>
                        </div>
                      ) : (
                        <span className="t-body-sm text-on-surface-variant">{h.status === "voting" ? "Oylamada" : "Puan yok"}</span>
                      )}
                    </div>
                  </div>
                  {(h.goals > 0 || h.assists > 0 || h.saves > 0 || h.mvp) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {h.goals > 0 && (
                        <div className="flex items-center gap-1 rounded-md bg-surface-high px-2.5 py-1 text-on-surface">
                          <Icon name="sports_soccer" className="text-[14px] text-secondary" />
                          <span className="t-body-sm font-semibold">{h.goals} Gol{hatTrick ? " (Hat-trick)" : ""}</span>
                        </div>
                      )}
                      {h.assists > 0 && (
                        <div className="flex items-center gap-1 rounded-md bg-surface-high px-2.5 py-1 text-on-surface">
                          <Icon name="conversion_path" className="text-[14px] text-tertiary" />
                          <span className="t-body-sm font-semibold">{h.assists} Asist</span>
                        </div>
                      )}
                      {h.saves > 0 && (
                        <div className="flex items-center gap-1 rounded-md bg-surface-high px-2.5 py-1 text-on-surface">
                          <Icon name="sports_handball" className="text-[14px] text-tertiary" />
                          <span className="t-body-sm font-semibold">{h.saves} Kurtarış</span>
                        </div>
                      )}
                      {h.mvp && <span className="t-label-caps ml-auto text-[10px] font-bold uppercase tracking-wider text-primary">Yıldız Performans</span>}
                    </div>
                  )}
                </div>
              </article>
            );
            return (
              <div key={h.matchId}>
                {linkable ? <Link href={`/g/${h.groupId}/m/${h.matchId}`} className="block">{body}</Link> : body}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

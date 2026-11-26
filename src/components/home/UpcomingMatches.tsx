"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { DragStrip } from "@/components/home/DragStrip";
import { JoinMatchCard, JoinMatchPopup } from "@/components/JoinMatchCard";
import { cx } from "@/components/ui";

export interface UpcomingCard {
  id: string;
  href: string;
  status: { label: string; icon: string | null; tone: "neutral" | "on" | "warn" };
  /** "2 gün kaldı"; geçmiş maçta "Oynandı" */
  days: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  fee: string;
  pendingRival: boolean;
  count: number;
  capacity: number | null;
  /** Planlanmış maçta alt şeritteki düğme diziliş sahasına götürür */
  tactics: boolean;
}

/** Ana sayfa "Yaklaşan maçlar": yatay kart şeridi (fareyle de sürüklenir), "Tümü" alt alta açar; maç yoksa "Maça katıl" kartı */
export function UpcomingMatches({ matches }: { matches: UpcomingCard[] }) {
  const [all, setAll] = useState(false);

  return (
    <section>
      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap font-display text-[13px] font-bold uppercase tracking-tight text-on-surface">
          <span className="h-4 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="min-w-0">Yaklaşan maçlar</span>
        </h2>
        {matches.length > 0 && (
          <>
            <JoinMatchPopup />
            <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="flex min-h-9 shrink-0 items-center whitespace-nowrap text-[11px] font-semibold text-primary">
              {all ? "Daralt" : `Tümü (${matches.length})`}
              <Icon name={all ? "expand_less" : "chevron_right"} className="text-[16px]" />
            </button>
          </>
        )}
      </div>

      {matches.length === 0 ? (
        <JoinMatchCard />
      ) : all ? (
        <div className="flex flex-col gap-3">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} wide />
          ))}
        </div>
      ) : (
        <DragStrip className="pb-2 pt-1">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} wide={matches.length === 1} />
          ))}
        </DragStrip>
      )}
    </section>
  );
}

function MatchCard({ m, wide }: { m: UpcomingCard; wide: boolean }) {
  const full = !!m.capacity && m.count >= m.capacity;
  const { tone } = m.status;
  return (
    <article
      className={cx(
        "relative flex shrink-0 snap-start flex-col justify-between gap-4 overflow-hidden rounded-xl bg-surface-container p-4 shadow-lg",
        wide ? "w-full" : "w-[min(290px,calc(100vw-3.5rem))]",
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
      {/* Kartın her yeri maça gider */}
      <Link href={m.href} aria-label={m.title} className="absolute inset-0 z-[1]" />

      <div className="flex items-start justify-between gap-2">
        <span
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wide",
            tone === "on" ? "bg-primary/20 text-primary" : tone === "warn" ? "bg-amber-400/15 text-amber-300" : "bg-surface-high text-on-surface",
          )}
        >
          {m.status.icon ? <Icon name={m.status.icon} className="text-[14px]" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
          {m.status.label}
        </span>
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{m.days}</span>
      </div>

      <div className="min-w-0">
        <div className="mb-1 flex items-start gap-2">
          <Icon name="sports_soccer" className="text-[18px] leading-5 text-primary" />
          <h3 className="line-clamp-2 min-w-0 break-words font-display text-base font-bold leading-5 text-on-surface">{m.title}</h3>
        </div>
        <p className="flex items-center gap-1 text-[13px] text-on-surface-variant">
          <Icon name="calendar_today" className="text-[15px] text-muted" />
          <span className="font-medium text-on-surface">{m.date}</span> • {m.time}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-on-surface-variant">
          <Icon name="stadium" className="text-[15px] text-muted" />
          <span className="min-w-0 truncate">{m.venue}</span>
          <span className="shrink-0">• {m.fee}</span>
        </p>
        {m.pendingRival && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300">
            <Icon name="hourglass_top" className="text-[15px]" />
            Rakip onay bekliyor
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-low p-2">
        <span className="flex min-w-0 items-center gap-1 text-[13px] text-on-surface-variant">
          <Icon name={full ? "check" : "groups"} className="text-[16px] text-primary" />
          <span className="truncate tabular-nums">
            {full ? `Kadro Tamam (${m.count}/${m.capacity})` : `${m.count}/${m.capacity ?? "?"} Oyuncu`}
          </span>
        </span>
        <Link
          href={m.tactics ? `${m.href}#dizilis` : m.href}
          className={cx(
            "relative z-[2] shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 font-display text-xs font-bold shadow-sm",
            m.tactics ? "bg-surface-high text-on-surface hover:text-primary" : "bg-primary text-on-primary hover:opacity-90",
          )}
        >
          {m.tactics ? "Taktik Tahtası" : "Kadroya Bak"}
        </Link>
      </div>
    </article>
  );
}

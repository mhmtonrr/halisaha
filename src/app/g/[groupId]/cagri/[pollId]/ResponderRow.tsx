import Link from "next/link";
import type { ReactNode } from "react";
import type { Position } from "@/lib/data";
import type { Responder } from "@/lib/call-rules";
import { reliability } from "@/lib/reliability";
import { OvrBadge, PositionChip } from "@/components/PlayerCard";
import { cx } from "@/components/ui";

const TONE = { good: "text-accent", ok: "text-amber-300", bad: "text-red-300", new: "text-muted" } as const;

/** Yanıtlayan satırı: organizatöre güvenilirlik de görünür (played/no_shows sadece ona gelir) */
export function ResponderRow({ r, children }: { r: Responder; children?: ReactNode }) {
  const rel = r.played != null && r.no_shows != null ? reliability(r.played, r.no_shows) : null;
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <OvrBadge overall={r.overall} className="h-8 w-8 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/oyuncu/${r.user_id}`} className="truncate hover:underline">
              {r.display_name}
            </Link>
            <PositionChip position={(r.chosen_position ?? r.preferred_position) as Position | null} />
          </div>
          {rel && <div className={cx("text-xs", TONE[rel.tone])}>{rel.label}</div>}
        </div>
        {children}
      </div>
      {r.note && <p className="mt-1.5 rounded-lg bg-pitch-950 px-2 py-1 text-xs text-muted">“{r.note}”</p>}
    </li>
  );
}

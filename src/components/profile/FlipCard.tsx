"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

/** Kart çevirme: karta dokununca arka yüz (titanyum) açılır. İki yüz aynı grid hücresinde durur. */
export function FlipCard({ front, back }: { front: ReactNode; back: ReactNode }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="relative flex flex-col items-center justify-center" style={{ perspective: "1000px" }}>
      <div className="pointer-events-none absolute -inset-4 rounded-full bg-gradient-to-b from-slate-400/15 via-slate-500/10 to-transparent opacity-70 blur-xl" />
      <div
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        aria-label={flipped ? "Kartı ön yüze çevir" : "Kartı çevir"}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((f) => !f);
          }
        }}
        className="relative mx-auto grid w-60 cursor-pointer select-none transition-transform duration-500"
        style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "none" }}
      >
        <div className="relative col-start-1 row-start-1 drop-shadow-[0_12px_24px_rgba(0,0,0,0.65)]" style={{ backfaceVisibility: "hidden" }}>
          {front}
          <div className="pointer-events-none absolute right-2.5 top-2.5 z-30 flex items-center gap-1 rounded-full border border-slate-400/40 bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-slate-200 shadow-sm backdrop-blur-md">
            <span>Dokun &amp; Çevir</span>
            <Icon name="sync" className="text-[12px] text-slate-300" />
          </div>
        </div>
        <div className="col-start-1 row-start-1" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          {back}
        </div>
      </div>
    </div>
  );
}

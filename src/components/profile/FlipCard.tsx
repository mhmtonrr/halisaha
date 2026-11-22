"use client";

import { useState, type ReactNode } from "react";

/** Kartı çevirir: ön yüz kartın kendisi, arka yüz özet istatistikler. İki yüz aynı hücrede üst üste durur. */
export function FlipCard({ front, back }: { front: ReactNode; back: ReactNode }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div>
      <div className="mx-auto w-full max-w-60" style={{ perspective: "1000px" }}>
        <div
          className="grid transition-transform duration-500"
          style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "none" }}
        >
          <div className="col-start-1 row-start-1" style={{ backfaceVisibility: "hidden" }} aria-hidden={flipped}>
            {front}
          </div>
          <div
            className="col-start-1 row-start-1"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            aria-hidden={!flipped}
          >
            {back}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="mx-auto mt-2 flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-accent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
        </svg>
        {flipped ? "Ön yüze dön" : "Kartı çevir"}
      </button>
    </div>
  );
}

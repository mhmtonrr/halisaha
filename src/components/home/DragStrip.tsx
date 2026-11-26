"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";

/**
 * Kaydırma çubuğu olmayan yatay kart şeridi; kenarlara taşar. Dokunmatikte tarayıcı kendisi kaydırır,
 * fareyle sürüklenir (bırakınca tıklama sayılmaz).
 */
export function DragStrip({ children }: { children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, left: 0, moved: false, down: false });

  const onDown = (e: PointerEvent) => {
    drag.current.moved = false;
    if (e.pointerType !== "mouse" || e.button !== 0 || !strip.current) return;
    drag.current = { x: e.clientX, left: strip.current.scrollLeft, moved: false, down: true };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d.down || !strip.current) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 5) {
      d.moved = true;
      strip.current.style.scrollSnapType = "none";
    }
    if (d.moved) strip.current.scrollLeft = d.left - dx;
  };
  const onUp = () => {
    drag.current.down = false;
    if (strip.current) strip.current.style.scrollSnapType = "";
  };

  return (
    <div
      ref={strip}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onClickCapture={(e) => {
        if (drag.current.moved) {
          e.preventDefault();
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
      onDragStart={(e) => e.preventDefault()}
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 select-none gap-3 overflow-x-auto px-4 pb-1"
    >
      {children}
    </div>
  );
}

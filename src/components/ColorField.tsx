"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/color";
import { cx } from "./ui";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Parmakla/fareyle sürüklenen alan: konumu 0-1 aralığında bildirir, ok tuşlarıyla da kayar */
function drag(move: (x: number, y: number) => void, step: (dx: number, dy: number) => void) {
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    move(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  return {
    tabIndex: 0,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      step(d[0], d[1]);
    },
  };
}

const THUMB = "pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]";

/** Klasik renk seçici: üstte ton şeridinin rengine göre açıklık/doygunluk alanı, altında ton şeridi */
function ColorArea({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  // Siyah/gri renkte ton hex koddan geri okunamaz; seçilen konum burada tutulur, dışarıdan renk değişirse yenilenir
  const [kept, setKept] = useState<Hsv>(() => hexToHsv(value));
  const hsv = hsvToHex(kept) === value ? kept : hexToHsv(value);
  const set = (next: Partial<Hsv>) => {
    const n = { ...hsv, ...next };
    setKept(n);
    onChange(hsvToHex(n));
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-pitch-950 p-3">
      <div
        {...drag(
          (x, y) => set({ s: x, v: 1 - y }),
          (dx, dy) => set({ s: clamp(hsv.s + dx * 0.05), v: clamp(hsv.v - dy * 0.05) }),
        )}
        role="slider"
        aria-label={`${label}: açıklık ve doygunluk`}
        aria-valuenow={Math.round(hsv.v * 100)}
        aria-valuetext={value}
        className="relative h-44 cursor-crosshair touch-none rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
      >
        <span className={THUMB} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div
        {...drag(
          (x) => set({ h: x * 359 }),
          (dx, dy) => set({ h: Math.min(359, Math.max(0, hsv.h + (dx - dy) * 5)) }),
        )}
        role="slider"
        aria-label={`${label}: ton`}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hsv.h)}
        className="relative mx-3 h-6 cursor-pointer touch-none rounded-full"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span className={cx(THUMB, "top-1/2")} style={{ left: `${(hsv.h / 359) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
    </div>
  );
}

/** Renk satırı: dokununca açılan renk seçici + elle yazılabilen hex kodu. `name` verilirse formla gönderilir */
export function ColorField({ label, name, value, onChange }: { label: string; name?: string; value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  // Yazım sürerken yarım kod kutuda kalır; renk yalnızca 6 haneli kod tamamlanınca değişir
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`${label} seç`}
          className={cx("h-11 w-14 shrink-0 rounded-xl border border-white/25", open && "ring-2 ring-accent")}
          style={{ background: value }}
        />
        <input
          type="text"
          value={draft ?? value.toUpperCase()}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = e.target.value.trim().replace(/^#/, "");
            if (/^[0-9a-f]{6}$/i.test(hex)) onChange(`#${hex.toLowerCase()}`);
          }}
          onBlur={() => setDraft(null)}
          // Enter formu göndermesin
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label} hex kodu`}
          className="h-11 w-28 shrink-0 rounded-xl border border-line bg-pitch-950 px-3 font-mono text-sm uppercase outline-none focus:border-accent"
        />
      </div>
      {open && <ColorArea label={label} value={value} onChange={(c) => (setDraft(null), onChange(c))} />}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

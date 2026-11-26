"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Sekmeler; içerikler sunucuda çizilir, sadece görünürlük değişir (sayfa yenilenmez).
 * `pill`: tam genişlik hap çubuk (Takımlar/Gruplar); `chips`: küçük çipler (öne çıkanlar).
 */
export function HomeTabs({
  tabs,
  initial,
  variant = "pill",
  label,
}: {
  tabs: { key: string; label: string; content: ReactNode }[];
  initial: string;
  variant?: "pill" | "chips";
  label?: string;
}) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className={cx("mb-3 flex gap-1", variant === "pill" ? "rounded-full border border-line bg-surface-low p-1" : "no-scrollbar gap-2 overflow-x-auto")}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cx(
              "transition-colors",
              variant === "pill"
                ? cx("min-h-9 flex-1 rounded-full text-[13px]", active === t.key ? "bg-primary font-bold text-on-primary" : "font-semibold text-on-surface-variant hover:text-on-surface")
                : cx(
                    "min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-semibold",
                    active === t.key ? "border-primary/60 bg-primary/15 text-primary" : "border-line text-on-surface-variant hover:text-on-surface",
                  ),
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

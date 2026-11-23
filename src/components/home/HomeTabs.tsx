"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Hap sekmeler; içerikler sunucuda çizilir, sadece görünürlük değişir (sayfa yenilenmez) */
export function HomeTabs({ tabs, initial }: { tabs: { key: string; label: string; content: ReactNode }[]; initial: string }) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1 rounded-full border border-line bg-surface-low p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cx(
              "min-h-9 flex-1 rounded-full text-[13px] transition-colors",
              active === t.key ? "bg-primary font-bold text-on-primary" : "font-semibold text-on-surface-variant hover:text-on-surface",
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

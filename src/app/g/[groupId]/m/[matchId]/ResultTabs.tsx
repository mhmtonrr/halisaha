"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

const TABS = [
  { key: "match", label: "Bu maç" },
  { key: "table", label: "Puan tablosu" },
] as const;

export function ResultTabs({ match, table }: { match: ReactNode; table: ReactNode }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("match");
  return (
    <>
      <div role="tablist" className="flex gap-1 p-3 pb-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "min-h-11 flex-1 rounded-xl text-sm font-bold transition-colors",
              tab === t.key ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "match"}>{match}</div>
      <div hidden={tab !== "table"} className="pt-3">
        {table}
      </div>
    </>
  );
}

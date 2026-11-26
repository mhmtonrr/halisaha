"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";

export interface SortGroup {
  label?: string;
  options: { value: string; label: string }[];
}

/** Sıralama seçimi: değişince formu hemen gönderir */
export function SortSelect({ value, groups }: { value: string; groups: SortGroup[] }) {
  const items = (g: SortGroup) =>
    g.options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  return (
    <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-line bg-pitch-900/80 pl-3 focus-within:border-accent">
      <Icon name="swap_vert" className="text-[18px] text-muted" />
      <select
        name="sirala"
        defaultValue={value}
        onChange={(e) => e.target.form?.requestSubmit()}
        aria-label="Sırala"
        className="min-h-10 min-w-0 flex-1 rounded-xl bg-transparent pr-2 text-sm font-semibold outline-none [&_optgroup]:bg-pitch-950 [&_option]:bg-pitch-950"
      >
        {groups.map((g) =>
          g.label ? (
            <optgroup key={g.label} label={g.label}>
              {items(g)}
            </optgroup>
          ) : (
            items(g)
          ),
        )}
      </select>
    </label>
  );
}

/** Yan yana "Filtreler" düğmesi ve sıralama; panel kapalıyken de alanları formda kalır */
export function FilterSort({ count, sort, children }: { count: number; sort: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-pitch-900/80 px-3 text-sm font-semibold"
        >
          <Icon name="tune" className="text-[18px] text-muted" />
          Filtreler
          {count > 0 && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{count}</span>}
        </button>
        {sort}
      </div>
      <div data-filtre-paneli className={cx("space-y-4 rounded-2xl border border-line bg-pitch-900/80 p-4", !open && "hidden")}>
        {children}
      </div>
    </>
  );
}

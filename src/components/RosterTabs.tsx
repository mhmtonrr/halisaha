import Link from "next/link";
import { cx } from "./ui";

/**
 * Kadro / Misafirler sekmesi: asıl kadro (hesabı olan üyeler) ile maça misafir gelenler ayrı durur.
 * Sunucu tarafında çalışır (`?sekme=misafir`); misafir yoksa hiç görünmez.
 */
export function RosterTabs({
  base,
  active,
  members,
  guests,
  memberLabel,
}: {
  base: string;
  active: "kadro" | "misafir";
  members: number;
  guests: number;
  memberLabel: string;
}) {
  if (guests === 0) return null;
  const tabs = [
    { key: "kadro" as const, label: `${memberLabel} · ${members}`, href: base },
    { key: "misafir" as const, label: `Misafirler · ${guests}`, href: `${base}?sekme=misafir` },
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-pitch-900/80 p-1" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          replace
          role="tab"
          aria-selected={active === t.key}
          className={cx(
            "rounded-lg px-3 py-2 text-center text-sm font-semibold transition",
            active === t.key ? "bg-accent text-pitch-950" : "text-muted hover:bg-pitch-800",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

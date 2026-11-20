"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const HIDDEN = ["/login", "/auth", "/hosgeldin", "/privacy", "/sifre-yenile"];

const items = [
  {
    href: "/",
    label: "Ana sayfa",
    match: (p: string) => p === "/" || p.startsWith("/g/"),
    icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/kesfet",
    label: "Keşfet",
    match: (p: string) => p.startsWith("/kesfet"),
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
  },
  {
    href: "/profil",
    label: "Profil",
    match: (p: string) => p.startsWith("/profil"),
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </>
    ),
  },
];

export function BottomNav() {
  const path = usePathname();
  // Sohbet ekranında yazma kutusu alt kısmı kullanır
  if (HIDDEN.some((h) => path.startsWith(h)) || path.endsWith("/sohbet")) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => {
          const active = it.match(path);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cx(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
                active ? "text-accent" : "text-muted hover:text-white",
              )}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {it.icon}
              </svg>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { NotificationBadge } from "./NotificationBadge";

const HIDDEN = ["/login", "/auth", "/hosgeldin", "/privacy", "/sifre-yenile"];

const items = [
  {
    href: "/",
    label: "Ana sayfa",
    match: (p: string) => p === "/" || p.startsWith("/g/"),
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 8 3.5 2.5-1.3 4.1H9.8l-1.3-4.1zM12 8V3.2M15.5 10.5l4.6-1.4M14.2 14.6l2.8 3.9M9.8 14.6l-2.8 3.9M8.5 10.5 3.9 9.1" />
      </>
    ),
  },
  {
    href: "/kesfet",
    label: "Keşfet",
    match: (p: string) => p.startsWith("/kesfet"),
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </>
    ),
  },
  {
    href: "/bildirimler",
    label: "Bildirim",
    match: (p: string) => p.startsWith("/bildirimler"),
    icon: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
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
  if (HIDDEN.some((h) => path.startsWith(h)) || (path.endsWith("/sohbet") && path !== "/sohbet") || /^\/sohbet\/[^/]+/.test(path)) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 bg-pitch-950/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => {
          const active = it.match(path);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cx(
                "relative flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                active ? "text-accent" : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {it.icon}
              </svg>
              {it.label}
              {it.href === "/bildirimler" && <NotificationBadge />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

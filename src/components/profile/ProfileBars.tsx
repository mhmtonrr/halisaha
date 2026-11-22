"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/Avatar";
import { BackLink } from "@/components/NavHistory";
import { MenuControls } from "@/components/AppMenu";
import { useUnreadCount } from "@/components/NotificationBadge";

/** Tasarımdaki sabit üst çubuk: logo + "HALISAHA PRO / Profil", arama, bildirim, avatar */
export function ProfileTopBar({ name, photoUrl, showAvatar = true }: { name: string; photoUrl: string | null; showAvatar?: boolean }) {
  const unread = useUnreadCount();
  return (
    <div className="sticky top-0 z-40 -mx-4 flex h-16 items-center justify-between gap-2 bg-surface/80 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="Halısaha" className="h-8 w-8 shrink-0 object-contain" />
        <div className="flex min-w-0 flex-col">
          <span className="t-label-caps truncate uppercase tracking-widest text-primary">HALISAHA PRO</span>
          <h1 className="t-headline-sm truncate font-bold tracking-tight text-on-surface">Profil</h1>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Link href="/kesfet?sekme=oyuncu" aria-label="Oyuncu ara" className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:text-primary">
          <Icon name="search" className="text-[22px]" />
        </Link>
        <Link href="/bildirimler" aria-label="Bildirimler" className="relative flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant hover:text-primary">
          <Icon name="notifications" className="text-[22px]" />
          {unread > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary-container ring-2 ring-surface" />}
        </Link>
        {showAvatar && (
          <Link href="/profil" aria-label="Profilim" className="pl-1">
            <Avatar name={name} photoUrl={photoUrl} className="h-8 w-8 bg-surface-high text-[10px] text-primary ring-1 ring-outline-variant" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Alt başlık: geri oku, "Profilim" + sezon etiketi, bildirim ve menü */
export function ProfileSubBar({ title, subtitle, back = "/", right }: { title: ReactNode; subtitle: string; back?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-2 pt-1">
      <div className="flex min-w-0 items-center gap-2">
        <BackLink fallback={back}>
          <Icon name="arrow_back" className="text-[20px]" />
        </BackLink>
        <div className="flex min-w-0 flex-col">
          <span className="t-headline-sm truncate text-on-surface">{title}</span>
          <span className="t-label-caps truncate tracking-wider text-slate-300">{subtitle}</span>
        </div>
      </div>
      {right ?? <MenuControls />}
    </div>
  );
}

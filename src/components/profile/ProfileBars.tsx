"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { BackLink } from "@/components/NavHistory";
import { MenuControls } from "@/components/AppMenu";

/** Alt başlık: geri oku, "Profilim" + sezon etiketi, bildirim ve menü */
export function ProfileSubBar({ title, subtitle, back = "/", right }: { title: ReactNode; subtitle: string; back?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-2 pt-3">
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

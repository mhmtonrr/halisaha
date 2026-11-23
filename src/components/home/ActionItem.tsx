import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";

/** Yapılacaklar satırının aciliyet rengi: kehribar = hemen (oy, kadro), yeşil = yanıt bekleyen çağrı, mavi = teklif, nötr = bekleyiş */
export type ActionTone = "amber" | "green" | "blue" | "neutral";

const TONE: Record<ActionTone, { box: string; icon: string; pill: string }> = {
  amber: { box: "border-amber-400/40 bg-amber-400/10", icon: "bg-amber-400/20 text-amber-300", pill: "bg-amber-400 text-[#2b1d00]" },
  green: { box: "border-primary/35 bg-primary/10", icon: "bg-primary/15 text-primary", pill: "bg-primary text-on-primary" },
  blue: { box: "border-line bg-surface-container", icon: "bg-tertiary/15 text-tertiary", pill: "bg-tertiary text-[#00354a]" },
  neutral: { box: "border-line bg-surface-container", icon: "bg-surface-highest text-on-surface-variant", pill: "bg-surface-highest text-on-surface" },
};

/** Ana sayfa "Yapılacaklar" satırı. `children` varsa (ör. çağrıya hızlı yanıt) satırın altına eklenir. */
export function ActionItem({
  href,
  icon,
  tone,
  title,
  sub,
  cta,
  children,
  className,
}: {
  href: string;
  icon: string;
  tone: ActionTone;
  title: ReactNode;
  sub?: ReactNode;
  cta?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cx("rounded-xl border p-3", t.box, className)}>
      <Link href={href} className="flex items-center gap-3">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]", t.icon)}>
          <Icon name={icon} fill className="text-[22px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{title}</span>
          {sub && <span className="truncate text-xs text-on-surface-variant">{sub}</span>}
        </span>
        {cta ? (
          <span className={cx("shrink-0 rounded-full px-3.5 py-2 font-display text-[13px] font-bold", t.pill)}>{cta}</span>
        ) : (
          <Icon name="chevron_right" className="shrink-0 text-[22px] text-on-surface-variant" />
        )}
      </Link>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

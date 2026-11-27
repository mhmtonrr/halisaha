import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";

/** Ayarlar bölümü: yeşil küçük başlık + yuvarlak köşeli kart içinde satırlar */
export function SettingsSection({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <h4 className="t-label-caps uppercase tracking-widest text-primary">{title}</h4>
        {right && <span className="t-body-sm text-on-surface-variant">{right}</span>}
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl bg-surface-container shadow-sm">{children}</div>
    </section>
  );
}

export type Tone = "primary" | "secondary" | "tertiary" | "outline";
const toneText: Record<Tone, string> = { primary: "text-primary", secondary: "text-secondary", tertiary: "text-tertiary", outline: "text-outline" };

export function RowIcon({ icon, tone }: { icon: string; tone: Tone }) {
  return (
    <div className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-high", toneText[tone])}>
      <Icon name={icon} className="text-[22px]" />
    </div>
  );
}

export function RowText({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-base font-semibold text-on-surface">{title}</span>
      {subtitle && <span className="t-body-sm truncate text-on-surface-variant">{subtitle}</span>}
    </div>
  );
}

/** Bağlantı satırı: ikon, başlık/alt başlık, sağda değer ve ok */
export function SettingsLink({
  href,
  icon,
  tone,
  title,
  subtitle,
  value,
  chevron = true,
}: {
  href?: string;
  icon: string;
  tone: Tone;
  title: string;
  subtitle?: string;
  value?: ReactNode;
  chevron?: boolean;
}) {
  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-3.5">
        <RowIcon icon={icon} tone={tone} />
        <RowText title={title} subtitle={subtitle} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {value}
        {chevron && <Icon name="chevron_right" className="text-[20px] text-outline-variant" />}
      </div>
    </>
  );
  const cls = "flex items-center justify-between gap-2 bg-surface-container p-3.5";
  return href ? (
    <Link href={href} className={cx(cls, "transition-colors hover:bg-surface-high active:bg-surface-highest")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Seçim kutucuğu (içindeki radio/checkbox seçiliyse yeşil) ve çok satırlı metin alanı */
export const chip =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-surface-high px-1 text-center text-[13px] leading-tight text-on-surface-variant has-checked:bg-primary has-checked:font-semibold has-checked:text-on-primary";
export const textareaClass =
  "w-full rounded-xl border border-line bg-surface-low p-3 text-sm text-on-surface outline-none placeholder:text-muted/60 focus:border-primary";

/** Alt ekran iskeleti için form alanı/kart stilleri */
export const fieldCard = "rounded-xl bg-surface-container p-3.5 shadow-sm";
export const primaryButton = "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-display font-bold text-on-primary shadow-[0_0_16px_rgba(75,226,119,0.3)] active:scale-[0.99]";

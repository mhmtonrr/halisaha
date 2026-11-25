import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { BackLink } from "./NavHistory";
import { MenuControls } from "./AppMenu";
import { Icon } from "./Icon";

/** Sınıf birleştirici: çakışan Tailwind sınıflarında sonradan verilen kazanır (ör. Card'a verilen vurgu zemini) */
const cx = (...c: (string | false | null | undefined)[]) => twMerge(...c);

/** Obsidian Pitch kartı (profildeki yüzey): koyu yüzey, ince kenar */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-line bg-surface-container p-4 shadow-sm", className)} {...props} />;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary font-display font-bold text-on-primary hover:bg-primary-container hover:shadow-[0_0_20px_rgba(34,197,94,0.35)]",
  secondary: "border border-white/12 bg-surface-container font-semibold text-on-surface hover:bg-surface-high",
  ghost: "text-on-surface-variant hover:bg-surface-high",
  danger: "border border-red-900 text-red-300 hover:bg-red-950",
};
const buttonBase = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition active:scale-[0.98]";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, "disabled:opacity-50 disabled:active:scale-100", variants[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cx(
        "min-h-11 w-full rounded-xl border border-line bg-surface-low px-3 text-sm text-on-surface outline-none transition placeholder:text-muted/60 focus:border-primary focus:ring-1 focus:ring-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="t-label-caps mb-1.5 block uppercase text-on-surface-variant">
      {children}
      {hint && <span className="ml-1 font-sans font-medium normal-case tracking-normal opacity-70">({hint})</span>}
    </span>
  );
}

/** Bölüm başlığı: sol yeşil çubuk + büyük harf (profildeki başlıkla aynı dil) */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 font-display text-base font-bold uppercase tracking-wider text-on-surface">
        <span className="h-4 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        <span className="min-w-0">{children}</span>
      </h2>
      {action}
    </div>
  );
}

/** `leading`: geri okunun yerine geçen özel düğme (ör. sihirbazda önceki adım) */
export function Header({ title, back, right, leading }: { title: ReactNode; back?: string; right?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 py-4">
      {leading}
      {back && !leading && (
        <BackLink fallback={back}>
          <Icon name="arrow_back" className="text-[22px]" />
        </BackLink>
      )}
      <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight">{title}</h1>
      {right}
      <MenuControls />
    </header>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" }) {
  const tones = {
    default: "bg-surface-highest text-on-surface-variant",
    accent: "bg-primary/15 text-primary",
    warn: "bg-amber-400/15 text-amber-300",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-display text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/40 px-3 py-2 text-sm text-error">
      <Icon name="error" className="mt-0.5 text-[18px]" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

export { cx };

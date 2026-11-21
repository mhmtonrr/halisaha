import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { BackLink } from "./NavHistory";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-2xl border border-line bg-pitch-900/80 p-4", className)}
      {...props}
    />
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-pitch-950 hover:bg-accent-strong font-semibold",
  secondary: "border border-line bg-pitch-800 hover:bg-pitch-700",
  ghost: "hover:bg-pitch-800 text-muted",
  danger: "border border-red-900 text-red-300 hover:bg-red-950",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cx(
        "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
      {children}
      {hint && <span className="ml-1 normal-case tracking-normal opacity-70">({hint})</span>}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Header({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 py-4">
      {back && (
        <BackLink fallback={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </BackLink>
      )}
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" }) {
  const tones = {
    default: "bg-pitch-700 text-muted",
    accent: "bg-accent/15 text-accent",
    warn: "bg-amber-400/15 text-amber-300",
  };
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-3 rounded-xl bg-red-950/60 px-3 py-2 text-sm text-red-300">{message}</p>;
}

export { cx };

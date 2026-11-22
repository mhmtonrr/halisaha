import { cx } from "./ui";

/** Material Symbols ikonu (tasarımdaki adlarla). `fill` dolu varyantı açar. */
export function Icon({ name, className, fill }: { name: string; className?: string; fill?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx("material-symbols-outlined", className)}
      style={fill ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
    >
      {name}
    </span>
  );
}

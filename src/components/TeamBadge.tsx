import { cx } from "./ui";

/** Takım/grup için renkli rozet: baş harfler */
export function TeamBadge({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  color: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
  const bg = color ?? "#1a5a36";
  // Açık renklerde koyu yazı
  const light = parseInt(bg.slice(1, 3), 16) * 0.299 + parseInt(bg.slice(3, 5), 16) * 0.587 + parseInt(bg.slice(5, 7), 16) * 0.114 > 160;
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-black shadow-inner",
        size === "sm" && "h-8 w-8 text-xs",
        size === "md" && "h-11 w-11 text-sm",
        size === "lg" && "h-16 w-16 rounded-2xl text-xl",
        light ? "text-pitch-950" : "text-white",
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${bg}, ${bg}cc)` }}
    >
      {letters || "?"}
    </span>
  );
}

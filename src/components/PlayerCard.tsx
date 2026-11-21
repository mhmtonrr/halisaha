import { cx } from "./ui";
import { POSITION_LABEL, type Position } from "@/lib/data";
import type { Attribute } from "@/lib/attributes";

type Tier = "gold" | "silver" | "bronze";

export function tierOf(overall: number): Tier {
  // Ortalama oyuncu 65: grubun çoğu gümüş, öne çıkanlar altın, geride kalanlar bronz
  if (overall >= 72) return "gold";
  if (overall >= 60) return "silver";
  return "bronze";
}

const tierStyle: Record<Tier, string> = {
  gold: "from-gold-1 to-gold-2 text-[#3b2a05]",
  silver: "from-silver-1 to-silver-2 text-[#1f262d]",
  bronze: "from-bronze-1 to-bronze-2 text-[#3a1d0a]",
};

/** Rating seviyesine göre kart rengi (altın/gümüş/bronz); küçük kartlar için dışa açık */
export const tierClass = (overall: number) => tierStyle[tierOf(overall)];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((s) => s[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
}

/** "Ahmet Yılmaz" → "Ahmet Y."; dar alanlar için */
export function shortName(name: string) {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length < 2) return words[0] ?? name;
  return `${words[0]} ${words[words.length - 1][0]}.`;
}

/** Küçük rating rozeti (listelerde) */
export function OvrBadge({ overall, className }: { overall: number; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-black",
        tierStyle[tierOf(overall)],
        className,
      )}
    >
      {overall}
    </span>
  );
}

const POSITION_COLOR: Record<Position, string> = {
  GK: "bg-amber-400/20 text-amber-300",
  DEF: "bg-sky-400/20 text-sky-300",
  MID: "bg-emerald-400/20 text-emerald-300",
  FWD: "bg-rose-400/20 text-rose-300",
};

export function PositionChip({ position, className }: { position: Position | null; className?: string }) {
  if (!position) return null;
  return (
    <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-bold", POSITION_COLOR[position], className)}>
      {POSITION_LABEL[position]}
    </span>
  );
}

export function PlayerCard({
  name,
  overall,
  position,
  attributes,
  provisional,
  shirtNumber,
  size = "lg",
}: {
  name: string;
  overall: number;
  position: Position | null;
  attributes: Pick<Attribute, "key" | "value">[];
  provisional?: boolean;
  shirtNumber?: number | null;
  size?: "lg" | "sm";
}) {
  const sm = size === "sm";
  return (
    <div
      className={cx(
        "relative mx-auto overflow-hidden bg-gradient-to-b shadow-2xl",
        sm ? "w-full max-w-44 p-2.5 pb-4" : "w-60 p-4 pb-6",
        tierStyle[tierOf(overall)],
      )}
      style={{ clipPath: "polygon(50% 0, 100% 7%, 100% 88%, 50% 100%, 0 88%, 0 7%)" }}
    >
      <div className={cx("flex items-start justify-between", sm ? "pt-2" : "pt-3")}>
        <div className="text-center leading-none">
          <div className={cx("font-black", sm ? "text-3xl" : "text-5xl")}>{overall}</div>
          <div className={cx("mt-1 font-bold", sm ? "text-xs" : "text-sm")}>
            {position ? POSITION_LABEL[position] : "—"}
          </div>
        </div>
        <div
          className={cx(
            "relative flex items-center justify-center rounded-full bg-black/10 font-black",
            sm ? "h-12 w-12 text-base" : "h-20 w-20 text-2xl",
          )}
        >
          {initials(name)}
          {shirtNumber != null && (
            <span
              className={cx(
                "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-black/25 font-black text-white",
                sm ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-xs",
              )}
            >
              {shirtNumber}
            </span>
          )}
        </div>
      </div>
      <div
        className={cx(
          "truncate border-b border-black/15 text-center font-extrabold uppercase",
          sm ? "mt-1.5 pb-0.5 text-xs" : "mt-3 pb-1 text-lg",
        )}
      >
        {sm ? shortName(name) : name}
      </div>
      <div className={cx("grid grid-cols-2", sm ? "mt-1 gap-x-1 text-[11px]" : "mt-2 gap-x-4 gap-y-1 px-2 text-sm")}>
        {attributes.map((a) => (
          <div key={a.key} className="flex items-baseline gap-1">
            <span className={cx("text-right font-black tabular-nums", sm ? "w-5" : "w-7")}>{a.value ?? "–"}</span>
            <span className="font-semibold opacity-80">{a.key}</span>
          </div>
        ))}
      </div>
      {provisional && (
        <div className={cx("text-center font-bold uppercase opacity-70", sm ? "mt-1 text-[8px]" : "mt-2 text-[10px]")}>
          Geçici puan
        </div>
      )}
    </div>
  );
}

import { cx } from "./ui";
import { POSITION_LABEL, type Position } from "@/lib/data";

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

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((s) => s[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
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

export function PlayerCard({
  name,
  overall,
  position,
  stats,
  provisional,
}: {
  name: string;
  overall: number;
  position: Position | null;
  stats: { label: string; value: number | string }[];
  provisional?: boolean;
}) {
  const tier = tierOf(overall);
  return (
    <div
      className={cx(
        "relative mx-auto w-56 overflow-hidden bg-gradient-to-b p-4 pb-5 shadow-2xl",
        tierStyle[tier],
      )}
      style={{ clipPath: "polygon(50% 0, 100% 7%, 100% 88%, 50% 100%, 0 88%, 0 7%)" }}
    >
      <div className="flex items-start justify-between pt-3">
        <div className="text-center leading-none">
          <div className="text-5xl font-black">{overall}</div>
          <div className="mt-1 text-sm font-bold">{position ? POSITION_LABEL[position] : "—"}</div>
        </div>
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/10 text-2xl font-black">
          {initials(name)}
        </div>
      </div>
      <div className="mt-3 truncate border-b border-black/15 pb-1 text-center text-lg font-extrabold uppercase">
        {name}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 px-2 text-sm">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="w-7 text-right font-black tabular-nums">{s.value}</span>
            <span className="font-semibold opacity-80">{s.label}</span>
          </div>
        ))}
      </div>
      {provisional && (
        <div className="mt-2 text-center text-[10px] font-bold uppercase opacity-70">Geçici puan</div>
      )}
    </div>
  );
}

/** "Ahmet Yılmaz" → "Ahmet Y."; dar alanlar için */
export function shortName(name: string) {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length < 2) return words[0] ?? name;
  return `${words[0]} ${words[words.length - 1][0]}.`;
}

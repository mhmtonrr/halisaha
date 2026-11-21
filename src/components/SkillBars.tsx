import { cx } from "./ui";
import { skillSet } from "@/lib/skills";

// Yetenekler 40 ile 99 arasında; çubuk bu aralığa göre dolar
const barWidth = (v: number) => Math.max(3, ((v - 40) / 59) * 100);
const barColor = (v: number) => (v >= 80 ? "bg-accent" : v >= 65 ? "bg-accent/60" : "bg-muted/50");

/** Kartın 6 yeteneği çubuk olarak; değeri olmayan yetenek "–" */
export function SkillBars({ skills, keeper }: { skills: { key: string; value: number | null }[]; keeper: boolean }) {
  return (
    <div className="space-y-3">
      {skillSet(keeper).map((sk) => {
        const v = skills.find((x) => x.key === sk.key)?.value ?? null;
        return (
          <div key={sk.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>
                <b className="mr-2 inline-block w-9 text-xs text-muted">{sk.key}</b>
                {sk.label}
              </span>
              <span className="text-lg font-black tabular-nums">{v ?? "–"}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-pitch-950">
              {v !== null && <div className={cx("h-full rounded-full", barColor(v))} style={{ width: `${barWidth(v)}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

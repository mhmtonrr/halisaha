import { skillSet } from "@/lib/skills";

/** 6 yeteneğin radar grafiği (40-99 ölçeği); değeri olmayan yetenek merkezde (40) sayılır */
export function RadarChart({ skills, keeper }: { skills: { key: string; value: number | null }[]; keeper: boolean }) {
  const set = skillSet(keeper);
  const n = set.length;
  const c = 120;
  const r = 78;
  const point = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * r * f, c + Math.sin(a) * r * f] as const;
  };
  const val = (key: string) => skills.find((x) => x.key === key)?.value ?? null;
  const frac = (v: number | null) => (v === null ? 0.05 : Math.max(0.05, (v - 40) / 59));
  const ring = (f: number) => set.map((_, i) => point(i, f).join(",")).join(" ");
  const shape = set.map((s, i) => point(i, frac(val(s.key))).join(",")).join(" ");

  return (
    <svg viewBox="0 0 240 240" className="mx-auto w-full max-w-72" role="img" aria-label="Yetenek dağılımı">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="currentColor" className="text-white/10" strokeWidth="1" />
      ))}
      {set.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="currentColor" className="text-white/10" strokeWidth="1" />;
      })}
      <polygon points={shape} fill="var(--color-accent)" fillOpacity="0.25" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
      {set.map((s, i) => {
        const v = val(s.key);
        const [px, py] = point(i, frac(v));
        const [lx, ly] = point(i, 1.3);
        return (
          <g key={s.key}>
            <circle cx={px} cy={py} r="3.5" fill="var(--color-accent)" />
            <text x={lx} y={ly - 2} textAnchor="middle" className="fill-on-surface-variant" fontSize="9" fontWeight="700">
              {s.key}
            </text>
            <text x={lx} y={ly + 9} textAnchor="middle" className="fill-accent" fontSize="10" fontWeight="800">
              {v ?? "–"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

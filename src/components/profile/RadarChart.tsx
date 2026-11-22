import { skillSet } from "@/lib/skills";

// Tasarımdaki altıgen (merkez 140,120): üst, sağ üst, sağ alt, alt, sol alt, sol üst
const CENTER: [number, number] = [140, 120];
const VERTS: [number, number][] = [[140, 25], [225, 65], [225, 175], [140, 215], [55, 175], [55, 65]];
// Tasarımdaki eksen sırası (saat yönü): HIZ, ŞUT, PAS, FİZ, DEF, DRİ
const FIELD_ORDER = ["HIZ", "ŞUT", "PAS", "FİZ", "DEF", "DRİ"];
// Etiket konumları ve hizası
const LABELS: { x: number; y: number; anchor: "middle" | "start" | "end" }[] = [
  { x: 140, y: 14, anchor: "middle" },
  { x: 238, y: 65, anchor: "start" },
  { x: 238, y: 180, anchor: "start" },
  { x: 140, y: 233, anchor: "middle" },
  { x: 42, y: 180, anchor: "end" },
  { x: 42, y: 65, anchor: "end" },
];

const at = (i: number, f: number) => [CENTER[0] + (VERTS[i][0] - CENTER[0]) * f, CENTER[1] + (VERTS[i][1] - CENTER[1]) * f] as const;
const pts = (f: (i: number) => number) => VERTS.map((_, i) => at(i, f(i)).map((n) => Math.round(n * 10) / 10).join(",")).join(" ");

/** Performans dağılımı: 6 yetenek (değer/100), tasarımdaki altıgen radar */
export function RadarChart({ skills, keeper }: { skills: { key: string; value: number | null }[]; keeper: boolean }) {
  const keys = keeper ? skillSet(true).map((s) => s.key as string) : FIELD_ORDER;
  const val = (k: string) => skills.find((x) => x.key === k)?.value ?? null;
  const frac = (i: number) => Math.max(0.05, (val(keys[i]) ?? 40) / 100);
  const known = keys.map((k) => val(k)).filter((v): v is number => v !== null);
  const max = known.length ? Math.max(...known) : null;
  const min = known.length ? Math.min(...known) : null;

  return (
    <svg viewBox="0 0 280 240" className="h-auto w-full max-w-[280px] overflow-visible" role="img" aria-label="Performans dağılımı">
      <polygon points={pts(() => 1)} fill="none" stroke="rgba(212,228,250,0.08)" strokeWidth="1.5" />
      <polygon points={pts(() => 0.68)} fill="none" stroke="rgba(212,228,250,0.06)" strokeWidth="1.5" />
      <polygon points={pts(() => 0.33)} fill="none" stroke="rgba(212,228,250,0.04)" strokeWidth="1" />
      {VERTS.map((v, i) => (
        <line key={i} x1={CENTER[0]} y1={CENTER[1]} x2={v[0]} y2={v[1]} stroke="rgba(212,228,250,0.1)" strokeDasharray="2 2" strokeWidth="1" />
      ))}
      <polygon points={pts(frac)} fill="rgba(75,226,119,0.22)" stroke="#4be277" strokeWidth="2.5" strokeLinejoin="round" />
      {keys.map((_, i) => {
        const [x, y] = at(i, frac(i));
        return <circle key={i} cx={x} cy={y} r="3.5" fill="#4be277" />;
      })}
      {keys.map((k, i) => {
        const v = val(k);
        const color = v === null ? "#bccbb9" : v === max ? "#4be277" : v === min && known.length > 2 ? "#bccbb9" : "#d4e4fa";
        return (
          <text key={k} x={LABELS[i].x} y={LABELS[i].y} textAnchor={LABELS[i].anchor} fill={color} fontSize="10" fontWeight="700" style={{ fontFamily: "var(--font-display)" }}>
            {k} {v ?? "–"}
          </text>
        );
      })}
    </svg>
  );
}

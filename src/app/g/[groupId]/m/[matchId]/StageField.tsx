// Diziliş sahnesinin zemini: perspektifli gece maçı sahası (ışıklar, çim şeritleri, çizgiler).
// Koordinatlar yüzde: x 0-100 soldan sağa, y 0-100 uzak kaleden yakın kaleye.

/** Uzaktaki satırlar daralır: `top` en uzak kenarın yakın kenara oranı */
export function project(x: number, y: number, top: number) {
  const scale = top + ((1 - top) * y) / 100;
  return { x: 50 + (x - 50) * scale, y };
}

export function Field({
  children,
  aspect,
  top,
  color,
  bottomColor,
  cardPct = 17,
}: {
  children: React.ReactNode;
  /** Yükseklik / genişlik */
  aspect: number;
  top: number;
  /** Uzak taraftaki renkli ışık */
  color: string;
  bottomColor?: string;
  /** Oyuncu kartının saha genişliğine oranı (%) */
  cardPct?: number;
}) {
  const H = 100 * aspect;
  const pt = (x: number, y: number) => {
    const p = project(x, y, top);
    return `${p.x.toFixed(2)},${((p.y / 100) * H).toFixed(2)}`;
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => [pt(x1, y1), pt(x2, y1), pt(x2, y2), pt(x1, y2)].join(" ");
  const ellipse = (cx: number, cy: number, rx: number, ry: number, from = 0, to = 2 * Math.PI) =>
    Array.from({ length: 41 }, (_, i) => {
      const a = from + ((to - from) * i) / 40;
      return pt(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }).join(" ");
  const ry = 11.5 / aspect;
  const bands = 10;

  return (
    <div
      className="relative isolate w-full overflow-hidden"
      // Kartlar bu kapsayıcının genişliğine göre ölçeklenir (cqw); --cw kart genişliği yüzdesi
      style={{ aspectRatio: `1 / ${aspect}`, containerType: "inline-size", ["--cw" as string]: cardPct }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="hs-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a3d2a" />
            <stop offset="0.55" stopColor="#14693f" />
            <stop offset="1" stopColor="#0e5233" />
          </linearGradient>
          <radialGradient id="hs-light">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-far">
            <stop offset="0" stopColor={color} stopOpacity="0.32" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-near">
            <stop offset="0" stopColor={bottomColor ?? color} stopOpacity="0.28" />
            <stop offset="1" stopColor={bottomColor ?? color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <polygon points={quad(0, 0, 100, 100)} fill="url(#hs-grass)" />
        {Array.from({ length: bands / 2 }, (_, i) => (
          <polygon key={i} points={quad(0, (i * 200) / bands, 100, (i * 200) / bands + 100 / bands)} fill="#ffffff" opacity="0.045" />
        ))}
        {/* Takım ışığı ve projektörler */}
        <ellipse cx="50" cy="0" rx="62" ry={H * 0.3} fill="url(#hs-far)" />
        <ellipse cx="50" cy={H} rx="62" ry={H * 0.25} fill="url(#hs-near)" />
        <ellipse cx="2" cy="0" rx="46" ry="46" fill="url(#hs-light)" />
        <ellipse cx="98" cy="0" rx="46" ry="46" fill="url(#hs-light)" />
        <g fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.45" strokeLinejoin="round">
          <polygon points={quad(3, 2, 97, 98)} />
          <polyline points={`${pt(3, 50)} ${pt(97, 50)}`} />
          <polygon points={ellipse(50, 50, 13, ry)} />
          <polygon points={quad(25, 2, 75, 2 + 20 / aspect)} />
          <polygon points={quad(38, 2, 62, 2 + 8 / aspect)} />
          <polygon points={quad(25, 98 - 20 / aspect, 75, 98)} />
          <polygon points={quad(38, 98 - 8 / aspect, 62, 98)} />
          <polyline points={ellipse(50, 2 + 20 / aspect, 9, 7 / aspect, 0.15 * Math.PI, 0.85 * Math.PI)} />
          <polyline points={ellipse(50, 98 - 20 / aspect, 9, 7 / aspect, 1.15 * Math.PI, 1.85 * Math.PI)} />
        </g>
        <circle cx="50" cy={H / 2} r="0.8" fill="#ffffff" opacity="0.6" />
      </svg>
      {/* Kenar karartması */}
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 14cqw rgba(2,8,14,0.75)" }} />
      {children}
    </div>
  );
}

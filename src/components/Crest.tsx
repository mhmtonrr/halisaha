import { useId, type ReactNode } from "react";
import { teamInitials, type CrestEmblem, type CrestPattern, type CrestShape, type CrestSpec } from "@/lib/crest";

/** Arma dış çizgileri (100x100 tuval) */
const SHAPES: Record<CrestShape, string> = {
  kalkan: "M50 3 L93 14 V50 C93 75 74 89 50 97 C26 89 7 75 7 50 V14 Z",
  daire: "M50 3 a47 47 0 1 1 0 94 a47 47 0 1 1 0 -94 Z",
  altigen: "M50 3 L91 26.5 V73.5 L50 97 L9 73.5 V26.5 Z",
  flama: "M9 5 H91 V68 L50 97 L9 68 Z",
};

function pattern(kind: CrestPattern, color: string): ReactNode {
  if (kind === "cizgili")
    return (
      <g fill={color}>
        <rect x="21" width="14" height="100" />
        <rect x="65" width="14" height="100" />
        <rect x="43" width="14" height="100" />
      </g>
    );
  if (kind === "capraz") return <path d="M-5 72 L72 -5 H105 V28 L28 105 H-5 Z" fill={color} />;
  if (kind === "yarim") return <rect x="50" width="50" height="100" fill={color} />;
  return <path d={SHAPES.daire} fill={color} transform="translate(50 50) scale(.72) translate(-50 -50)" />;
}

/** Semboller: 100x100 tuvalde ortalı; `ink` ana boya, `cut` oyuk ayrıntılar */
function emblem(kind: Exclude<CrestEmblem, "harf">, ink: string, cut: string): ReactNode {
  switch (kind) {
    case "top":
      return (
        <>
          <circle cx="50" cy="50" r="26" fill={ink} />
          <path d="M50 39 L60.5 46.6 L56.5 59 H43.5 L39.5 46.6 Z" fill={cut} />
          <path d="M50 39 V25 M60.5 46.6 L74 42 M56.5 59 L65 71 M43.5 59 L35 71 M39.5 46.6 L26 42" stroke={cut} strokeWidth="3" fill="none" />
        </>
      );
    case "yildiz":
      return <path fill={ink} d="M50 20 L57.6 40.5 L79.5 41.4 L62.4 55 L68.2 76.1 L50 64 L31.8 76.1 L37.6 55 L20.5 41.4 L42.4 40.5 Z" />;
    case "simsek":
      return <path fill={ink} d="M57 17 L30 55 H46 L40 83 L72 42 H54 L64 17 Z" />;
    case "tac":
      return (
        <path fill={ink} d="M24 66 L20 33 L36 47 L50 24 L64 47 L80 33 L76 66 Z M25 70 H75 V78 H25 Z" />
      );
    case "alev":
      return (
        <>
          <path fill={ink} d="M52 17 C56 32 74 40 73 58 C73 72 63 81 50 81 C37 81 27 72 27 59 C27 49 33 43 38 37 C39 45 42 48 46 49 C43 36 46 25 52 17 Z" />
          <path fill={cut} d="M50 52 C53 60 61 62 60 70 C59 75 55 77 50 77 C45 77 41 74 41 69 C41 63 47 60 50 52 Z" />
        </>
      );
    case "kale":
      return (
        <>
          <path fill={ink} d="M25 79 V28 H34 V35 H42 V28 H58 V35 H66 V28 H75 V79 Z" />
          <path fill={cut} d="M42 79 V64 C42 53 58 53 58 64 V79 Z M33 45 H40 V54 H33 Z M60 45 H67 V54 H60 Z" />
        </>
      );
    case "capa":
      return (
        <g stroke={ink} strokeWidth="6.5" fill="none" strokeLinecap="round">
          <circle cx="50" cy="26" r="6.5" />
          <path d="M50 33 V78 M36 43 H64 M25 57 C27 71 38 78 50 78 C62 78 73 71 75 57" />
          <path d="M20 63 L25 55 L33 61 M67 61 L75 55 L80 63" />
        </g>
      );
    case "kartal":
      return (
        <>
          <path fill={ink} d="M50 40 C42 28 28 22 14 24 C20 28 22 31 23 34 C18 34 15 36 13 38 C21 40 24 43 26 46 C22 47 20 49 19 52 C28 52 35 55 42 60 L38 78 L50 71 L62 78 L58 60 C65 55 72 52 81 52 C80 49 78 47 74 46 C76 43 79 40 87 38 C85 36 82 34 77 34 C78 31 80 28 86 24 C72 22 58 28 50 40 Z" />
          <path fill={ink} d="M43 36 C43 27 48 23 53 23 C58 23 61 27 61 31 L69 34 L60 37 C59 42 55 46 50 47 C46 45 43 41 43 36 Z" />
          <circle cx="54" cy="30" r="2" fill={cut} />
        </>
      );
    case "aslan":
      return (
        <>
          <path fill={ink} d="M50 15 L59 24 L72 21 L73 34 L84 41 L76 51 L83 63 L70 66 L69 79 L57 76 L50 86 L43 76 L31 79 L30 66 L17 63 L24 51 L16 41 L27 34 L28 21 L41 24 Z" />
          <path fill={cut} d="M34 38 C34 32 40 33 42 36 H58 C60 33 66 32 66 38 L65 55 C62 66 56 72 50 72 C44 72 38 66 35 55 Z" />
          <path fill={ink} d="M39 45 L47 47 L41 50 Z M61 45 L53 47 L59 50 Z M44 56 H56 L50 62 Z M49 61 H51 V67 H49 Z" />
        </>
      );
    case "kurt":
      return (
        <>
          <path fill={ink} d="M23 17 L39 33 H61 L77 17 L76 43 L84 56 L68 62 L59 76 L50 84 L41 76 L32 62 L16 56 L24 43 Z" />
          <path fill={cut} d="M30 45 L44 51 L40 55 L33 52 Z M70 45 L56 51 L60 55 L67 52 Z M43 70 H57 L50 77 Z M28 25 L36 34 L28 39 Z M72 25 L64 34 L72 39 Z" />
        </>
      );
    case "boga":
      return (
        <>
          <path fill={ink} d="M15 20 C13 40 25 45 37 43 L34 38 C26 38 20 31 15 20 Z M85 20 C87 40 75 45 63 43 L66 38 C74 38 80 31 85 20 Z" />
          <path fill={ink} d="M34 38 C40 34 60 34 66 38 L70 50 L80 49 C77 55 72 57 66 57 L62 72 C60 80 56 83 50 83 C44 83 40 80 38 72 L34 57 C28 57 23 55 20 49 L30 50 Z" />
          <path fill={cut} d="M38 49 L46 52 L40 55 Z M62 49 L54 52 L60 55 Z M43 71 a3 3 0 1 0 .1 0 Z M57 71 a3 3 0 1 0 .1 0 Z" />
        </>
      );
  }
}

/** Birleştirmeli arma çizimi (SVG): şekil + desen + sembol, iki renk */
export function Crest({ spec, color, name, className }: { spec: CrestSpec; color: string; name: string; className?: string }) {
  // Sayfada çok sayıda arma olur: kırpma kimliği her birinde ayrı olmalı
  const clip = `arma${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const letters = teamInitials(name);
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={name}>
      <clipPath id={clip}>
        <path d={SHAPES[spec.shape]} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="100" height="100" fill={color} />
        {pattern(spec.pattern, spec.second)}
      </g>
      <path d={SHAPES[spec.shape]} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3.5" strokeLinejoin="round" />
      {spec.emblem === "harf" ? (
        <text
          x="50"
          y="51"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={letters.length > 1 ? 38 : 48}
          fontWeight="900"
          fill="#fff"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="6"
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {letters}
        </text>
      ) : (
        <g style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.75))" }}>{emblem(spec.emblem, "#fff", spec.second)}</g>
      )}
    </svg>
  );
}

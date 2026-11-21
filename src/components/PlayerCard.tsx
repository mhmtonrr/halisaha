import { cx } from "./ui";
import { plateOf } from "@/lib/regions";
import { POSITION_LABEL, type Position } from "@/lib/data";
import type { Attribute } from "@/lib/attributes";

type Tier = "gold" | "silver" | "bronze" | "new";

export function tierOf(overall: number): Tier {
  // Kullanıcı kararı: 64'e kadar bronz, 65-74 gümüş, 75 ve üstü altın
  if (overall >= 75) return "gold";
  if (overall >= 65) return "silver";
  return "bronze";
}

const tierStyle: Record<Tier, string> = {
  gold: "from-gold-1 to-gold-2 text-[#3b2a05]",
  silver: "from-silver-1 to-silver-2 text-[#1f262d]",
  bronze: "from-bronze-1 to-bronze-2 text-[#3a1d0a]",
  // Henüz hiç maçı olmayan oyuncu: nötr gri, ilk maçtan sonra seviye rengini alır
  new: "from-slate-300 to-slate-500 text-slate-900",
};

/** Rating seviyesine göre kart rengi (altın/gümüş/bronz); küçük kartlar için dışa açık */
export const tierClass = (overall: number, unrated?: boolean) => tierStyle[unrated ? "new" : tierOf(overall)];

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

export const SHIELD = "polygon(50% 0, 100% 7%, 100% 88%, 50% 100%, 0 88%, 0 7%)";

export interface CardTeam {
  name: string;
  color: string | null;
}

/** Kartın arkasındaki hafif halısaha çizgileri (orta saha çizgisi ve daire) */
function PitchLines() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 110 160"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.13]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <line x1="0" y1="82" x2="110" y2="82" />
      <circle cx="55" cy="82" r="22" />
      <circle cx="55" cy="82" r="1.6" fill="currentColor" />
      <rect x="28" y="0" width="54" height="22" />
      <rect x="28" y="138" width="54" height="22" />
    </svg>
  );
}


/** Seviye başına kart zemini (public/cards/*.webp, şeffaf kenarlı) ve yazı renkleri; maçsız oyuncu gri */
const FULL_TIER: Record<Tier, { img: string; text: string; light: string; filter?: string }> = {
  gold: { img: "gold", text: "#1a1203", light: "#f3dc92" },
  silver: { img: "silver", text: "#13171b", light: "#dfe5ec" },
  bronze: { img: "bronze", text: "#2a1305", light: "#f4cfa8" },
  new: { img: "silver", text: "#13171b", light: "#dfe5ec", filter: "grayscale(1) brightness(.92)" },
};

/** Fotoğrafı olmayan oyuncu için yer tutucu siluet */
function Silhouette() {
  return (
    <svg viewBox="0 0 100 110" className="h-full w-full" fill="currentColor" aria-hidden>
      <circle cx="50" cy="34" r="20" />
      <path d="M8 110c0-26 18-42 42-42s42 16 42 42z" />
    </svg>
  );
}

/**
 * Profil/liste kartı. Zemin hazır görsel (640x925); üstüne canlı metin yerleştirilir. Tüm konumlar kartın yüzdesidir ve her öğe
 * kendi yazı boyutunu taşır (`em` birikmesi olmasın). Sol üst: rating/mevki/takım rozeti; sağ: fotoğraf; orta kuşak: ad;
 * altında 6 yetenek; en altta koyu şeritte plaka | ilçe.
 */
function FullCard({
  name, overall, position, skills, city, district, team, unrated, photoUrl, fontSize, className,
}: {
  name: string; overall: number; position: Position | null; skills: { key: string; value: number | null }[];
  city?: string | null; district?: string | null; team?: CardTeam | null; unrated?: boolean;
  photoUrl?: string | null; fontSize?: string; className?: string;
}) {
  const t = FULL_TIER[unrated ? "new" : tierOf(overall)];
  const plate = plateOf(city);
  return (
    <div
      className={cx("relative", className)}
      style={{
        width: "11em", height: "15.9em", fontSize, color: t.text,
        backgroundImage: `url(/cards/${t.img}.webp)`, backgroundSize: "100% 100%",
        filter: `${t.filter ? t.filter + " " : ""}drop-shadow(0 0.35em 0.5em rgba(0,0,0,.45))`,
      }}
    >
      {/* sol üst: rating, mevki, takım rozeti */}
      <div className="absolute flex flex-col items-center leading-none" style={{ left: "6%", top: "9%", width: "30%" }}>
        <div className="font-black" style={{ fontSize: "2.35em", letterSpacing: "-0.02em" }}>{overall}</div>
        <div className="font-extrabold" style={{ fontSize: "1.05em", marginTop: "0.2em" }}>{position ? POSITION_LABEL[position] : "—"}</div>
        <div style={{ width: "88%", height: 1, background: t.text, opacity: 0.35, margin: "0.55em 0 0.6em" }} />
        {team ? (
          <span
            className="inline-flex items-center justify-center rounded-full font-black text-white"
            style={{ width: "2.1em", height: "2.1em", fontSize: "0.9em", background: team.color ?? "#1a5a36", boxShadow: "0 0 0 0.12em rgba(0,0,0,.65)" }}
            title={team.name}
          >
            {initials(team.name)}
          </span>
        ) : null}
      </div>

      {/* sağ: oyuncu fotoğrafı (şeffaf kesim); alt kenarı isim kuşağına doğru solar */}
      <div
        className="absolute flex items-end justify-center overflow-hidden"
        style={{ left: "38%", right: "2%", top: "6%", height: "49%", WebkitMaskImage: "linear-gradient(#000 82%,transparent)", maskImage: "linear-gradient(#000 82%,transparent)" }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={name} className="h-full w-full object-contain object-bottom" draggable={false} />
        ) : (
          <div className="h-[80%] w-[70%] opacity-20"><Silhouette /></div>
        )}
      </div>

      {/* ad kuşağı */}
      <div className="absolute truncate text-center font-extrabold" style={{ left: "10%", right: "5%", top: "58%", fontSize: "1em", lineHeight: 1.2 }}>
        {name}
      </div>

      {/* 6 yetenek */}
      <div className="absolute grid grid-cols-6" style={{ left: "7%", right: "7%", top: "68%" }}>
        {skills.slice(0, 6).map((a, i) => (
          <div key={a.key} className="flex flex-col items-center leading-none" style={{ borderLeft: i ? `1px solid ${t.text}33` : undefined }}>
            <span className="font-bold" style={{ fontSize: "0.46em", opacity: 0.85 }}>{a.key}</span>
            <span className="font-black tabular-nums" style={{ fontSize: "0.82em", marginTop: "0.18em" }}>{a.value ?? "–"}</span>
          </div>
        ))}
      </div>

      {/* alt koyu şerit: plaka | ilçe */}
      <div className="absolute flex items-center justify-center whitespace-nowrap font-bold" style={{ left: "24%", right: "24%", top: "81.2%", gap: "0.5em", fontSize: "0.62em", color: t.light }}>
        {plate && <span className="font-black">{plate}</span>}
        {plate && district && <span style={{ width: 1, height: "1.1em", background: t.light, opacity: 0.6 }} />}
        {district && <span className="truncate">{district}</span>}
        {!plate && !district && <span style={{ opacity: 0.6 }}>—</span>}
      </div>
    </div>
  );
}

/**
 * Kartın yüzü. Her şey `em` ile çizilir (11em genişlik); `fontSize` boyutu belirler. `compact` (saha) sürümünde
 * bölge ve takım rozeti yoktur. Bayrak yerine il plaka kodu ve ilçe gösterilir; yetenekler oylamayla dolana dek "–".
 */
export function CardFace({
  name,
  overall,
  position,
  skills,
  shirtNumber,
  city,
  district,
  team,
  unrated,
  provisional,
  photoUrl,
  compact,
  fontSize,
  className,
}: {
  name: string;
  overall: number;
  position: Position | null;
  skills: Pick<Attribute, "key" | "value">[] | { key: string; value: number | null }[];
  shirtNumber?: number | null;
  city?: string | null;
  district?: string | null;
  team?: CardTeam | null;
  unrated?: boolean;
  provisional?: boolean;
  /** Oyuncunun işlenmiş (arka planı kaldırılmış) fotoğrafı; yoksa yer tutucu siluet */
  photoUrl?: string | null;
  compact?: boolean;
  fontSize?: string;
  className?: string;
}) {
  if (!compact) {
    return (
      <FullCard
        name={name} overall={overall} position={position} skills={skills} city={city} district={district}
        team={team} unrated={unrated} photoUrl={photoUrl} fontSize={fontSize} className={className}
      />
    );
  }
  const plate = plateOf(city);
  const half = Math.ceil(skills.length / 2);
  const cols = [skills.slice(0, half), skills.slice(half)];
  const noSkills = skills.every((a) => a.value === null);
  return (
    <div
      className={cx("relative overflow-hidden bg-gradient-to-b shadow-xl", tierClass(overall, unrated), className)}
      style={{
        width: "11em",
        padding: compact ? "0.45em 0.5em 1em" : "0.7em 0.8em 1.5em",
        fontSize,
        clipPath: SHIELD,
      }}
    >
      {!compact && <PitchLines />}
      <div className="relative flex items-start justify-between" style={{ paddingTop: compact ? "0.35em" : "0.9em" }}>
        <div className="flex flex-col items-center leading-none" style={{ minWidth: compact ? undefined : "2.6em" }}>
          <div className="font-black" style={{ fontSize: compact ? "2.2em" : "2.5em" }}>
            {overall}
          </div>
          <div className="font-bold" style={{ fontSize: "0.85em", marginTop: "0.2em" }}>
            {position ? POSITION_LABEL[position] : "—"}
          </div>
          {!compact && (
            <>
              <div className="bg-black/20" style={{ height: "1px", width: "1.6em", margin: "0.45em 0" }} />
              {plate ? (
                <>
                  <div
                    className="rounded border border-black/30 bg-black/10 font-black tracking-wide"
                    style={{ fontSize: "0.95em", padding: "0.05em 0.35em" }}
                    title={city ?? undefined}
                  >
                    {plate}
                  </div>
                  {district && (
                    <div
                      className="truncate text-center font-bold uppercase opacity-70"
                      style={{ fontSize: "0.5em", marginTop: "0.35em", maxWidth: "7em" }}
                    >
                      {district}
                    </div>
                  )}
                </>
              ) : (
                <div className="font-bold opacity-40" style={{ fontSize: "0.7em" }}>
                  —
                </div>
              )}
              {team && (
                <span
                  className="mt-[0.45em] inline-flex items-center justify-center rounded-md font-black text-white"
                  style={{
                    width: "1.9em",
                    height: "1.9em",
                    fontSize: "0.6em",
                    background: team.color ?? "#1a5a36",
                  }}
                  title={team.name}
                >
                  {initials(team.name)}
                </span>
              )}
            </>
          )}
        </div>
        <div
          className="relative flex items-center justify-center rounded-full bg-black/10 font-black"
          style={{ width: compact ? "2.9em" : "5.2em", height: compact ? "2.9em" : "5.2em" }}
        >
          <span style={{ fontSize: compact ? "1em" : "1.6em" }}>{initials(name)}</span>
          {shirtNumber != null && (
            <span
              className="absolute flex items-center justify-center rounded-full bg-black/25 font-black text-white"
              style={{ width: compact ? "1.3em" : "2.2em", height: compact ? "1.3em" : "2.2em", right: "-0.1em", bottom: "-0.1em", fontSize: compact ? "0.6em" : "0.75em" }}
            >
              {shirtNumber}
            </span>
          )}
        </div>
      </div>
      <div
        className="relative truncate border-b border-black/15 text-center font-extrabold uppercase"
        style={{ marginTop: compact ? "0.4em" : "0.7em", paddingBottom: "0.12em", fontSize: compact ? "0.82em" : "1em" }}
      >
        {compact ? shortName(name) : name}
      </div>
      <div className="relative grid grid-cols-2" style={{ marginTop: "0.3em", fontSize: compact ? "0.72em" : "0.82em" }}>
        {cols.map((col, i) => (
          <div
            key={i}
            className={cx(i === 0 && "border-r border-black/15", "flex flex-col")}
            style={{ paddingLeft: i === 1 ? "0.7em" : "0.2em", rowGap: compact ? 0 : "0.1em" }}
          >
            {col.map((a) => (
              <div key={a.key} className="flex items-baseline" style={{ gap: "0.3em" }}>
                <span className="text-right font-black tabular-nums" style={{ width: "1.7em" }}>
                  {a.value ?? "–"}
                </span>
                <span className="font-semibold opacity-80">{a.key}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {!compact && (noSkills || provisional) && (
        <div className="relative text-center font-bold uppercase opacity-60" style={{ marginTop: "0.5em", fontSize: "0.5em" }}>
          {noSkills ? "Yetenekler oylamayla dolar" : "Geçici puan"}
        </div>
      )}
    </div>
  );
}

/** Profil/liste kartı: genişliğine göre kendini ölçekler (kapsayıcı sorgusu) */
export function PlayerCard({
  size = "lg",
  attributes,
  skills,
  ...rest
}: {
  name: string;
  overall: number;
  position: Position | null;
  /** Karttaki 6 yetenek; yoksa "–" */
  skills?: { key: string; value: number | null }[];
  /** Eski ad: skills yerine geçer */
  attributes?: { key: string; value: number | null }[];
  provisional?: boolean;
  shirtNumber?: number | null;
  city?: string | null;
  district?: string | null;
  team?: CardTeam | null;
  unrated?: boolean;
  /** İşlenmiş oyuncu fotoğrafı (yoksa yer tutucu siluet) */
  photoUrl?: string | null;
  size?: "lg" | "sm";
}) {
  return (
    <div
      className={cx("mx-auto w-full", size === "sm" ? "max-w-44" : "max-w-60")}
      style={{ containerType: "inline-size" }}
    >
      <CardFace
        {...rest}
        skills={skills ?? attributes ?? []}
        compact={false}
        fontSize="calc(100cqw / 11)"
        className="w-full"
      />
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./ui";
import { initials, shortName, tierClass } from "./PlayerCard";
import type { Attribute } from "@/lib/attributes";
import { POSITION_LABEL, type Position } from "@/lib/data";
import { cardWidthPct, type Slot } from "@/lib/formations";

export interface PitchPlayer {
  id: string;
  name: string;
  overall: number;
  position: Position | null;
  /** Profil kartındaki 6 özellik (FRM, İST, GOL/KRT, AST, GAL, MVP); yoksa tireler görünür */
  attributes?: Pick<Attribute, "key" | "value">[];
  shirtNumber?: number | null;
  /** Rating henüz yeterince oya dayanmıyor */
  provisional?: boolean;
}

/** Saha zemini: dikey, çizgili. İçine konumlanan öğeler için konumlandırma bağlamı sağlar. */
export function Pitch({
  children,
  className,
  cardPct = 24,
}: {
  children: ReactNode;
  className?: string;
  /** Oyuncu kartının saha genişliğine oranı (%); cardWidthPct ile hesaplanır */
  cardPct?: number;
}) {
  return (
    <div
      className={cx(
        "relative w-full overflow-hidden rounded-2xl border border-emerald-300/20 bg-gradient-to-b from-emerald-800 to-emerald-900",
        className,
      )}
      // Kartlar bu kapsayıcının genişliğine göre ölçeklenir (cqw); --cw kart genişliği yüzdesi
      style={{ aspectRatio: "4 / 5", containerType: "inline-size", ["--cw" as string]: cardPct }}
    >
      {/* Çimen şeritleri */}
      <div
        className="absolute inset-0 opacity-30"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent 0 12.5%, rgba(255,255,255,0.07) 12.5% 25%)" }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 125" preserveAspectRatio="none" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5">
        <rect x="3" y="3" width="94" height="119" />
        <line x1="3" y1="62.5" x2="97" y2="62.5" />
        <circle cx="50" cy="62.5" r="11" />
        {/* Kaleler: altta bizim, üstte rakip */}
        <rect x="27" y="104" width="46" height="18" />
        <rect x="39" y="115" width="22" height="7" />
        <rect x="27" y="3" width="46" height="18" />
        <rect x="39" y="3" width="22" height="7" />
      </svg>
      {children}
    </div>
  );
}

/** Sahada slot konumuna yerleşen öğe (merkezlenmiş) */
export function SlotBox({
  at,
  children,
  className,
  ...rest
}: { at: Slot; children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "slot">) {
  return (
    <div
      {...rest}
      className={cx("absolute -translate-x-1/2 -translate-y-1/2", className)}
      style={{ left: `${at.x}%`, top: `${at.y}%`, ...rest.style }}
    >
      {children}
    </div>
  );
}

const SHIELD = "polygon(50% 0, 100% 7%, 100% 88%, 50% 100%, 0 88%, 0 7%)";

/**
 * Profildeki oyuncu kartının (PlayerCard) sahaya sığan hali: aynı kalkan biçimi, seviye rengi, rating, mevki,
 * baş harfler, isim ve 6 özellik (FRM, İST, GOL/KRT, AST, GAL, MVP). Her şey `em` ile çizilir; yazı boyutu
 * sahanın genişliğinden (cqw) türetildiği için kart hat başına oyuncu sayısına göre kendiliğinden ölçeklenir.
 * `fontSize` verilirse sabit boyut (yedekler, sürükleme hayaleti).
 */
export function PitchCard({ player, fontSize, className }: { player: PitchPlayer; fontSize?: string; className?: string }) {
  return (
    <div
      className={cx("relative overflow-hidden bg-gradient-to-b shadow-lg", tierClass(player.overall), className)}
      style={{
        width: "11em",
        padding: "0.45em 0.5em 1em",
        fontSize: fontSize ?? "calc(var(--cw, 20) / 11 * 1cqw)",
        clipPath: SHIELD,
      }}
    >
      <div className="flex items-start justify-between" style={{ paddingTop: "0.35em" }}>
        <div className="text-center leading-none">
          <div className="font-black" style={{ fontSize: "2.2em" }}>
            {player.overall}
          </div>
          <div className="font-bold" style={{ fontSize: "0.85em", marginTop: "0.2em" }}>
            {player.position ? POSITION_LABEL[player.position] : "—"}
          </div>
        </div>
        <div
          className="relative flex items-center justify-center rounded-full bg-black/10 font-black"
          style={{ width: "2.9em", height: "2.9em", fontSize: "1em" }}
        >
          {initials(player.name)}
          {player.shirtNumber != null && (
            <span
              className="absolute flex items-center justify-center rounded-full bg-black/25 font-black text-white"
              style={{ width: "1.3em", height: "1.3em", right: "-0.2em", bottom: "-0.2em", fontSize: "0.6em" }}
            >
              {player.shirtNumber}
            </span>
          )}
        </div>
      </div>
      <div
        className="truncate border-b border-black/15 text-center font-extrabold uppercase"
        style={{ marginTop: "0.4em", paddingBottom: "0.12em", fontSize: "0.82em" }}
      >
        {shortName(player.name)}
      </div>
      <div className="grid grid-cols-2" style={{ marginTop: "0.25em", columnGap: "0.3em", fontSize: "0.72em" }}>
        {(player.attributes ?? []).map((a) => (
          <div key={a.key} className="flex items-baseline" style={{ gap: "0.2em" }}>
            <span className="text-right font-black tabular-nums" style={{ width: "1.7em" }}>
              {a.value ?? "–"}
            </span>
            <span className="font-semibold opacity-80">{a.key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Boş slot: sadece rolü gösterir */
export function EmptySlot({ role, active }: { role: Slot["role"]; active?: boolean }) {
  return (
    <div
      className={cx(
        "flex h-11 w-11 items-center justify-center rounded-full border border-dashed text-[10px] font-bold",
        active ? "border-accent bg-accent/20 text-accent" : "border-white/40 text-white/60",
      )}
    >
      {POSITION_LABEL[role]}
    </div>
  );
}

/** Salt okunur diziliş: herkes görür. `href` verilirse oyuncu kartına bağlanır. */
export function LineupPitch({
  slots,
  placed,
  playerHref,
}: {
  slots: Slot[];
  /** Slot sırası → oyuncu */
  placed: Map<number, PitchPlayer>;
  playerHref?: (playerId: string) => string;
}) {
  return (
    <Pitch cardPct={cardWidthPct({ id: "", size: slots.length, lines: [], slots })}>
      {slots.map((slot) => {
        const p = placed.get(slot.index);
        return (
          <SlotBox key={slot.index} at={slot}>
            {p ? (
              playerHref ? (
                <Link href={playerHref(p.id)}>
                  <PitchCard player={p} />
                </Link>
              ) : (
                <PitchCard player={p} />
              )
            ) : (
              <EmptySlot role={slot.role} />
            )}
          </SlotBox>
        );
      })}
    </Pitch>
  );
}

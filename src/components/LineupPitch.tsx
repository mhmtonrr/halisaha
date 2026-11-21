import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./ui";
import { initials, shortName, tierClass } from "./PlayerCard";
import { POSITION_LABEL, type Position } from "@/lib/data";
import type { Slot } from "@/lib/formations";

export interface PitchPlayer {
  id: string;
  name: string;
  overall: number;
  position: Position | null;
}

/** Saha zemini: dikey, çizgili. İçine konumlanan öğeler için konumlandırma bağlamı sağlar. */
export function Pitch({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "relative w-full overflow-hidden rounded-2xl border border-emerald-300/20 bg-gradient-to-b from-emerald-800 to-emerald-900",
        className,
      )}
      style={{ aspectRatio: "4 / 5" }}
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

/**
 * Minik oyuncu kartı: FIFA tarzı, seviyesine göre altın/gümüş/bronz. Rating, mevki, baş harfler ve kısa ad.
 * Sahada 5'li hatta bile sığması için 50x64 px.
 */
export function MiniCard({ player, className }: { player: PitchPlayer; className?: string }) {
  return (
    <div
      className={cx(
        "flex h-16 w-[50px] flex-col items-center rounded-lg bg-gradient-to-br px-1 pb-0.5 pt-1 shadow-md ring-1 ring-black/30",
        tierClass(player.overall),
        className,
      )}
    >
      <div className="flex w-full items-start justify-between leading-none">
        <span className="text-[17px] font-black tracking-tight">{player.overall}</span>
        <span className="mt-0.5 text-[8px] font-extrabold opacity-70">{player.position ? POSITION_LABEL[player.position] : ""}</span>
      </div>
      <span className="mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/15 text-[8px] font-black">
        {initials(player.name)}
      </span>
      <span className="mt-auto w-full truncate text-center text-[9px] font-bold leading-3">{shortName(player.name)}</span>
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
    <Pitch>
      {slots.map((slot) => {
        const p = placed.get(slot.index);
        return (
          <SlotBox key={slot.index} at={slot}>
            {p ? (
              playerHref ? (
                <Link href={playerHref(p.id)}>
                  <MiniCard player={p} />
                </Link>
              ) : (
                <MiniCard player={p} />
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

import { CardFace } from "./PlayerCard";
import type { Position } from "@/lib/data";

export interface PitchPlayer {
  id: string;
  name: string;
  /** Kartta görünen ad (isteğe bağlı) */
  cardName?: string | null;
  /** Kart fotoğrafı (şeffaf kesim); yoksa baş harfler */
  photoUrl?: string | null;
  overall: number;
  position: Position | null;
  /** Kartın 6 yeteneği (HIZ, ŞUT, PAS, DRİ, DEF, FİZ; kalecide REF…); oylanmadıysa tireler görünür */
  attributes?: { key: string; value: number | null }[];
  city?: string | null;
  district?: string | null;
}

/**
 * Sahadaki oyuncu: profildeki kartın AYNISI (PlayerCard/CardFace). Yazı boyutu sahanın genişliğinden (cqw) türetilir;
 * `fontSize` verilirse sabit boyut (yedekler, sürükleme hayaleti).
 */
export function PitchCard({ player, fontSize, className }: { player: PitchPlayer; fontSize?: string; className?: string }) {
  return (
    <CardFace
      name={player.name}
      cardName={player.cardName}
      photoUrl={player.photoUrl}
      overall={player.overall}
      position={player.position}
      skills={player.attributes ?? []}
      city={player.city}
      district={player.district}
      fontSize={fontSize ?? "calc(var(--cw, 20) / 11 * 1cqw)"}
      className={className}
    />
  );
}


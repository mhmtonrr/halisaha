import { cx } from "./ui";
import { initials } from "./PlayerCard";

/**
 * Yuvarlak oyuncu avatarı: kart fotoğrafı (şeffaf kesim; yüz üstte kalsın diye üstten hizalı) varsa o, yoksa baş harfler.
 * Boyut, zemin ve yazı rengi `className` ile verilir (fotoğraf varken zemin sadece arkada görünür).
 */
export function Avatar({ name, photoUrl, className, title }: { name: string; photoUrl?: string | null; className?: string; title?: string }) {
  return (
    <span className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", className)} title={title}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="h-full w-full object-cover object-top" draggable={false} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

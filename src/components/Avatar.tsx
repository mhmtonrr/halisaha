import { cx } from "./ui";
import { initials } from "./PlayerCard";

/**
 * Yuvarlak oyuncu avatarı: kart fotoğrafı (şeffaf kesim; tamamı görünsün diye sığdırılır) varsa o, yoksa baş harfler.
 * Boyut, zemin ve yazı rengi `className` ile verilir; fotoğraf varken zemin (renk/gradyan) kaldırılır, fotoğraf şeffaf arka planla durur.
 */
export function Avatar({ name, photoUrl, className, title }: { name: string; photoUrl?: string | null; className?: string; title?: string }) {
  return (
    <span className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold", className, photoUrl && "bg-none! bg-transparent!")} title={title}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} className="h-full w-full object-contain object-bottom" draggable={false} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

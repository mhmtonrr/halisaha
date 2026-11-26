import { DEFAULT_TEAM_COLOR, resolveLogo } from "@/lib/crest";
import { Crest } from "./Crest";
import { cx } from "./ui";

/** Takım/grup logosu: yüklenen veya hazır görsel, yoksa arma (seçilmemişse kimlikten otomatik) */
export function TeamBadge({
  id,
  name,
  color,
  logo,
  size = "md",
  className,
}: {
  /** Grup kimliği: otomatik armanın tohumu */
  id: string;
  name: string;
  color: string | null;
  logo: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const resolved = resolveLogo(logo, id);
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-11 w-11",
        size === "lg" && "h-16 w-16",
        className,
      )}
    >
      {resolved.type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolved.src} alt={name} className="h-full w-full object-contain" />
      ) : (
        <Crest spec={resolved.spec} color={color ?? DEFAULT_TEAM_COLOR} name={name} className="h-full w-full" />
      )}
    </span>
  );
}

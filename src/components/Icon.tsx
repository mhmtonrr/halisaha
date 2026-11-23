// ui.tsx bu dosyayı içe aktarır; döngü olmasın diye cx yerine düz birleştirme

/** Material Symbols ikonu (tasarımdaki adlarla). `fill` dolu varyantı açar. */
export function Icon({ name, className, fill }: { name: string; className?: string; fill?: boolean }) {
  return (
    <span
      aria-hidden
      className={className ? `material-symbols-outlined ${className}` : "material-symbols-outlined"}
      style={fill ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
    >
      {name}
    </span>
  );
}

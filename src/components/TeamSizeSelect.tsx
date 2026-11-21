import { SIZES } from "@/lib/formations";
import { Label } from "@/components/ui";

/** Kaç kişilik oynanacağı (her takım için, kaleci dahil): 5v5 ... 11v11 */
export function TeamSizeSelect({ defaultValue = 7, className }: { defaultValue?: number; className?: string }) {
  return (
    <label className={className}>
      <Label hint="her takım">Kaç kişilik?</Label>
      <select
        name="size"
        defaultValue={defaultValue}
        className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm"
      >
        {SIZES.map((n) => (
          <option key={n} value={n}>
            {n} kişilik ({n}v{n})
          </option>
        ))}
      </select>
    </label>
  );
}

import { SIZES } from "@/lib/formations";
import { Input, Label } from "@/components/ui";

const selectCls = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm";
const textareaCls =
  "w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent";

/** Toplama çağrısının isteğe bağlı alanları (açarken ve düzenlerken aynı). perTeam: takım çağrısı, kontenjan tek taraf */
export function CallFields({
  perTeam = false,
  time = "",
  size = null,
  venue = "",
  decideBy = "",
  note = "",
}: {
  perTeam?: boolean;
  time?: string;
  size?: number | null;
  venue?: string;
  decideBy?: string;
  note?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label hint="belli değilse boş">Saat</Label>
          <Input type="time" name="time" defaultValue={time} />
        </label>
        <label className="block">
          <Label hint="her takım">Kaç kişilik?</Label>
          <select name="size" defaultValue={size ?? ""} className={selectCls}>
            <option value="">Belli değil</option>
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}v{n} ({perTeam ? n : n * 2} kişi)
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <Label hint="isteğe bağlı">Saha</Label>
        <Input name="venue" maxLength={80} defaultValue={venue} placeholder="Örn. Petroller Halısaha" />
      </label>
      <label className="block">
        <Label hint="isteğe bağlı, sana hatırlatılır">Kadroyu ne zaman kesinleştireceksin?</Label>
        <Input type="datetime-local" name="decideBy" defaultValue={decideBy} />
      </label>
      <label className="block">
        <Label hint="isteğe bağlı">Not</Label>
        <textarea name="note" maxLength={300} rows={2} defaultValue={note} placeholder="Örn. Kişi başı 150 TL. Kaleci lazım!" className={textareaCls} />
      </label>
    </>
  );
}

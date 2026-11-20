import { PROVINCES } from "@/lib/regions";
import { TEAM_COLORS } from "@/lib/teams-data";
import { Input, Label } from "./ui";

const select = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none focus:border-accent";

/** Takım kurma ve düzenleme formlarının alanları */
export function TeamFields({
  values,
}: {
  values?: { name: string; city: string | null; district: string | null; color: string | null; description: string | null };
}) {
  const color = values?.color ?? TEAM_COLORS[0];
  return (
    <>
      <label className="block">
        <Label>Takım adı</Label>
        <Input name="name" defaultValue={values?.name} required minLength={2} maxLength={60} placeholder="Örn. Kadıköy Kartalları" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>İl</Label>
          <select name="city" required defaultValue={values?.city ?? ""} className={select}>
            <option value="" disabled>
              Seç
            </option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>İlçe</Label>
          <Input name="district" defaultValue={values?.district ?? ""} maxLength={40} placeholder="Örn. Kadıköy" />
        </label>
      </div>
      <div>
        <Label>Takım rengi</Label>
        <div className="flex flex-wrap gap-2">
          {TEAM_COLORS.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="radio" name="color" value={c} defaultChecked={c === color} className="peer sr-only" />
              <span
                className="block h-9 w-9 rounded-full border-2 border-transparent ring-offset-2 ring-offset-pitch-900 peer-checked:ring-2 peer-checked:ring-white"
                style={{ background: c }}
                aria-label={c}
              />
            </label>
          ))}
        </div>
      </div>
      <label className="block">
        <Label hint="isteğe bağlı">Kısa açıklama</Label>
        <textarea
          name="description"
          maxLength={200}
          rows={2}
          defaultValue={values?.description ?? ""}
          placeholder="Örn. Perşembe akşamları Moda'da oynuyoruz, maç tekliflerine açığız."
          className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
        />
      </label>
    </>
  );
}

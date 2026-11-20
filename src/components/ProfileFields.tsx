import { FOOT_NAME, POSITION_NAME, POSITIONS, type Foot, type Position } from "@/lib/data";
import { PROVINCES } from "@/lib/regions";
import { Input, Label } from "./ui";

export interface ProfileValues {
  display_name: string;
  city: string | null;
  district: string | null;
  birth_year: number | null;
  preferred_position: Position | null;
  secondary_positions: Position[];
  preferred_foot: Foot | null;
  shirt_number: number | null;
  bio: string | null;
}

const chip =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-1 text-center text-[13px] leading-tight has-checked:border-accent has-checked:bg-accent has-checked:font-semibold has-checked:text-pitch-950";
const select =
  "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none focus:border-accent";

const thisYear = new Date().getFullYear();

/** Profil ve karşılama formlarının ortak alanları. `full` olmayan sürüm karşılama ekranı içindir. */
export function ProfileFields({ values, full }: { values: ProfileValues; full: boolean }) {
  return (
    <>
      <label className="block">
        <Label>Ad soyad</Label>
        <Input
          name="name"
          defaultValue={values.display_name}
          required
          minLength={2}
          maxLength={40}
          autoComplete="name"
          placeholder="Örn. Ahmet Yılmaz"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <Label>İl</Label>
          <select name="city" defaultValue={values.city ?? ""} required className={select}>
            <option value="" disabled>
              Seç
            </option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>İlçe</Label>
          <Input name="district" defaultValue={values.district ?? ""} maxLength={40} placeholder="Örn. Kadıköy" />
        </label>
      </div>

      <div>
        <Label>Ana mevki</Label>
        <div className="grid grid-cols-4 gap-2">
          {POSITIONS.map((p) => (
            <label key={p} className={chip}>
              <input
                type="radio"
                name="position"
                value={p}
                required
                defaultChecked={values.preferred_position === p}
                className="sr-only"
              />
              {POSITION_NAME[p]}
            </label>
          ))}
        </div>
      </div>

      {full && (
        <div>
          <Label hint="birden fazla seçebilirsin">Oynayabildiğim diğer mevkiler</Label>
          <div className="grid grid-cols-4 gap-2">
            {POSITIONS.map((p) => (
              <label key={p} className={chip}>
                <input
                  type="checkbox"
                  name="secondary"
                  value={p}
                  defaultChecked={values.secondary_positions.includes(p)}
                  className="sr-only"
                />
                {POSITION_NAME[p]}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <div>
          <Label hint="isteğe bağlı">Ayak</Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(FOOT_NAME) as Foot[]).map((f) => (
              <label key={f} className={chip}>
                <input type="radio" name="foot" value={f} defaultChecked={values.preferred_foot === f} className="sr-only" />
                {FOOT_NAME[f]}
              </label>
            ))}
          </div>
        </div>
        <label>
          <Label>Doğum yılı</Label>
          <Input
            type="number"
            inputMode="numeric"
            name="birthYear"
            min={1940}
            max={thisYear - 8}
            defaultValue={values.birth_year ?? ""}
            placeholder="1995"
            className="text-center"
          />
        </label>
      </div>

      {full && (
        <>
          <label className="block w-28">
            <Label>Forma no</Label>
            <Input
              type="number"
              inputMode="numeric"
              name="shirt"
              min={1}
              max={99}
              defaultValue={values.shirt_number ?? ""}
              className="text-center"
            />
          </label>
          <label className="block">
            <Label hint="en fazla 160 karakter">Hakkımda</Label>
            <textarea
              name="bio"
              maxLength={160}
              rows={2}
              defaultValue={values.bio ?? ""}
              placeholder="Örn. Sol kanattan bindiren, şutu sert bir oyuncu"
              className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </label>
        </>
      )}
    </>
  );
}

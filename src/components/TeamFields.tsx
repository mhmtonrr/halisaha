import { LogoPicker } from "./LogoPicker";
import { RegionSelect } from "./RegionSelect";
import { TEAM_COLORS } from "@/lib/teams-data";
import { Input, Label } from "./ui";


/** Takım kurma ve takım/grup düzenleme formlarının alanları (grupta il isteğe bağlı) */
export function TeamFields({
  values,
  kind = "team",
}: {
  values?: {
    /** Kayıtlı takım/grup (kurulumda yok) */
    id?: string;
    logo?: string | null;
    name: string;
    city: string | null;
    district: string | null;
    color: string | null;
    description: string | null;
  };
  kind?: "team" | "community";
}) {
  const isTeam = kind === "team";
  const word = isTeam ? "Takım" : "Grup";
  const color = values?.color ?? TEAM_COLORS[0];
  return (
    <>
      <label className="block">
        <Label>{word} adı</Label>
        <Input
          name="name"
          defaultValue={values?.name}
          required
          minLength={2}
          maxLength={60}
          placeholder={isTeam ? "Örn. Kadıköy Kartalları" : "Örn. Moda Futbol Severler"}
        />
      </label>
      <RegionSelect defaultCity={values?.city} defaultDistrict={values?.district} requireCity={isTeam} />
      <div>
        <Label>{word} rengi</Label>
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
      <LogoPicker id={values?.id} logo={values?.logo ?? null} name={values?.name ?? ""} color={color} />
      <label className="block">
        <Label hint="isteğe bağlı">{isTeam ? "Kısa açıklama" : "Grup hakkında"}</Label>
        <textarea
          name="description"
          maxLength={200}
          rows={2}
          defaultValue={values?.description ?? ""}
          placeholder={
            isTeam
              ? "Örn. Perşembe akşamları Moda'da oynuyoruz, maç tekliflerine açığız."
              : "Örn. Kadıköy'de yaşayan, hafta içi akşamları top oynamak isteyenlerin topluluğu."
          }
          className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
        />
      </label>
    </>
  );
}

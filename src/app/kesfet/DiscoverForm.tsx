import { RegionSelect } from "@/components/RegionSelect";
import { Button, Input } from "@/components/ui";

export type DiscoverTab = "takim" | "oyuncu" | "mac" | "grup";

/**
 * Dört Keşfet sekmesinin ortak arama formu (GET, adres paylaşılabilir): bölge (değişince hemen uygulanır),
 * arama kutusu + "Ara", altında sekmeye özel sıralama/filtre.
 */
export function DiscoverForm({
  tab,
  city,
  district,
  q,
  placeholder,
  children,
}: {
  tab: DiscoverTab;
  city: string;
  district?: string;
  q?: string;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <form className="space-y-2" action="/kesfet">
      {tab !== "takim" && <input type="hidden" name="sekme" value={tab} />}
      <RegionSelect
        key={`${city}-${district ?? ""}`}
        cityName="il"
        districtName="ilce"
        defaultCity={city}
        defaultDistrict={district}
        requireCity={false}
        showLabels={false}
        anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
        onChangeSubmit
      />
      <div className="flex gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder={placeholder} />
        <Button>Ara</Button>
      </div>
      {children}
    </form>
  );
}

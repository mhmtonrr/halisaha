import DISTRICTS_DATA from "@/data/districts.json";

/** Türkiye'nin 81 ili, alfabetik (Türkçe sıralama). */
export const PROVINCES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya",
  "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik",
  "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum",
  "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir",
  "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul",
  "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kırıkkale",
  "Kırklareli", "Kırşehir", "Kilis", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa",
  "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye",
  "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak",
  "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak",
] as const;

export function isProvince(v: string): boolean {
  return (PROVINCES as readonly string[]).includes(v);
}

/** "Kadıköy, İstanbul" */
export function formatRegion(city: string | null, district: string | null) {
  return [district, city].filter(Boolean).join(", ");
}

/** İl → ilçeler (Türkçe alfabetik). Kaynak: iki bağımsız veri setinin karşılaştırılmasıyla doğrulanmış 973 ilçe. */
export const DISTRICTS = DISTRICTS_DATA as Record<string, string[]>;

export function districtsOf(city: string | null | undefined): string[] {
  return (city && DISTRICTS[city]) || [];
}

/** Büyük/küçük harf farkını yok sayarak listedeki resmi yazımı döndürür; yoksa null */
export function canonicalDistrict(city: string | null | undefined, district: string | null | undefined): string | null {
  if (!city || !district) return null;
  const want = district.trim().toLocaleLowerCase("tr");
  return districtsOf(city).find((d) => d.toLocaleLowerCase("tr") === want) ?? null;
}

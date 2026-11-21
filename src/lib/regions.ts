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

/** İl → plaka kodu ("34"); kartta bayrak yerine gösterilir */
export const PLATES: Record<string, string> = {
  Adana: "01", Adıyaman: "02", Afyonkarahisar: "03", Ağrı: "04", Amasya: "05", Ankara: "06", Antalya: "07",
  Artvin: "08", Aydın: "09", Balıkesir: "10", Bilecik: "11", Bingöl: "12", Bitlis: "13", Bolu: "14",
  Burdur: "15", Bursa: "16", Çanakkale: "17", Çankırı: "18", Çorum: "19", Denizli: "20", Diyarbakır: "21",
  Edirne: "22", Elazığ: "23", Erzincan: "24", Erzurum: "25", Eskişehir: "26", Gaziantep: "27", Giresun: "28",
  Gümüşhane: "29", Hakkari: "30", Hatay: "31", Isparta: "32", Mersin: "33", İstanbul: "34", İzmir: "35",
  Kars: "36", Kastamonu: "37", Kayseri: "38", Kırklareli: "39", Kırşehir: "40", Kocaeli: "41", Konya: "42",
  Kütahya: "43", Malatya: "44", Manisa: "45", Kahramanmaraş: "46", Mardin: "47", Muğla: "48", Muş: "49",
  Nevşehir: "50", Niğde: "51", Ordu: "52", Rize: "53", Sakarya: "54", Samsun: "55", Siirt: "56", Sinop: "57",
  Sivas: "58", Tekirdağ: "59", Tokat: "60", Trabzon: "61", Tunceli: "62", Şanlıurfa: "63", Uşak: "64",
  Van: "65", Yozgat: "66", Zonguldak: "67", Aksaray: "68", Bayburt: "69", Karaman: "70", Kırıkkale: "71",
  Batman: "72", Şırnak: "73", Bartın: "74", Ardahan: "75", Iğdır: "76", Yalova: "77", Karabük: "78",
  Kilis: "79", Osmaniye: "80", Düzce: "81",
};

export const plateOf = (city: string | null | undefined) => (city ? (PLATES[city] ?? null) : null);

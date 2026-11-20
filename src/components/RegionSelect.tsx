"use client";

import { useState } from "react";
import { PROVINCES, canonicalDistrict, districtsOf } from "@/lib/regions";
import { Label, cx } from "./ui";

const select =
  "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none focus:border-accent disabled:opacity-50";

/**
 * Bağlı il/ilçe seçimi: il değişince ilçe listesi o ilin ilçeleriyle yenilenir.
 * `anyLabel` verilirse (ör. Keşfet filtresi) "Tüm Türkiye / Tüm ilçeler" seçeneği eklenir.
 */
export function RegionSelect({
  defaultCity,
  defaultDistrict,
  cityName = "city",
  districtName = "district",
  requireCity = true,
  requireDistrict = false,
  anyLabel,
  showLabels = true,
  onChangeSubmit,
}: {
  defaultCity?: string | null;
  defaultDistrict?: string | null;
  cityName?: string;
  districtName?: string;
  requireCity?: boolean;
  requireDistrict?: boolean;
  anyLabel?: { city: string; district: string };
  showLabels?: boolean;
  /** Seçim değişince formu gönder (filtreler için) */
  onChangeSubmit?: boolean;
}) {
  const [city, setCity] = useState(defaultCity ?? "");
  // Eski serbest metin kayıtlar ("kadıköy") listedeki resmi yazımla eşleştirilir
  const [district, setDistrict] = useState(canonicalDistrict(defaultCity, defaultDistrict) ?? "");
  const districts = districtsOf(city);

  const submit = (el: HTMLSelectElement) => {
    if (onChangeSubmit) el.form?.requestSubmit();
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        {showLabels && <Label>İl</Label>}
        <select
          name={cityName}
          value={city}
          required={requireCity}
          onChange={(e) => {
            setCity(e.target.value);
            setDistrict("");
            submit(e.target);
          }}
          className={select}
          aria-label="İl"
        >
          {anyLabel ? (
            <option value="">{anyLabel.city}</option>
          ) : (
            <option value="" disabled>
              İl seç
            </option>
          )}
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        {showLabels && <Label hint={requireDistrict ? undefined : "isteğe bağlı"}>İlçe</Label>}
        <select
          name={districtName}
          value={district}
          required={requireDistrict}
          disabled={!city}
          onChange={(e) => {
            setDistrict(e.target.value);
            submit(e.target);
          }}
          className={cx(select)}
          aria-label="İlçe"
        >
          <option value="">{!city ? "Önce il seç" : (anyLabel?.district ?? "İlçe seç")}</option>
          {districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { RegionSelect } from "@/components/RegionSelect";
import { Button, cx } from "@/components/ui";

/** Öne çıkanların bölge filtresi: düğme açılır pencerede il/ilçe (veya tüm Türkiye) seçtirir; seçim adrese yazılır (?il=&ilce=) */
export function RegionFilter({ city, district, label }: { city: string; district: string; label: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState({ city, district });
  const [pending, startTransition] = useTransition();

  const apply = () => {
    ref.current?.close();
    const q = new URLSearchParams({ il: value.city, ...(value.district ? { ilce: value.district } : {}) });
    startTransition(() => router.replace(`/?${q}`, { scroll: false }));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="Öne çıkanların bölgesi"
        className={cx("flex min-h-11 w-full items-center gap-2 rounded-full border border-primary/40 bg-surface-container px-4 text-sm font-semibold", pending && "animate-pulse")}
      >
        <Icon name="location_on" fill className="text-[18px] text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <Icon name="expand_more" className="text-[20px] text-muted" />
      </button>
      <dialog
        ref={ref}
        aria-label="Bölge seç"
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-surface-container p-0 text-on-surface backdrop:bg-black/70"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-lg font-bold">Bölge seç</div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Kapat" className="flex min-h-10 min-w-10 items-center justify-center text-muted">
              <Icon name="close" className="text-[22px]" />
            </button>
          </div>
          <RegionSelect
            // "Tüm Türkiye" düğmesinden sonra seçiciler de sıfırlansın
            key={value.city === "" ? "tr" : "region"}
            defaultCity={value.city}
            defaultDistrict={value.district}
            cityName="oneCikanIl"
            districtName="oneCikanIlce"
            requireCity={false}
            anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
            showLabels={false}
            onValue={(c, d) => setValue({ city: c, district: d })}
          />
          <Button type="button" className="w-full" onClick={apply}>
            Göster
          </Button>
        </div>
      </dialog>
    </>
  );
}

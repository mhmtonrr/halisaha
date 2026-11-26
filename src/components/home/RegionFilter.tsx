"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { RegionSelect } from "@/components/RegionSelect";
import { Button, cx } from "@/components/ui";

/** Öne çıkanların bölge filtresi: başlıktaki düğme açılır pencerede il/ilçe (veya tüm Türkiye) seçtirir */
export function RegionFilter({
  city,
  district,
  label,
  pending,
  onSelect,
}: {
  city: string;
  district: string;
  label: string;
  pending: boolean;
  onSelect: (city: string, district: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState({ city, district });
  // Pencere her açılışta gösterilen bölgeden başlar (kapatılan seçim kalmasın)
  const [opened, setOpened] = useState(0);

  const open = () => {
    setValue({ city, district });
    setOpened((n) => n + 1);
    ref.current?.showModal();
  };

  const apply = () => {
    ref.current?.close();
    onSelect(value.city, value.district);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Öne çıkanların bölgesi"
        className={cx("flex min-h-9 min-w-0 max-w-[60%] items-center gap-1 rounded-full border border-primary/40 bg-surface-container pl-2.5 pr-1.5 text-xs font-semibold", pending && "animate-pulse")}
      >
        <Icon name="location_on" fill className="text-[16px] text-primary" />
        <span className="min-w-0 truncate">{label}</span>
        <Icon name="expand_more" className="text-[18px] text-muted" />
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
            key={opened}
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

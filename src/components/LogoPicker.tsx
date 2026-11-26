"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  autoCrest, CREST_EMBLEMS, CREST_PATTERNS, CREST_SHAPES, encodeCrest, parseCrest, PRESET_LOGOS,
  type CrestEmblem, type CrestPattern, type CrestShape, type CrestSpec,
} from "@/lib/crest";
import { ColorField } from "./ColorField";
import { Crest } from "./Crest";
import { LogoUploader } from "./LogoUploader";
import { TeamBadge } from "./TeamBadge";
import { cx, Label } from "./ui";

const SHAPE_NAME: Record<CrestShape, string> = { kalkan: "Kalkan", daire: "Daire", altigen: "Altıgen", flama: "Flama" };
const EMBLEM_NAME: Record<CrestEmblem, string> = {
  harf: "Baş harfler", top: "Top", yildiz: "Yıldız", simsek: "Şimşek", tac: "Taç", alev: "Alev", kale: "Kale",
  capa: "Çapa", kartal: "Kartal", aslan: "Aslan", kurt: "Kurt", boga: "Boğa",
};
const PATTERN_NAME: Record<CrestPattern, string> = { duz: "Düz", cizgili: "Çizgili", capraz: "Çapraz", yarim: "Yarım" };
type Mode = "auto" | "crest" | "preset" | "upload";

const modeOf = (logo: string | null): Mode =>
  !logo ? "auto" : logo.startsWith("crest:") ? "crest" : logo.startsWith("preset:") ? "preset" : "upload";

function Option({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cx("flex items-center justify-center rounded-xl border p-1.5", on ? "border-accent bg-accent/15" : "border-line bg-pitch-950")}
    >
      {children}
    </button>
  );
}

/**
 * Logo seçimi (formun `logo` alanı): otomatik arma, arma yap veya hazır logo; canlı önizleme.
 * Görsel yükleme formdan bağımsız, hemen kaydedilir (LogoUploader).
 * Renkler logoların altında seçilir (birinci renk formun `color` alanı); ad aynı formun `name` alanından okunur.
 */
export function LogoPicker({ id, logo, name, color }: { id?: string; logo: string | null; name: string; color: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [liveName, setLiveName] = useState(name);
  const [primary, setPrimary] = useState(color.toLowerCase());
  const [mode, setMode] = useState<Mode>(modeOf(logo));
  const [spec, setSpec] = useState<CrestSpec>(() => (logo ? parseCrest(logo) : null) ?? autoCrest(id ?? "yeni"));
  const [preset, setPreset] = useState(logo?.startsWith("preset:") ? logo.slice(7) : (PRESET_LOGOS[0] ?? ""));

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => setLiveName(String(new FormData(form).get("name") ?? ""));
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  const shownName = liveName.trim() || "?";
  // Yüklenmiş görsel seçiliyken değer aynen geri gider; sunucu o durumda alanı değiştirmez
  const value =
    mode === "auto" ? "" : mode === "crest" ? encodeCrest(spec) : mode === "preset" ? (preset ? `preset:${preset}` : "") : (logo ?? "");
  const tabs: { key: Mode; label: string }[] = [
    { key: "auto", label: "Otomatik" },
    { key: "crest", label: "Arma yap" },
    ...(PRESET_LOGOS.length ? [{ key: "preset" as const, label: "Hazır logolar" }] : []),
    { key: "upload", label: "Yükle" },
  ];

  const row = <K extends "shape" | "emblem" | "pattern">(
    title: string,
    field: K,
    options: readonly CrestSpec[K][],
    names: Record<CrestSpec[K], string>,
  ) => (
    <div>
      <Label>{title}</Label>
      <div className="grid grid-cols-4 gap-2">
        {options.map((o) => (
          <Option key={o} on={spec[field] === o} label={names[o]} onClick={() => setSpec({ ...spec, [field]: o })}>
            <Crest spec={{ ...spec, [field]: o }} color={primary} name={shownName} className="h-10 w-10" />
          </Option>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={root}>
      <Label hint="isteğe bağlı">Logo</Label>
      <input type="hidden" name="logo" value={value} />
      <div className="mb-3 flex justify-center">
        {mode === "auto" && !id ? (
          // Otomatik arma takım kimliğinden üretilir; kurulmadan önce bilinmez
          <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-line text-3xl font-black text-muted">?</span>
        ) : (
          <TeamBadge id={id ?? "yeni"} name={shownName} color={primary} logo={value || null} size="lg" className="h-24 w-24" />
        )}
      </div>
      <div className="mb-3 flex gap-1 rounded-full bg-pitch-950 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMode(t.key)}
            aria-pressed={mode === t.key}
            className={cx("flex-1 rounded-full px-2 py-1.5 text-xs font-bold", mode === t.key ? "bg-accent text-pitch-950" : "text-muted")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "auto" && (
        <p className="text-center text-xs text-muted">
          {id ? "Birinci renk ve baş harflerle hazırlanan arma." : "Kurulunca birinci renk ve baş harflerle özel bir arma verilir."} İstediğin zaman
          değiştirebilirsin.
        </p>
      )}

      {mode === "crest" && (
        <div className="space-y-3">
          {row("Şekil", "shape", CREST_SHAPES, SHAPE_NAME)}
          {row("Sembol", "emblem", CREST_EMBLEMS, EMBLEM_NAME)}
          {row("Desen", "pattern", CREST_PATTERNS, PATTERN_NAME)}
        </div>
      )}

      {mode === "upload" &&
        (id ? (
          <LogoUploader groupId={id} uploaded={modeOf(logo) === "upload"} />
        ) : (
          <p className="text-center text-xs text-muted">Kendi görselini kurduktan sonra bilgileri düzenleme bölümünden yükleyebilirsin.</p>
        ))}

      {mode === "preset" && (
        <div className="grid grid-cols-4 gap-2">
          {PRESET_LOGOS.map((p) => (
            <Option key={p} on={preset === p} label={p} onClick={() => setPreset(p)}>
              <TeamBadge id={p} name={shownName} color={primary} logo={`preset:${p}`} />
            </Option>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <ColorField label="Birinci renk" name="color" value={primary} onChange={setPrimary} />
        {mode === "crest" && <ColorField label="İkinci renk" value={spec.second} onChange={(second) => setSpec({ ...spec, second })} />}
      </div>
    </div>
  );
}

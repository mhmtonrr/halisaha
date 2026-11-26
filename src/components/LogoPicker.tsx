"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  autoCrest, CREST_EMBLEMS, CREST_PATTERNS, CREST_SHAPES, DEFAULT_TEAM_COLOR, encodeCrest, parseCrest, PRESET_LOGOS,
  type CrestEmblem, type CrestPattern, type CrestShape, type CrestSpec,
} from "@/lib/crest";
import { TEAM_COLORS } from "@/lib/teams-data";
import { Crest } from "./Crest";
import { TeamBadge } from "./TeamBadge";
import { cx, Label } from "./ui";

const SHAPE_NAME: Record<CrestShape, string> = { kalkan: "Kalkan", daire: "Daire", altigen: "Altıgen", flama: "Flama" };
const EMBLEM_NAME: Record<CrestEmblem, string> = {
  harf: "Baş harfler", top: "Top", yildiz: "Yıldız", simsek: "Şimşek", tac: "Taç", alev: "Alev", kale: "Kale",
  capa: "Çapa", kartal: "Kartal", aslan: "Aslan", kurt: "Kurt", boga: "Boğa",
};
const PATTERN_NAME: Record<CrestPattern, string> = { duz: "Düz", cizgili: "Çizgili", capraz: "Çapraz", yarim: "Yarım" };
/** İkinci renk: koyu tonlar + takım renkleri */
const SECOND_COLORS = ["#0b1f14", "#101828", "#000000", ...TEAM_COLORS];

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
 * Ad ve takım rengi aynı formun `name` / `color` alanlarından okunur.
 */
export function LogoPicker({ id, logo, name, color }: { id?: string; logo: string | null; name: string; color: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState({ name, color });
  const [mode, setMode] = useState<Mode>(modeOf(logo));
  const [spec, setSpec] = useState<CrestSpec>(() => (logo ? parseCrest(logo) : null) ?? autoCrest(id ?? "yeni"));
  const [preset, setPreset] = useState(logo?.startsWith("preset:") ? logo.slice(7) : (PRESET_LOGOS[0] ?? ""));

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      setLive({ name: String(data.get("name") ?? ""), color: String(data.get("color") || DEFAULT_TEAM_COLOR) });
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  const shownName = live.name.trim() || "?";
  // Yüklenmiş görsel seçiliyken değer aynen geri gider; sunucu o durumda alanı değiştirmez
  const value =
    mode === "auto" ? "" : mode === "crest" ? encodeCrest(spec) : mode === "preset" ? (preset ? `preset:${preset}` : "") : (logo ?? "");
  const tabs: { key: Mode; label: string }[] = [
    { key: "auto", label: "Otomatik" },
    { key: "crest", label: "Arma yap" },
    ...(PRESET_LOGOS.length ? [{ key: "preset" as const, label: "Hazır logolar" }] : []),
    ...(modeOf(logo) === "upload" ? [{ key: "upload" as const, label: "Yüklenen" }] : []),
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
            <Crest spec={{ ...spec, [field]: o }} color={live.color} name={shownName} className="h-10 w-10" />
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
          <TeamBadge id={id ?? "yeni"} name={shownName} color={live.color} logo={value || null} size="lg" className="h-24 w-24" />
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
          {id ? "Takım rengi ve baş harflerle hazırlanan arma." : "Kurulunca takım rengi ve baş harflerle özel bir arma verilir."} İstediğin zaman
          değiştirebilirsin.
        </p>
      )}

      {mode === "crest" && (
        <div className="space-y-3">
          {row("Şekil", "shape", CREST_SHAPES, SHAPE_NAME)}
          {row("Sembol", "emblem", CREST_EMBLEMS, EMBLEM_NAME)}
          {row("Desen", "pattern", CREST_PATTERNS, PATTERN_NAME)}
          <div>
            <Label>İkinci renk</Label>
            <div className="flex flex-wrap gap-2">
              {SECOND_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSpec({ ...spec, second: c })}
                  aria-pressed={spec.second === c}
                  aria-label={c}
                  className={cx("h-9 w-9 rounded-full border-2 border-line ring-offset-2 ring-offset-pitch-900", spec.second === c && "ring-2 ring-white")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "preset" && (
        <div className="grid grid-cols-4 gap-2">
          {PRESET_LOGOS.map((p) => (
            <Option key={p} on={preset === p} label={p} onClick={() => setPreset(p)}>
              <TeamBadge id={p} name={shownName} color={live.color} logo={`preset:${p}`} />
            </Option>
          ))}
        </div>
      )}
    </div>
  );
}

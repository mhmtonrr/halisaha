"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { PREF_LABEL, type PrefKey, type Prefs } from "@/lib/notify-rules";
import { saveAvailability, setNotificationPref, setStatsShare } from "@/lib/actions";
import { usePush } from "@/components/PushControls";
import { RowIcon, RowText, type Tone } from "./blocks";

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cx("h-6 w-12 shrink-0 rounded-full p-0.5 transition-colors focus:outline-none disabled:opacity-50", checked ? "bg-primary-container" : "bg-surface-high")}
    >
      <div className={cx("h-5 w-5 rounded-full shadow transition-transform", checked ? "translate-x-6 bg-white" : "translate-x-0 bg-on-surface-variant")} />
    </button>
  );
}

function ToggleRow({ icon, tone, title, subtitle, checked, onChange, disabled, note }: { icon: string; tone: Tone; title: string; subtitle?: string; checked: boolean; onChange: () => void; disabled?: boolean; note?: string }) {
  return (
    <div className="bg-surface-container p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3.5 pr-2">
          <RowIcon icon={icon} tone={tone} />
          <RowText title={title} subtitle={subtitle} />
        </div>
        <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
      </div>
      {note && <p className="t-body-sm mt-2 text-on-surface-variant">{note}</p>}
    </div>
  );
}

const PREF_ICON: Record<PrefKey, { icon: string; tone: Tone }> = {
  votes: { icon: "how_to_vote", tone: "primary" },
  matches: { icon: "sports", tone: "secondary" },
  offers: { icon: "handshake", tone: "tertiary" },
  chat: { icon: "chat", tone: "primary" },
};

/** Bildirim anahtarları: bu cihazda push + dört kategori */
export function NotificationRows({ prefs }: { prefs: Prefs }) {
  const { status, busy, error, enable, disable } = usePush();
  const [values, setValues] = useState<Prefs>(prefs);
  const [, start] = useTransition();
  const toggle = (key: PrefKey) => {
    const next = !values[key];
    setValues((v) => ({ ...v, [key]: next }));
    start(() => {
      void setNotificationPref(key, next);
    });
  };
  const pushNote: Partial<Record<typeof status, string>> = {
    unconfigured: "Push henüz yapılandırılmadı; bildirimler uygulama içindeki kutuda görünür.",
    unsupported: "Bu tarayıcı push desteklemiyor; bildirimler uygulama içindeki kutuda görünür.",
    "ios-install": "iPhone'da önce uygulamayı ana ekrana ekle (Safari: Paylaş → Ana Ekrana Ekle), sonra oradan aç.",
    denied: "Bildirim izni kapalı. Tarayıcı/telefon ayarlarından siteye izin verip tekrar dene.",
  };
  const canToggle = status === "on" || status === "off";
  return (
    <>
      <ToggleRow
        icon="notifications_active"
        tone="primary"
        title="Bu Cihazda Bildirimler"
        subtitle={status === "on" ? "Açık" : status === "loading" ? "Kontrol ediliyor…" : "Kapalı"}
        checked={status === "on"}
        disabled={!canToggle || busy}
        onChange={() => (status === "on" ? void disable() : void enable())}
        note={error ?? pushNote[status]}
      />
      {(Object.keys(PREF_LABEL) as PrefKey[]).map((key) => (
        <ToggleRow key={key} icon={PREF_ICON[key].icon} tone={PREF_ICON[key].tone} title={PREF_LABEL[key].title} subtitle={PREF_LABEL[key].hint} checked={values[key]} onChange={() => toggle(key)} />
      ))}
    </>
  );
}

/** "İstatistiklerimi paylaş": açık = herkes görür */
export function StatsShareRow({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();
  return (
    <ToggleRow
      icon="query_stats"
      tone="secondary"
      title="İstatistiklerimi Paylaş"
      subtitle="Gol, asist ve maçın adamı verileri"
      checked={on}
      onChange={() => {
        const next = !on;
        setOn(next);
        start(() => {
          void setStatsShare(next);
        });
      }}
    />
  );
}

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Haftalık müsaitlik günleri: dokununca kaydedilir */
export function AvailabilityDays({ initial }: { initial: number[] }) {
  const [days, setDays] = useState<number[]>(initial);
  const [, start] = useTransition();
  const toggle = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setDays(next);
    start(() => {
      void saveAvailability(next);
    });
  };
  return (
    <div className="flex flex-col gap-2 bg-surface-container p-3.5">
      <div className="flex items-center gap-3.5">
        <RowIcon icon="event_available" tone="primary" />
        <RowText title="Haftalık Müsaitlik Günleri" subtitle="Takımların seni çağırabileceği akşamlar" />
      </div>
      <div className="grid grid-cols-7 gap-1.5 pt-1">
        {DAYS.map((label, d) => (
          <button
            key={label}
            type="button"
            aria-pressed={days.includes(d)}
            onClick={() => toggle(d)}
            className={cx(
              "t-label-caps flex h-9 items-center justify-center rounded-lg font-bold transition-all",
              days.includes(d) ? "bg-primary text-on-primary shadow-sm" : "bg-surface-high text-on-surface-variant hover:bg-surface-bright",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Dondur / yeniden aç / çıkış: onay isteyen form düğmesi */
export function ConfirmButton({ children, message, className }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

export { Icon };

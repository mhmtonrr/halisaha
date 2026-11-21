"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscription, savePushSubscription, setNotificationPref } from "@/lib/actions";
import { PREF_LABEL, type PrefKey, type Prefs } from "@/lib/notify-rules";
import { detectStatus, subscribeThisDevice, unsubscribeThisDevice, type PushStatus } from "@/lib/push-client";
import { Button, Card, cx } from "@/components/ui";

const DISMISS_KEY = "hs-push-dismissed";
const DISMISS_DAYS = 14;

/** Bu cihazda bildirimleri açma/kapama mantığı (kart ve profil ayarı ortak kullanır) */
function usePush() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detectStatus().then(setStatus, () => setStatus("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const sub = await subscribeThisDevice();
      const res = await savePushSubscription(sub, navigator.userAgent);
      if (!res.ok) throw new Error(res.error ?? "Abonelik kaydedilemedi");
      setStatus("on");
    } catch (e) {
      const denied = e instanceof Error && e.message === "denied";
      if (denied) setStatus("denied");
      else setError("Bildirimler açılamadı. Biraz sonra tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await removePushSubscription(endpoint);
      setStatus("off");
    } catch {
      setError("Bildirimler kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, error, enable, disable };
}

const IOS_HELP = "iPhone'da bildirim için önce uygulamayı ana ekrana ekle: Safari'de Paylaş ⎙ → “Ana Ekrana Ekle”, sonra oradan aç.";

/**
 * Anlamlı bir anda çıkan izin kartı (oy verdikten, çağrıya yanıt verdikten, başvurduktan sonra).
 * Desteklenmeyen/yapılandırılmamış/reddedilmiş/zaten açık cihazlarda ve "şimdi değil" denmişse 14 gün görünmez.
 */
export function PushPrompt({ reason }: { reason: string }) {
  const { status, busy, error, enable } = usePush();
  const [dismissed, setDismissed] = useState(true); // sunucu ile uyum: önce gizli, sonra yerelden okunur

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setDismissed(Date.now() - at < DISMISS_DAYS * 86400_000);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || (status !== "off" && status !== "ios-install")) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // depolama kapalıysa sadece bu sayfada gizle
    }
    setDismissed(true);
  };

  return (
    <Card className="mb-4 space-y-2 border-accent/40 bg-accent/10">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔔</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{reason}</div>
          <p className="mt-0.5 text-xs text-muted">{status === "ios-install" ? IOS_HELP : "Oylama, çağrı ve teklifler için bildirim gelsin; istediğin zaman profilinden kapatırsın."}</p>
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        {status === "off" && (
          <Button className="min-h-10 flex-1 text-sm" onClick={enable} disabled={busy} type="button">
            {busy ? "Açılıyor…" : "Bildirimleri aç"}
          </Button>
        )}
        <Button variant="secondary" className="min-h-10 flex-1 text-sm" onClick={dismiss} type="button">
          Şimdi değil
        </Button>
      </div>
    </Card>
  );
}

/** Profilde: bu cihazın durumu + kategori düğmeleri */
export function PushSettings({ prefs }: { prefs: Prefs }) {
  const { status, busy, error, enable, disable } = usePush();
  const [values, setValues] = useState<Prefs>(prefs);
  const [, startTransition] = useTransition();

  const toggle = (key: PrefKey) => {
    const next = !values[key];
    setValues((v) => ({ ...v, [key]: next }));
    startTransition(() => {
      void setNotificationPref(key, next);
    });
  };

  const info: Record<PushStatus, string> = {
    loading: "Kontrol ediliyor…",
    unconfigured: "Push bildirimleri henüz yapılandırılmadı. Bildirimler yine de uygulama içindeki kutuda görünür.",
    unsupported: "Bu tarayıcı push bildirimini desteklemiyor. Bildirimler uygulama içindeki kutuda görünür.",
    "ios-install": IOS_HELP,
    denied: "Bu cihazda bildirim izni kapalı. Tarayıcı/telefon ayarlarından siteye bildirim iznini açıp tekrar dene.",
    off: "Bu cihazda bildirimler kapalı.",
    on: "Bu cihazda bildirimler açık ✓",
  };

  return (
    <Card className="space-y-4">
      <div className="space-y-2">
        <p className={cx("text-sm", status === "on" ? "text-accent" : "text-muted")}>{info[status]}</p>
        {error && <p className="text-xs text-red-300">{error}</p>}
        {status === "off" && (
          <Button className="w-full" onClick={enable} disabled={busy} type="button">
            {busy ? "Açılıyor…" : "🔔 Bu cihazda bildirimleri aç"}
          </Button>
        )}
        {status === "on" && (
          <Button variant="secondary" className="w-full" onClick={disable} disabled={busy} type="button">
            {busy ? "Kapatılıyor…" : "Bu cihazda kapat"}
          </Button>
        )}
      </div>
      <div className="space-y-1 border-t border-line pt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Hangi bildirimler?</div>
        {(Object.keys(PREF_LABEL) as PrefKey[]).map((key) => (
          <label key={key} className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{PREF_LABEL[key].title}</span>
              <span className="block text-xs text-muted">{PREF_LABEL[key].hint}</span>
            </span>
            <input type="checkbox" checked={values[key]} onChange={() => toggle(key)} className="h-5 w-5 accent-accent" />
          </label>
        ))}
        <p className="pt-1 text-xs text-muted">Kapattığın kategoriler hem push hem bildirim kutusu için geçerli olur.</p>
      </div>
    </Card>
  );
}

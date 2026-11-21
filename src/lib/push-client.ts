// Tarayıcı tarafı web push yardımcıları (sadece istemci bileşenlerinden çağrılır).

export type PushStatus = "loading" | "unconfigured" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Bu cihazın bildirim durumu */
export async function detectStatus(): Promise<PushStatus> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  // iPhone'da push sadece ana ekrana eklenmiş uygulamada çalışır (Safari sekmesinde PushManager yoktur)
  if (isIos() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** İzin ister, abone olur ve sunucuya kaydedilecek düz nesneyi döndürür */
export async function subscribeThisDevice(): Promise<{ endpoint: string; p256dh: string; auth: string }> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Abonelik bilgisi eksik");
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Bu cihazın aboneliğini kaldırır; kaldırılan endpoint'i döndürür (sunucudan da silinsin diye) */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

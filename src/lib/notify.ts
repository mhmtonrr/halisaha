import "server-only";
import { after } from "next/server";
import { sendNotification, setVapidDetails } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  planRecipients,
  sendToAll,
  explainPushFailure,
  CHAT_MERGE_MINUTES,
  type Content,
  type NotificationType,
  type Prefs,
  type PushSender,
  type Subscription,
} from "@/lib/notify-rules";

let vapidReady = false;

/** VAPID anahtarları ortamda varsa web push açılır; yoksa bildirimler sadece uygulama içi kutuya yazılır */
function pushConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!vapidReady) {
    // Konu (subject) bir URL olabilir: kişisel e-posta adresi koymayız
    setVapidDetails(process.env.VAPID_SUBJECT ?? "https://halisaha-tawny.vercel.app", pub, priv);
    vapidReady = true;
  }
  return true;
}

const defaultSender: PushSender = async (sub, payload) => {
  await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
    TTL: 12 * 3600,
    // Yüksek öncelik: Android'de ekran kapalıyken (Doze) normal öncelikli push'lar dakikalarca/saatlerce bekletilir,
    // yüksek öncelikli olanlar cihazı uyandırıp hemen gösterilir. Bildirimlerimiz hep kullanıcıya görünür (sohbet, oylama, çağrı).
    urgency: "high",
    timeout: 10_000, // takılı bir push servisi isteği bekletmesin
  });
};

export interface NotifyOptions {
  /** Olayı yapan kişi: kendi işlemi için bildirim almaz */
  excludeUserId?: string | null;
  /** Test için push gönderici */
  sender?: PushSender;
}

/**
 * Bildirimi alıcıların kutusuna yazar ve (izin/abonelik varsa) web push gönderir.
 * Kategori tercihi kapalı olanlara ve (sohbette) son 10 dakikada aynı gruptan bildirim almışlara yazılmaz.
 * Asla fırlatmaz: bildirim hatası kullanıcının asıl işlemini bozmamalı.
 */
export async function notify(
  userIds: Iterable<string>,
  type: NotificationType,
  content: Content,
  opts: NotifyOptions = {},
): Promise<{ stored: number; sent: number }> {
  try {
    const wanted = [...new Set(userIds)].filter((id) => id && id !== opts.excludeUserId);
    if (!wanted.length) return { stored: 0, sent: 0 };
    const admin = createAdminClient();

    // Hesabı dondurulanlara bildirim gitmez
    const { data: frozenRows } = await admin.from("profiles").select("id").in("id", wanted).not("frozen_at", "is", null);
    const frozen = new Set((frozenRows ?? []).map((r) => r.id as string));
    const ids = wanted.filter((id) => !frozen.has(id));
    if (!ids.length) return { stored: 0, sent: 0 };

    const { data: prefRows } = await admin.from("notification_prefs").select("user_id, votes, matches, offers, chat").in("user_id", ids);
    const prefsByUser = new Map<string, Partial<Prefs>>((prefRows ?? []).map((p) => [p.user_id as string, p as Partial<Prefs>]));

    let recentByUser: Map<string, string> | undefined;
    if ((type === "chat" || type === "dm") && content.tag) {
      const since = new Date(Date.now() - CHAT_MERGE_MINUTES * 60_000).toISOString();
      const { data: recent } = await admin
        .from("notifications")
        .select("user_id, created_at")
        .eq("tag", content.tag)
        .in("user_id", ids)
        .gte("created_at", since);
      recentByUser = new Map((recent ?? []).map((r) => [r.user_id as string, r.created_at as string]));
    }

    const targets = planRecipients({ type, userIds: ids, excludeUserId: opts.excludeUserId, prefsByUser, recentByUser });
    if (!targets.length) return { stored: 0, sent: 0 };

    const rows = targets.map((user_id) => ({
      user_id,
      type,
      title: content.title,
      body: content.body,
      url: content.url,
      tag: content.tag ?? null,
    }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) throw error;

    let sent = 0;
    if (opts.sender || pushConfigured()) {
      const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", targets);
      const payload = JSON.stringify({ title: content.title, body: content.body, url: content.url, tag: content.tag ?? type, type });
      const result = await sendToAll((subs ?? []) as Subscription[], payload, opts.sender ?? defaultSender);
      sent = result.sent;
      // Başarısız gönderimleri iz bırakmadan yutma: Vercel kayıtlarında görünsün
      for (const f of result.errors) console.error("[push]", f.statusCode ?? "-", f.message);
      // Push servisinin "artık yok" dediği abonelikler silinir
      if (result.dead.length) await admin.from("push_subscriptions").delete().in("endpoint", result.dead);
    }
    return { stored: targets.length, sent };
  } catch (e) {
    console.error("[bildirim]", e instanceof Error ? e.message : e);
    return { stored: 0, sent: 0 };
  }
}

/** İşi yanıt döndükten sonra yapar (kullanıcıyı bekletmez); istek bağlamı yoksa hemen çalıştırır. Hata asıl işlemi bozmaz. */
export function later(fn: () => Promise<void>) {
  const run = () => fn().catch((e) => console.error("[bildirim]", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}

export interface TestPushResult {
  ok: boolean;
  message: string;
}

/**
 * Kullanıcının kendi cihazlarına test bildirimi gönderir ve sonucu açıklar (bildirim kutusuna yazmaz).
 * Aboneliğin, sunucu anahtarlarının ve push servisinin uçtan uca çalışıp çalışmadığını gösterir.
 */
export async function sendTestPush(userId: string): Promise<TestPushResult> {
  try {
    if (!pushConfigured()) {
      return { ok: false, message: "Sunucuda VAPID anahtarları eksik (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Vercel'e ekledikten sonra yeniden dağıtım gerekir." };
    }
    const admin = createAdminClient();
    const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
    if (!subs?.length) {
      return { ok: false, message: "Bu hesapta kayıtlı cihaz yok. Önce bu cihazda “Bildirimleri aç”a bas; kayıt tamamlanınca burada “açık ✓” yazar." };
    }
    const payload = JSON.stringify({ title: "🔔 Test bildirimi", body: "Bildirimler bu cihazda çalışıyor.", url: "/profil?sekme=ayarlar", tag: "test" });
    const result = await sendToAll(subs as Subscription[], payload, defaultSender);
    if (result.dead.length) await admin.from("push_subscriptions").delete().in("endpoint", result.dead);
    for (const f of result.errors) console.error("[push-test]", f.statusCode ?? "-", f.message);
    if (result.sent > 0) {
      return { ok: true, message: `Gönderildi (${result.sent} cihaz). Birkaç saniye içinde gelmezse telefonun pil tasarrufu/rahatsız etme modunu ve tarayıcının bildirim iznini kontrol et.` };
    }
    return { ok: false, message: explainPushFailure(result.errors[0] ?? { message: "bilinmeyen hata" }) };
  } catch (e) {
    console.error("[push-test]", e instanceof Error ? e.message : e);
    return { ok: false, message: "Test gönderilemedi (sunucu hatası)." };
  }
}

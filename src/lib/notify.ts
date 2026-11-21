import "server-only";
import { after } from "next/server";
import { sendNotification, setVapidDetails } from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  planRecipients,
  sendToAll,
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
    urgency: "normal",
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
    const ids = [...new Set(userIds)].filter((id) => id && id !== opts.excludeUserId);
    if (!ids.length) return { stored: 0, sent: 0 };
    const admin = createAdminClient();

    const { data: prefRows } = await admin.from("notification_prefs").select("user_id, votes, matches, offers, chat").in("user_id", ids);
    const prefsByUser = new Map<string, Partial<Prefs>>((prefRows ?? []).map((p) => [p.user_id as string, p as Partial<Prefs>]));

    let recentByUser: Map<string, string> | undefined;
    if (type === "chat" && content.tag) {
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

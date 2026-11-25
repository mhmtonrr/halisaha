import { finalizeExpired } from "@/lib/finalize";
import { sendVoteReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/**
 * Günlük oylama işleri (Vercel Cron): önce süresi dolan oylamaları kapatır (sonuçlar açıklanır, kimse sayfa
 * açmasa da), sonra kapanmak üzere olanlar için hatırlatma gönderir. Vercel, CRON_SECRET ortam değişkeni tanımlıysa isteğe
 * `Authorization: Bearer <CRON_SECRET>` ekler. Anahtar tanımlı değilse yol KAPALIDIR (herkese açık tetikleme olmasın).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Yetkisiz", { status: 401 });
  }
  const finalized = await finalizeExpired();
  return Response.json({ finalized, ...(await sendVoteReminders(Date.now(), 24)) });
}

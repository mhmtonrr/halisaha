import { sendVoteReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/**
 * Günlük oylama hatırlatması (Vercel Cron). Vercel, CRON_SECRET ortam değişkeni tanımlıysa isteğe
 * `Authorization: Bearer <CRON_SECRET>` ekler. Anahtar tanımlı değilse yol KAPALIDIR (herkese açık tetikleme olmasın).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Yetkisiz", { status: 401 });
  }
  return Response.json(await sendVoteReminders());
}

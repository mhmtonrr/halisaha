import { runTick } from "@/lib/cron-tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Zamanlanmış işler (src/lib/cron-tick.ts): Supabase pg_cron + pg_net her 15 dakikada POST eder; Vercel Cron günde 1
 * GET ile yedek çağırır. İkisi de `Authorization: Bearer <CRON_SECRET>` gönderir. Anahtar tanımlı değilse yol KAPALIDIR.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Yetkisiz", { status: 401 });
  }
  return Response.json(await runTick());
}

export const GET = handle;
export const POST = handle;

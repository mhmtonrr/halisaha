import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSkillQueue } from "@/lib/skill-queue";
import { Card } from "@/components/ui";

/** Değerlendirmeni bekleyen oyuncu varsa /yetenek'e götüren kart; yoksa hiçbir şey göstermez */
export async function SkillQueueBanner({ supabase, className }: { supabase: SupabaseClient; className?: string }) {
  const queue = await getSkillQueue(supabase, 20);
  if (queue.length === 0) return null;
  return (
    <Link href="/yetenek" className={className}>
      <Card className="flex items-center gap-3 border-accent/40 bg-accent/10 transition hover:border-accent">
        <span className="text-2xl">🎯</span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Yetenek değerlendirmesi</div>
          <div className="text-xs text-muted">
            {queue.length >= 20 ? "20+" : queue.length} oyuncuyu hız, şut, pas gibi yeteneklerde puanla
          </div>
        </div>
        <span className="text-muted">›</span>
      </Card>
    </Link>
  );
}

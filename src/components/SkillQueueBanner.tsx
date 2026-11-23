import type { SupabaseClient } from "@supabase/supabase-js";
import { getSkillQueue } from "@/lib/skill-queue";
import { ActionItem } from "@/components/home/ActionItem";

/** Değerlendirmeni bekleyen oyuncu varsa /yetenek'e götüren kart; yoksa hiçbir şey göstermez */
export async function SkillQueueBanner({ supabase, className }: { supabase: SupabaseClient; className?: string }) {
  const queue = await getSkillQueue(supabase, 20);
  if (queue.length === 0) return null;
  return (
    <ActionItem
      href="/yetenek"
      icon="target"
      tone="green"
      className={className}
      title="Yetenek değerlendirmesi"
      sub={`${queue.length >= 20 ? "20+" : queue.length} oyuncuyu hız, şut, pas gibi yeteneklerde puanla`}
    />
  );
}

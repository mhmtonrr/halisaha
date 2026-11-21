import type { SupabaseClient } from "@supabase/supabase-js";

export interface SkillQueueItem {
  /** Değerlendirilecek oyuncunun group_players.id'si (RPC'ye bu verilir) */
  playerId: string;
  name: string;
  isGuest: boolean;
  /** Birlikte oynanan maçlarda kaleci mi (kaleci yetenek seti sorulur) */
  keeper: boolean;
  /** Birlikte oynanan maç sayısı */
  matches: number;
}

/** Değerlendirmeni bekleyen oyuncular: birlikte en az 2 maç oynadığın, son 30 günde puanlamadığın kişiler */
export async function getSkillQueue(supabase: SupabaseClient, limit = 5): Promise<SkillQueueItem[]> {
  const { data, error } = await supabase.rpc("skill_queue", { p_limit: limit });
  if (error) return [];
  return ((data ?? []) as { target_player: string; display_name: string; is_guest: boolean; keeper: boolean; matches: number }[]).map((r) => ({
    playerId: r.target_player,
    name: r.display_name,
    isGuest: r.is_guest,
    keeper: r.keeper,
    matches: r.matches,
  }));
}

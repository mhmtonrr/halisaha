import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIn } from "@/lib/fetch-in";

/** Hesap sahibinin kart verisi: genel rating + yetenekler. Hesap başına tek kaynak (user_ratings / user_skills). */
export interface UserCard {
  overall: number;
  matches_played: number;
  confidence: number;
  skills: Record<string, number | null>;
}

/**
 * Kullanıcıların kart verisi. Kaydı olmayan kullanıcı haritada yer almaz (çağıran varsayılanı uygular).
 * Misafirlerin (user_id boş) kartı eski gibi group_players satırına bağlı player_ratings/player_skills'tedir.
 */
export async function loadUserCards(client: SupabaseClient, userIds: (string | null | undefined)[]): Promise<Map<string, UserCard>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const out = new Map<string, UserCard>();
  if (!ids.length) return out;
  const [ratings, skills] = await Promise.all([
    fetchIn<{ user_id: string; overall: number; matches_played: number; confidence: number }>(ids, (part, from, to) =>
      client.from("user_ratings").select("user_id, overall, matches_played, confidence").in("user_id", part).range(from, to),
    ),
    fetchIn<{ user_id: string; skills: Record<string, number | null> | null }>(ids, (part, from, to) =>
      client.from("user_skills").select("user_id, skills").in("user_id", part).range(from, to),
    ),
  ]);
  const skillOf = new Map(skills.map((s) => [s.user_id, s.skills ?? {}]));
  for (const r of ratings) {
    out.set(r.user_id, { overall: r.overall, matches_played: r.matches_played, confidence: r.confidence, skills: skillOf.get(r.user_id) ?? {} });
  }
  // Rating'i olmayıp yeteneği olan kişi (nadir) yine de yeteneğini taşısın
  for (const [uid, s] of skillOf) {
    if (!out.has(uid)) out.set(uid, { overall: NaN, matches_played: 0, confidence: 0, skills: s });
  }
  return out;
}

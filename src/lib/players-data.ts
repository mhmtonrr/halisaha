import { trPattern } from "@/lib/search";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIn } from "@/lib/fetch-in";
import { loadUserCards } from "@/lib/user-cards";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { one, type Foot, type Position } from "@/lib/data";
import type { PlayerCandidate, PublicTeamRef } from "@/lib/player-search";

/**
 * Oyuncu aday verisi (service role). Bir kişinin rating'i özel gruplardaki satırlara bağlı olduğundan normal (RLS'li)
 * sorguyla okunamaz. **Çağıran oturumu doğrulamış olmalı**; sadece `discoverable` kişiler döner ve özel grup adı hiç taşınmaz.
 */

/** Tek sorguda taranan en fazla profil (bölge/mevki süzgeçlerinden sonra) */
const CANDIDATE_LIMIT = 1000;

type G = { id: string; name: string; kind: "community" | "team"; color: string | null; logo: string | null };
type GP = {
  user_id: string;
  is_loan: boolean | null;
  left_at: string | null;
  groups: G | G[] | null;
};
type ProfileRow = {
  id: string;
  display_name: string;
  card_name: string | null;
  photo_url: string | null;
  city: string | null;
  district: string | null;
  preferred_position: string | null;
  secondary_positions: string[] | null;
  preferred_foot: string | null;
  shirt_number: number | null;
};

const PROFILE_COLS = "id, display_name, card_name, photo_url, city, district, preferred_position, secondary_positions, preferred_foot, shirt_number";

/** Profil satırlarından, rating/yetenek/takım/gelmedi bilgisiyle aday listesi kurar */
async function buildCandidates(admin: SupabaseClient, profiles: ProfileRow[]): Promise<PlayerCandidate[]> {
  const ids = profiles.map((p) => p.id);
  if (!ids.length) return [];
  const [rows, noShowRows, cards] = await Promise.all([
    fetchIn<GP>(ids, (part, from, to) =>
      admin
        .from("group_players")
        .select("user_id, is_loan, left_at, groups(id, name, kind, color, logo)")
        .in("user_id", part)
        .range(from, to),
    ),
    fetchIn<{ user_id: string }>(ids, (part, from, to) => admin.from("match_no_shows").select("user_id").in("user_id", part).range(from, to)),
    loadUserCards(admin, ids),
  ]);
  const byUser = new Map<string, GP[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const noShows = new Map<string, number>();
  for (const r of noShowRows) noShows.set(r.user_id, (noShows.get(r.user_id) ?? 0) + 1);

  return profiles.map((p) => {
    const mine = byUser.get(p.id) ?? [];
    // Kart verisi hesap başına tek satırda (user_ratings / user_skills)
    const card = cards.get(p.id);
    const rating = card && !Number.isNaN(card.overall) ? card : undefined;
    const skills = card?.skills ?? {};
    const teams: PublicTeamRef[] = [];
    for (const r of mine) {
      const g = one(r.groups);
      if (g?.kind === "team" && !r.is_loan && !r.left_at) teams.push({ id: g.id, name: g.name, color: g.color, logo: g.logo });
    }
    return {
      userId: p.id,
      name: p.display_name,
      cardName: p.card_name,
      photoUrl: p.photo_url,
      city: p.city,
      district: p.district,
      position: (p.preferred_position ?? null) as Position | null,
      secondary: (p.secondary_positions ?? []) as Position[],
      foot: (p.preferred_foot ?? null) as Foot | null,
      shirt: p.shirt_number,
      overall: rating?.overall ?? DEFAULT_OVERALL,
      matches: rating?.matches_played ?? 0,
      skills,
      noShows: noShows.get(p.id) ?? 0,
      teams,
    };
  });
}

/** Aramaya açık oyuncular: bölge/ad/mevki/ayak veritabanında süzülür, gerisi player-search.ts'de */
export async function loadCandidates(
  admin: SupabaseClient,
  f: { city?: string; district?: string; q?: string; position?: Position; includeSecondary?: boolean; foot?: Foot },
): Promise<PlayerCandidate[]> {
  let query = admin.from("profiles").select(PROFILE_COLS).eq("discoverable", true).is("frozen_at", null).not("onboarded_at", "is", null);
  if (f.city) query = query.eq("city", f.city);
  if (f.district) query = query.filter("district", "imatch", `^${trPattern(f.district)}$`);
  if (f.q) query = query.filter("display_name", "imatch", trPattern(f.q));
  if (f.foot) query = query.eq("preferred_foot", f.foot);
  if (f.position) {
    query = f.includeSecondary
      ? query.or(`preferred_position.eq.${f.position},secondary_positions.cs.{${f.position}}`)
      : query.eq("preferred_position", f.position);
  }
  const { data, error } = await query.limit(CANDIDATE_LIMIT);
  if (error) throw error;
  return buildCandidates(admin, (data ?? []) as ProfileRow[]);
}

/** Belirli kişilerin adayları (aramaya açık olanlar): öne çıkan bölümleri için */
export async function loadCandidatesByIds(admin: SupabaseClient, userIds: string[]): Promise<PlayerCandidate[]> {
  if (!userIds.length) return [];
  const profiles = await fetchIn<ProfileRow>(userIds, (part, from, to) =>
    admin.from("profiles").select(PROFILE_COLS).in("id", part).eq("discoverable", true).is("frozen_at", null).range(from, to),
  );
  return buildCandidates(admin, profiles);
}

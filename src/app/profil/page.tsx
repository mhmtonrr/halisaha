import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { updateProfile } from "@/lib/actions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { one, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { Button, Card, ErrorNote, Header, SectionTitle } from "@/components/ui";
import { ProfileFields, type ProfileValues } from "@/components/ProfileFields";
import { OvrBadge, PlayerCard } from "@/components/PlayerCard";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const { supabase, user } = await requireUser();

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, city, district, birth_year, preferred_position, secondary_positions, preferred_foot, shirt_number, bio")
      .eq("id", user.id)
      .single(),
    supabase
      .from("group_players")
      .select("id, group_id, groups(name), player_ratings(overall, matches_played)")
      .eq("user_id", user.id),
  ]);

  const position = (profile?.preferred_position ?? null) as Position | null;
  const best = Math.max(
    DEFAULT_OVERALL,
    ...(memberships ?? []).map((m) => one(m.player_ratings as { overall: number } | { overall: number }[] | null)?.overall ?? 0),
  );

  return (
    <main>
      <Header title="Profilim" back="/" />
      <ErrorNote message={error} />
      {saved && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Profil kaydedildi ✓</p>
      )}

      <PlayerCard
        name={profile?.display_name ?? ""}
        overall={best}
        position={position}
        shirtNumber={profile?.shirt_number}
        attributes={[]}
      />
      <p className="mt-2 text-center text-xs text-muted">
        {formatRegion(profile?.city ?? null, profile?.district ?? null)}
        {profile?.city ? " · " : ""}Kartında en yüksek grup puanın görünür.
      </p>

      <form action={updateProfile} className="mt-6 space-y-4">
        <Card className="space-y-4">
          <ProfileFields values={profile as ProfileValues} full />
        </Card>
        <Button className="w-full">Kaydet</Button>
        <p className="text-center text-xs text-muted">
          Adın ve ana mevkin tüm gruplarında güncellenir. Maça özel mevkini maçı kuran kişi değiştirebilir.
        </p>
      </form>

      {(memberships?.length ?? 0) > 0 && (
        <>
          <SectionTitle>Gruplarımdaki kartlarım</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {memberships!.map((m) => {
                const r = one(m.player_ratings as { overall: number; matches_played: number } | { overall: number; matches_played: number }[] | null);
                const g = one(m.groups as { name: string } | { name: string }[] | null);
                return (
                  <li key={m.id}>
                    <Link href={`/g/${m.group_id}/p/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-pitch-800">
                      <OvrBadge overall={r?.overall ?? DEFAULT_OVERALL} />
                      <span className="flex-1">{g?.name}</span>
                      <span className="text-xs text-muted">{r?.matches_played ?? 0} maç ›</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </main>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { updateProfile } from "@/lib/actions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { FOOT_NAME, POSITION_NAME, POSITIONS, one, type Foot, type Position } from "@/lib/data";
import { Button, Card, ErrorNote, Header, Input, Label, SectionTitle } from "@/components/ui";
import { OvrBadge, PlayerCard } from "@/components/PlayerCard";

const chip =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-line px-3 text-sm transition has-[:checked]:border-accent has-[:checked]:bg-accent/15 has-[:checked]:text-accent";

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
      .select("display_name, preferred_position, secondary_positions, preferred_foot, shirt_number, bio")
      .eq("id", user.id)
      .single(),
    supabase
      .from("group_players")
      .select("id, group_id, groups(name), player_ratings(overall, matches_played)")
      .eq("user_id", user.id),
  ]);

  const position = (profile?.preferred_position ?? null) as Position | null;
  const secondary = (profile?.secondary_positions ?? []) as Position[];
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
      <p className="mt-2 text-center text-xs text-muted">Kartında en yüksek grup puanın görünür.</p>

      <form action={updateProfile} className="mt-6 space-y-4">
        <Card className="space-y-4">
          <label className="block">
            <Label>Ad soyad</Label>
            <Input name="name" defaultValue={profile?.display_name ?? ""} required minLength={2} maxLength={40} />
          </label>

          <div>
            <Label>Ana mevki</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <label key={p} className={chip}>
                  <input type="radio" name="position" value={p} defaultChecked={position === p} className="sr-only" />
                  {POSITION_NAME[p]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label hint="birden fazla seçebilirsin">Oynayabildiğim diğer mevkiler</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <label key={p} className={chip}>
                  <input type="checkbox" name="secondary" value={p} defaultChecked={secondary.includes(p)} className="sr-only" />
                  {POSITION_NAME[p]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div>
              <Label>Ayak</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(FOOT_NAME) as Foot[]).map((f) => (
                  <label key={f} className={chip}>
                    <input type="radio" name="foot" value={f} defaultChecked={profile?.preferred_foot === f} className="sr-only" />
                    {FOOT_NAME[f]}
                  </label>
                ))}
              </div>
            </div>
            <label>
              <Label>Forma no</Label>
              <Input
                type="number"
                inputMode="numeric"
                name="shirt"
                min={1}
                max={99}
                defaultValue={profile?.shirt_number ?? ""}
                className="text-center"
              />
            </label>
          </div>

          <label className="block">
            <Label hint="en fazla 160 karakter">Hakkımda</Label>
            <textarea
              name="bio"
              maxLength={160}
              rows={2}
              defaultValue={profile?.bio ?? ""}
              placeholder="Örn. Sol kanattan bindiren, şutu sert bir oyuncu"
              className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </label>
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

import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPerson } from "@/lib/profile-data";
import { updateFootballer } from "@/lib/actions";
import { SubScreen } from "@/components/settings/SubScreen";
import { chip, primaryButton, textareaClass } from "@/components/settings/blocks";
import { CardPhotoUploader } from "@/components/CardPhotoUploader";
import { Input, Label } from "@/components/ui";
import { FOOT_NAME, POSITION_NAME, POSITIONS, type Foot } from "@/lib/data";
import { cardSkills } from "@/lib/skills";

export default async function FootballerPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const { supabase, user } = await requireUser();
  const [person, { data: p }] = await Promise.all([
    loadPerson(createAdminClient(), user.id),
    supabase.from("profiles").select("preferred_position, secondary_positions, preferred_foot, shirt_number, height_cm, weight_kg, bio").eq("id", user.id).single(),
  ]);
  if (!person || !p) throw new Error("Profil bulunamadı");
  const pr = person.profile;

  return (
    <SubScreen title="Futbolcu Profili & Tercihler" error={error} saved={saved}>
      <div className="rounded-xl bg-surface-container p-3.5 shadow-sm">
        <h3 className="t-label-caps mb-3 uppercase tracking-widest text-primary">Kart fotoğrafı</h3>
        <CardPhotoUploader
          userId={user.id}
          currentUrl={pr.photoUrl}
          preview={{
            name: pr.displayName,
            cardName: pr.cardName,
            overall: person.overall,
            position: pr.position,
            skills: cardSkills(person.skills, pr.position === "GK"),
            city: pr.city,
            district: pr.district,
            unrated: person.matchesPlayed === 0,
          }}
        />
      </div>

      <form action={updateFootballer} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-sm">
          <div>
            <Label>Ana mevki</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((x) => (
                <label key={x} className={chip}>
                  <input type="radio" name="position" value={x} required defaultChecked={p.preferred_position === x} className="sr-only" />
                  {POSITION_NAME[x]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label hint="birden fazla seçebilirsin">İkinci / diğer mevkiler</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((x) => (
                <label key={x} className={chip}>
                  <input type="checkbox" name="secondary" value={x} defaultChecked={(p.secondary_positions ?? []).includes(x)} className="sr-only" />
                  {POSITION_NAME[x]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label hint="isteğe bağlı">Ayak</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FOOT_NAME) as Foot[]).map((f) => (
                <label key={f} className={chip}>
                  <input type="radio" name="foot" value={f} defaultChecked={p.preferred_foot === f} className="sr-only" />
                  {FOOT_NAME[f]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label>
              <Label>Forma no</Label>
              <Input type="number" inputMode="numeric" name="shirt" min={1} max={99} defaultValue={p.shirt_number ?? ""} className="text-center" />
            </label>
            <label>
              <Label hint="cm">Boy</Label>
              <Input type="number" inputMode="numeric" name="height" min={120} max={230} defaultValue={p.height_cm ?? ""} placeholder="182" className="text-center" />
            </label>
            <label>
              <Label hint="kg">Kilo</Label>
              <Input type="number" inputMode="numeric" name="weight" min={30} max={200} defaultValue={p.weight_kg ?? ""} placeholder="76" className="text-center" />
            </label>
          </div>
          <label className="block">
            <Label hint="en fazla 160 karakter">Hakkımda</Label>
            <textarea
              name="bio"
              maxLength={160}
              rows={2}
              defaultValue={p.bio ?? ""}
              placeholder="Örn. Sol kanattan bindiren, şutu sert bir oyuncu"
              className={textareaClass}
            />
          </label>
        </div>
        <button className={primaryButton}>Kaydet</button>
        <p className="text-center text-xs text-on-surface-variant">Ana mevkin tüm gruplarında güncellenir. Maça özel mevkini maçı kuran kişi değiştirebilir.</p>
      </form>
    </SubScreen>
  );
}

import { updateDiscoverable, updateProfile, updateStatsVisibility } from "@/lib/actions";
import { Button, Card, SectionTitle } from "@/components/ui";
import { ProfileFields, type ProfileValues } from "@/components/ProfileFields";
import { PushSettings } from "@/components/PushControls";
import { DEFAULT_PREFS } from "@/lib/notify-rules";
import type { StatsVisibility } from "@/lib/profile-data";
import { CardPhotoUploader } from "@/components/CardPhotoUploader";
import type { ComponentProps } from "react";

const OPTIONS: { value: StatsVisibility; title: string; hint: string }[] = [
  { value: "teammates", title: "Sadece takım arkadaşlarım", hint: "Ortak bir grup veya takımı olanlar istatistiklerini ve maç geçmişini görür." },
  { value: "public", title: "Herkes", hint: "Giriş yapmış herkes görür (özel grupların adı yine gizli kalır)." },
];

/** Ayarlar sekmesi: profil bilgileri, istatistik görünürlüğü, bildirimler */
export function SettingsPanel({
  values,
  visibility,
  discoverable,
  prefs,
  photo,
}: {
  values: ProfileValues;
  visibility: StatsVisibility;
  discoverable: boolean;
  prefs: typeof DEFAULT_PREFS;
  photo: { userId: string; url: string | null; preview: ComponentProps<typeof CardPhotoUploader>["preview"] };
}) {
  return (
    <>
      <SectionTitle>Kart fotoğrafı</SectionTitle>
      <Card className="mb-6">
        <CardPhotoUploader userId={photo.userId} currentUrl={photo.url} preview={photo.preview} />
      </Card>

      <form action={updateProfile} className="space-y-4">
        <Card className="space-y-4">
          <ProfileFields values={values} full />
        </Card>
        <Button className="w-full">Kaydet</Button>
        <p className="text-center text-xs text-muted">
          Adın ve ana mevkin tüm gruplarında güncellenir. Maça özel mevkini maçı kuran kişi değiştirebilir.
        </p>
      </form>

      <SectionTitle>İstatistiklerini kim görsün?</SectionTitle>
      <form action={updateStatsVisibility} className="space-y-2">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="block cursor-pointer rounded-2xl border border-line bg-pitch-900/80 p-4 has-checked:border-accent has-checked:bg-accent/10"
          >
            <span className="flex items-start gap-3">
              <input type="radio" name="visibility" value={o.value} defaultChecked={visibility === o.value} className="mt-1 accent-[var(--color-accent)]" />
              <span>
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </span>
          </label>
        ))}
        <Button variant="secondary" className="w-full">
          Görünürlüğü kaydet
        </Button>
        <p className="text-center text-xs text-muted">Kartın (rating, yetenekler, bölge) her zaman herkese görünür; bu ayar sadece istatistik ve maç geçmişini etkiler.</p>
      </form>

      <SectionTitle>Oyuncu aramasında görün</SectionTitle>
      <form action={updateDiscoverable} className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-pitch-900/80 p-4 has-checked:border-accent has-checked:bg-accent/10">
          <input type="checkbox" name="discoverable" value="1" defaultChecked={discoverable} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
          <span>
            <span className="block font-semibold">Keşfet&apos;te oyuncu olarak listelen</span>
            <span className="block text-xs text-muted">
              Takım kaptanları seni bölge, mevki ve rating&apos;e göre bulabilir; ana sayfadaki &quot;öne çıkan oyuncular&quot;a girebilirsin. Kapatırsan listelenmezsin; kartın yine doğrudan bağlantıyla görünür.
            </span>
          </span>
        </label>
        <Button variant="secondary" className="w-full">
          Kaydet
        </Button>
      </form>

      <div id="bildirimler" className="scroll-mt-4">
        <SectionTitle>Bildirimler</SectionTitle>
        <PushSettings prefs={prefs} />
      </div>
    </>
  );
}

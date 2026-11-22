import { updateDiscoverable, updateProfile, updateStatsVisibility } from "@/lib/actions";
import { Button, Card, SectionTitle } from "@/components/ui";
import { ProfileFields, type ProfileValues } from "@/components/ProfileFields";
import { PushSettings } from "@/components/PushControls";
import { DEFAULT_PREFS } from "@/lib/notify-rules";
import type { StatsVisibility } from "@/lib/profile-data";
import { CardPhotoUploader } from "@/components/CardPhotoUploader";
import type { ComponentProps } from "react";
import { Avatar } from "@/components/Avatar";
import { formatRegion } from "@/lib/regions";
import { POSITION_NAME } from "@/lib/data";

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
  const pv = photo.preview;
  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-container p-3">
        <Avatar name={pv.name} photoUrl={photo.url} className="h-16 w-16 bg-surface-high text-lg text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-bold">{pv.cardName || pv.name}</div>
          <div className="truncate text-xs text-on-surface-variant">
            {[formatRegion(pv.city ?? null, pv.district ?? null), pv.position ? POSITION_NAME[pv.position] : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <a href="#profil-formu" className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-on-primary">
          Düzenle
        </a>
      </div>

      <SectionTitle>Kart fotoğrafı</SectionTitle>
      <Card className="mb-6">
        <CardPhotoUploader userId={photo.userId} currentUrl={photo.url} preview={photo.preview} />
      </Card>

      <form action={updateProfile} id="profil-formu" className="scroll-mt-4 space-y-4">
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

      <form action="/auth/signout" method="post" className="mt-10">
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-error-container font-display font-bold text-on-surface hover:brightness-110"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Çıkış yap
        </button>
      </form>
    </>
  );
}

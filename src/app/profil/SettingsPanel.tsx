import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { ConfirmButton, NotificationRows, StatsShareRow, AvailabilityDays } from "@/components/settings/Interactive";
import { SettingsLink, SettingsSection } from "@/components/settings/blocks";
import { FOOT_NAME, POSITION_LABEL, POSITION_NAME, type Foot, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { setAccountFrozen } from "@/lib/actions";
import type { Prefs } from "@/lib/notify-rules";
import Link from "next/link";

export interface SettingsData {
  name: string;
  cardName: string | null;
  photoUrl: string | null;
  city: string | null;
  district: string | null;
  position: Position | null;
  secondary: Position[];
  foot: Foot | null;
  shirt: number | null;
  heightCm: number | null;
  weightKg: number | null;
  birthDate: string | null;
  availableDays: number[];
  statsPublic: boolean;
  discoverable: boolean;
  frozen: boolean;
  overall: number;
  email: string | null;
  emailConfirmed: boolean;
  blockedCount: number;
}

const maskEmail = (e: string | null) => {
  if (!e) return "E-posta yok";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(2, u.length - 2))}@${d}`;
};

/** Ayarlar ekranı (tasarım: Tercihler & Yönetim). Satırlar alt ekranlara gider; anahtarlar anında kaydeder. */
export function SettingsPanel({ s, prefs }: { s: SettingsData; prefs: Prefs }) {
  const filled = [s.name, s.city, s.district, s.position, s.foot, s.shirt, s.heightCm, s.weightKg, s.birthDate, s.photoUrl].filter((x) => x !== null && x !== "").length;
  const pct = Math.round((filled / 10) * 100);
  const posText = s.position ? `${POSITION_NAME[s.position]} (${POSITION_LABEL[s.position]})` : null;
  const posCodes = [s.position, ...s.secondary].filter((x): x is Position => !!x).map((x) => POSITION_LABEL[x]).join(" / ");

  return (
    <div className="flex flex-col gap-3.5 pt-3">
      <div className="flex flex-col gap-3.5 pb-1">
        <div>
          <span className="t-label-caps uppercase tracking-wider text-primary">Tercihler &amp; Yönetim</span>
          <h2 className="t-headline-md font-bold tracking-tight text-on-surface">Ayarlar</h2>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-surface-high via-surface-container to-surface-low p-3.5 shadow-lg">
          <div className="pointer-events-none absolute -bottom-6 -right-6 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative z-10 flex items-center gap-3.5">
            <div className="relative shrink-0">
              <Avatar name={s.name} photoUrl={s.photoUrl} className="h-16 w-16 bg-surface-high text-lg text-primary shadow-md" />
              <div className="t-label-caps absolute -bottom-1 -right-1 rounded-full bg-primary px-1.5 py-0.5 font-black tracking-tighter text-on-primary shadow">{s.overall}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="t-headline-sm truncate font-bold text-on-surface">{s.cardName || s.name}</h3>
                {s.shirt && <span className="t-label-caps rounded-full bg-primary/15 px-2 py-0.5 font-bold text-primary">#{s.shirt}</span>}
              </div>
              <p className="t-body-sm mt-0.5 flex items-center gap-1.5 truncate text-on-surface-variant">
                {s.district || s.city ? <span>{formatRegion(s.city, s.district).split(", ")[0]}</span> : null}
                {(s.district || s.city) && posText && <span className="h-1 w-1 rounded-full bg-outline-variant" />}
                {posText && <span className="font-medium text-primary-fixed-dim">{posText}</span>}
              </p>
              {s.emailConfirmed && (
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <Icon name="verified" fill className="text-[14px]" /> Onaylı Oyuncu
                </span>
              )}
            </div>
            <Link href="/profil/ayarlar/kisisel" aria-label="Profili düzenle" className="t-label-sm flex h-10 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 font-bold text-on-primary shadow-md active:scale-95">
              <Icon name="edit" className="text-[18px]" />
              <span>Düzenle</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-5">
        <SettingsSection title="Hesap & Profil Bilgileri" right={`%${pct} Tamamlandı`}>
          <SettingsLink href="/profil/ayarlar/kisisel" icon="badge" tone="primary" title="Kişisel Bilgiler" subtitle="Ad Soyad, Doğum Tarihi, Şehir" value={s.city ? <span className="t-body-sm text-on-surface-variant">{s.city}</span> : undefined} />
          <SettingsLink
            href="/profil/ayarlar/futbolcu"
            icon="sports_soccer"
            tone="secondary"
            title="Futbolcu Profili & Tercihler"
            subtitle={[s.shirt ? `No: #${s.shirt}` : null, s.foot ? (s.foot === "B" ? "İki ayak" : `${FOOT_NAME[s.foot]} Ayak`) : null, posCodes || null].filter(Boolean).join(", ") || "Mevki, ayak, forma no, boy, kilo"}
            value={s.foot ? <span className="t-label-caps rounded-full bg-secondary-container px-2 py-0.5 font-bold text-on-secondary-container">{s.foot === "B" ? "İki ayak" : `${FOOT_NAME[s.foot]} Ayak`}</span> : undefined}
          />
          <SettingsLink
            href="/profil/ayarlar/iletisim"
            icon="contact_mail"
            tone="tertiary"
            title="İletişim & Doğrulama"
            subtitle={maskEmail(s.email)}
            value={
              s.emailConfirmed ? (
                <span className="t-label-sm inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                  <Icon name="check_circle" fill className="text-[14px]" /> Onaylı
                </span>
              ) : (
                <span className="t-label-sm rounded-full bg-error/10 px-2 py-0.5 font-semibold text-error">Onaysız</span>
              )
            }
          />
          <SettingsLink href="/profil/ayarlar/guvenlik" icon="lock_reset" tone="outline" title="Şifre & Hesap Güvenliği" subtitle="Şifreni değiştir" />
        </SettingsSection>

        <SettingsSection title="Bildirimler & Maç Çağrıları">
          <NotificationRows prefs={prefs} />
        </SettingsSection>

        <SettingsSection title="Müsaitlik Takvimi">
          <AvailabilityDays initial={s.availableDays} />
        </SettingsSection>

        <SettingsSection title="Uygulama & Deneyim">
          <div className="flex flex-col gap-2 bg-surface-container p-3.5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-high text-primary">
                <Icon name="palette" className="text-[22px]" />
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold text-on-surface">Görünüm Teması</span>
                <span className="t-body-sm text-on-surface-variant">Varsayılan stadyum atmosferi</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="flex items-center justify-between rounded-lg bg-surface-high p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-on-primary" />
                  </span>
                  <span className="t-label-sm font-bold text-on-surface">Koyu Saha (Pitch)</span>
                </div>
                <Icon name="check" className="text-[18px] text-primary" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-surface-low p-2.5 opacity-60" aria-disabled>
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full bg-surface-variant" />
                  <span className="t-label-sm text-on-surface-variant">Klasik Gece</span>
                </div>
                <span className="text-[10px] text-on-surface-variant">yakında</span>
              </div>
            </div>
          </div>
          <SettingsLink icon="translate" tone="outline" title="Uygulama Dili" subtitle="Arayüz ve hakem düdük anonsları" value={<span className="t-body-sm font-medium text-on-surface-variant">Türkçe (TR)</span>} chevron={false} />
        </SettingsSection>

        <SettingsSection title="Gizlilik & Görünürlük">
          <SettingsLink
            href="/profil/ayarlar/gorunurluk"
            icon="visibility"
            tone="primary"
            title="Profil Görünürlüğü"
            subtitle="Keşfet vitrininde diğer kaptanlara göster"
            value={<span className="t-body-sm font-semibold text-primary">{s.discoverable ? "Herkese Açık" : "Gizli"}</span>}
          />
          <StatsShareRow initial={s.statsPublic} />
          <SettingsLink href="/profil/ayarlar/engellenenler" icon="block" tone="outline" title="Engellenen Oyuncular & Takımlar" subtitle={`${s.blockedCount} kayıt engellendi`} />
        </SettingsSection>

        <SettingsSection title="Destek & Bilgi">
          <SettingsLink href="/yardim" icon="help" tone="tertiary" title="Yardım Merkezi & SSS" subtitle="Puanlama, kadro ve hesap soruları" />
          <SettingsLink href="/geri-bildirim" icon="rate_review" tone="primary" title="Geri Bildirim Gönder" subtitle="Halısaha Pro deneyimini birlikte geliştirelim" />
          <SettingsLink href="/privacy" icon="policy" tone="outline" title="Kullanım Koşulları & Gizlilik Politikası" subtitle="KVKK ve veri saklama beyanı" />
        </SettingsSection>

        <div className="flex flex-col gap-2 pt-1">
          <form action={setAccountFrozen}>
            <input type="hidden" name="freeze" value={s.frozen ? "0" : "1"} />
            <ConfirmButton
              message={s.frozen ? "Hesabın yeniden açılsın mı?" : "Hesabın geçici dondurulsun mu? Oyuncu aramasında görünmezsin ve bildirim almazsın; istediğin an yeniden açabilirsin."}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-surface-high font-display text-base font-semibold text-on-surface transition-colors hover:bg-surface-bright active:scale-[0.99]"
            >
              <Icon name={s.frozen ? "play_circle" : "pause_circle"} className="text-[20px] text-on-surface-variant" />
              <span>{s.frozen ? "Hesabımı Yeniden Aç" : "Hesabımı Geçici Dondur"}</span>
            </ConfirmButton>
          </form>
          {s.frozen && <p className="t-body-sm text-center text-on-surface-variant">Hesabın dondurulmuş: aramada görünmüyorsun ve bildirim almıyorsun.</p>}
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-error-container font-display text-base font-bold text-on-error-container shadow-sm transition-opacity hover:opacity-95 active:scale-[0.99]">
              <Icon name="logout" fill className="text-[20px]" />
              <span>Çıkış Yap</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

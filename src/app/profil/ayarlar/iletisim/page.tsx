import { requireUser } from "@/lib/supabase/server";
import { SubScreen } from "@/components/settings/SubScreen";
import { SettingsLink, SettingsSection } from "@/components/settings/blocks";
import { Icon } from "@/components/Icon";

export default async function ContactPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  const confirmed = !!u?.email_confirmed_at;
  const google = u?.app_metadata?.provider === "google";

  return (
    <SubScreen title="İletişim & Doğrulama">
      <SettingsSection title="Hesap e-postası">
        <SettingsLink
          icon="mail"
          tone="tertiary"
          title={u?.email ?? "E-posta yok"}
          subtitle={google ? "Google hesabınla giriş yapıyorsun" : "Giriş yaptığın e-posta adresi"}
          chevron={false}
          value={
            confirmed ? (
              <span className="t-label-sm inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                <Icon name="check_circle" fill className="text-[14px]" /> Onaylı
              </span>
            ) : (
              <span className="t-label-sm rounded-full bg-error/10 px-2 py-0.5 font-semibold text-error">Onaysız</span>
            )
          }
        />
      </SettingsSection>
      <p className="t-body-sm px-1 text-on-surface-variant">
        Bildirimler ve hesap işlemleri bu e-posta üzerinden yürür. Telefon numarası doğrulaması şimdilik yok; e-posta doğrulaması &quot;Onaylı Oyuncu&quot; rozetini verir.
      </p>
    </SubScreen>
  );
}

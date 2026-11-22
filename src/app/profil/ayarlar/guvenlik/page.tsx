import { requireUser } from "@/lib/supabase/server";
import { SubScreen } from "@/components/settings/SubScreen";
import { SettingsLink, SettingsSection } from "@/components/settings/blocks";

export default async function SecurityPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase.auth.getUser();
  const last = data.user?.last_sign_in_at ? new Date(data.user.last_sign_in_at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }) : null;
  return (
    <SubScreen title="Şifre & Hesap Güvenliği">
      <SettingsSection title="Giriş">
        <SettingsLink href="/sifre-yenile" icon="lock_reset" tone="primary" title="Şifreni değiştir" subtitle="Yeni şifre belirle (en az 8 karakter)" />
        <SettingsLink icon="schedule" tone="outline" title="Son giriş" subtitle={last ?? "Bilinmiyor"} chevron={false} />
      </SettingsSection>
      <p className="t-body-sm px-1 text-on-surface-variant">Google ile giriş yapıyorsan şifre belirlemen gerekmez; yine de buradan bir şifre ekleyebilirsin.</p>
    </SubScreen>
  );
}

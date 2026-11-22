import { requireUser } from "@/lib/supabase/server";
import { updateDiscoverable } from "@/lib/actions";
import { SubScreen } from "@/components/settings/SubScreen";
import { primaryButton } from "@/components/settings/blocks";

export default async function VisibilityPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: p } = await supabase.from("profiles").select("discoverable").eq("id", user.id).single();
  return (
    <SubScreen title="Profil Görünürlüğü" error={error} saved={saved}>
      <form action={updateDiscoverable} className="flex flex-col gap-3.5">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-container p-3.5 shadow-sm has-checked:ring-1 has-checked:ring-primary">
          <input type="checkbox" name="discoverable" value="1" defaultChecked={p?.discoverable !== false} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" />
          <span>
            <span className="block font-semibold text-on-surface">Keşfet&apos;te oyuncu olarak listelen</span>
            <span className="t-body-sm block text-on-surface-variant">
              Takım kaptanları seni bölge, mevki ve rating&apos;e göre bulabilir; ana sayfadaki &quot;öne çıkan oyuncular&quot;a girebilirsin. Kapatırsan listelenmezsin; kartın yine doğrudan bağlantıyla görünür.
            </span>
          </span>
        </label>
        <button className={primaryButton}>Kaydet</button>
      </form>
    </SubScreen>
  );
}

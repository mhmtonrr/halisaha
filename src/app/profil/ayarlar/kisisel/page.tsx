import { requireUser } from "@/lib/supabase/server";
import { updatePersonal } from "@/lib/actions";
import { SubScreen } from "@/components/settings/SubScreen";
import { primaryButton } from "@/components/settings/blocks";
import { RegionSelect } from "@/components/RegionSelect";
import { Input, Label } from "@/components/ui";

export default async function PersonalPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const { supabase, user } = await requireUser();
  const [{ data: p }, { data: priv }] = await Promise.all([
    supabase.from("profiles").select("display_name, card_name, city, district").eq("id", user.id).single(),
    supabase.from("profile_private").select("birth_date").eq("user_id", user.id).maybeSingle(),
  ]);
  const maxBirth = `${new Date().getFullYear() - 8}-12-31`;

  return (
    <SubScreen title="Kişisel Bilgiler" error={error} saved={saved}>
      <form action={updatePersonal} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-sm">
          <label className="block">
            <Label>Ad soyad</Label>
            <Input name="name" defaultValue={p?.display_name ?? ""} required minLength={2} maxLength={40} autoComplete="name" />
          </label>
          <label className="block">
            <Label hint="isteğe bağlı">Kartta görünen ad</Label>
            <Input
              name="cardName"
              defaultValue={p?.card_name ?? ""}
              minLength={2}
              maxLength={20}
              pattern="[A-Za-zÀ-ÖØ-öø-ɏ .]+"
              title="Sadece harf, boşluk ve nokta (2-20 karakter)"
              placeholder="Örn. Memo veya Mehmet O."
            />
            <p className="mt-1 text-xs text-on-surface-variant">Boş bırakırsan kartında adın görünür. Sadece harf, boşluk ve nokta.</p>
          </label>
          <RegionSelect defaultCity={p?.city} defaultDistrict={p?.district} />
          <label className="block">
            <Label hint="sadece sen görürsün">Doğum tarihi</Label>
            <Input type="date" name="birthDate" min="1940-01-01" max={maxBirth} defaultValue={(priv as { birth_date: string | null } | null)?.birth_date ?? ""} />
            <p className="mt-1 text-xs text-on-surface-variant">Doğum tarihin başkalarına gösterilmez; sadece yaş hesabı için kullanılır.</p>
          </label>
        </div>
        <button className={primaryButton}>Kaydet</button>
      </form>
    </SubScreen>
  );
}

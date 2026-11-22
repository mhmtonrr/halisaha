import type { ReactNode } from "react";
import { ProfileSubBar, ProfileTopBar } from "@/components/profile/ProfileBars";
import { requireUser } from "@/lib/supabase/server";
import { ErrorNote } from "@/components/ui";

/** Ayarlar alt ekranı iskeleti: geri oku (Ayarlar'a), başlık, kaydedildi/hata bildirimi */
export async function SubScreen({ title, subtitle = "AYARLAR", error, saved, children }: { title: string; subtitle?: string; error?: string; saved?: string; children: ReactNode }) {
  const { supabase, user } = await requireUser();
  const { data: me } = await supabase.from("profiles").select("display_name, photo_url").eq("id", user.id).single();
  return (
    <main>
      <ProfileTopBar name={me?.display_name ?? ""} photoUrl={me?.photo_url ?? null} />
      <ProfileSubBar title={title} subtitle={subtitle} back="/profil?sekme=ayarlar" />
      <div className="flex flex-col gap-3.5 pt-2">
        <ErrorNote message={error} />
        {saved && <p className="rounded-xl bg-primary/10 p-3 text-center text-sm text-primary">Kaydedildi ✓</p>}
        {children}
      </div>
    </main>
  );
}

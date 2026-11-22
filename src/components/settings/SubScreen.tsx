import type { ReactNode } from "react";
import { ProfileSubBar } from "@/components/profile/ProfileBars";
import { ErrorNote } from "@/components/ui";

/** Ayarlar alt ekranı iskeleti: geri oku (Ayarlar'a), başlık, kaydedildi/hata bildirimi */
export function SubScreen({ title, subtitle = "AYARLAR", error, saved, children }: { title: string; subtitle?: string; error?: string; saved?: string; children: ReactNode }) {
  return (
    <main>
      <ProfileSubBar title={title} subtitle={subtitle} back="/profil?sekme=ayarlar" />
      <div className="flex flex-col gap-3.5 pt-2">
        <ErrorNote message={error} />
        {saved && <p className="rounded-xl bg-primary/10 p-3 text-center text-sm text-primary">Kaydedildi ✓</p>}
        {children}
      </div>
    </main>
  );
}

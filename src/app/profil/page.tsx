import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfileForViewer } from "@/lib/profile-data";
import { DEFAULT_PREFS } from "@/lib/notify-rules";
import { ErrorNote } from "@/components/ui";
import { ProfileSubBar } from "@/components/profile/ProfileBars";
import { ProfileView, parseTab } from "@/components/profile/ProfileView";
import { SettingsPanel } from "./SettingsPanel";
import type { Position } from "@/lib/data";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; sekme?: string }>;
}) {
  const { error, saved, sekme } = await searchParams;
  const { supabase, user } = await requireUser();
  const tab = parseTab(sekme, true);

  const [data, { data: form }, { data: prefsRow }, { data: priv }, { count: blockedCount }, authRes] = await Promise.all([
    loadProfileForViewer(createAdminClient(), user.id, user.id),
    // Ayarlar için kendi satırı (boy/kilo, müsait günler, dondurma dahil)
    tab === "ayarlar"
      ? supabase
          .from("profiles")
          .select("city, district, secondary_positions, preferred_foot, shirt_number, height_cm, weight_kg, available_days, frozen_at")
          .eq("id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    tab === "ayarlar"
      ? supabase.from("notification_prefs").select("votes, matches, offers, chat").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    tab === "ayarlar" ? supabase.from("profile_private").select("birth_date").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    tab === "ayarlar" ? supabase.from("user_blocks").select("id", { count: "exact", head: true }) : Promise.resolve({ count: 0 }),
    // E-posta onayı JWT'de yok; sadece Ayarlar'da Auth'tan sorulur
    tab === "ayarlar" ? supabase.auth.getUser() : Promise.resolve(null),
  ]);
  if (!data) throw new Error("Profil bulunamadı");

  return (
    <main>
      <ProfileSubBar title="Profilim" subtitle={`SEZON ${new Date().getFullYear()} • PRO KART`} />
      <ErrorNote message={error} />
      {saved && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Kaydedildi ✓</p>}
      <ProfileView
        base="/profil"
        tab={tab}
        person={data.person}
        isMe
        stats={data.stats}
        matches={data.matches}
        noShows={data.noShows}
        viewerGroups={data.viewerGroups}
        upcoming={data.upcoming}
        settings={
          form && (
            <SettingsPanel
              prefs={{ ...DEFAULT_PREFS, ...(prefsRow ?? {}) }}
              s={{
                name: data.person.profile.displayName,
                cardName: data.person.profile.cardName,
                photoUrl: data.person.profile.photoUrl,
                city: form.city,
                district: form.district,
                position: data.person.profile.position,
                secondary: (form.secondary_positions ?? []) as Position[],
                foot: data.person.profile.foot,
                shirt: form.shirt_number,
                heightCm: form.height_cm,
                weightKg: form.weight_kg,
                birthDate: (priv as { birth_date: string | null } | null)?.birth_date ?? null,
                availableDays: (form.available_days ?? []) as number[],
                statsPublic: data.person.profile.statsVisibility === "public",
                discoverable: data.person.profile.discoverable,
                frozen: !!form.frozen_at,
                overall: data.person.overall,
                email: user.email ?? null,
                emailConfirmed: !!authRes?.data.user?.email_confirmed_at,
                blockedCount: blockedCount ?? 0,
              }}
            />
          )
        }
      />
    </main>
  );
}

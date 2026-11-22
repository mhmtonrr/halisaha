import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfileForViewer } from "@/lib/profile-data";
import { DEFAULT_PREFS } from "@/lib/notify-rules";
import { ErrorNote, Header } from "@/components/ui";
import type { ProfileValues } from "@/components/ProfileFields";
import { ProfileView, parseTab } from "@/components/profile/ProfileView";
import { SettingsPanel } from "./SettingsPanel";
import { cardSkills } from "@/lib/skills";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; sekme?: string }>;
}) {
  const { error, saved, sekme } = await searchParams;
  const { supabase, user } = await requireUser();
  const tab = parseTab(sekme, true);

  const [data, { data: form }, { data: prefsRow }] = await Promise.all([
    loadProfileForViewer(createAdminClient(), user.id, user.id),
    // Form değerleri (doğum yılı dahil) kendi satırından
    tab === "ayarlar"
      ? supabase
          .from("profiles")
          .select("display_name, card_name, photo_url, city, district, birth_year, preferred_position, secondary_positions, preferred_foot, shirt_number, bio")
          .eq("id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    tab === "ayarlar"
      ? supabase.from("notification_prefs").select("votes, matches, offers, chat").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!data) throw new Error("Profil bulunamadı");

  return (
    <main>
      <Header title="Profilim" back="/" />
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
              values={form as ProfileValues}
              visibility={data.person.profile.statsVisibility}
              discoverable={data.person.profile.discoverable}
              prefs={{ ...DEFAULT_PREFS, ...(prefsRow ?? {}) }}
              photo={{
                userId: user.id,
                url: (form as { photo_url: string | null }).photo_url,
                preview: {
                  name: data.person.profile.displayName,
                  cardName: data.person.profile.cardName,
                  overall: data.person.overall,
                  position: data.person.profile.position,
                  skills: cardSkills(data.person.skills, data.person.profile.position === "GK"),
                  city: data.person.profile.city,
                  district: data.person.profile.district,
                  unrated: data.person.matchesPlayed === 0,
                },
              }}
            />
          )
        }
      />
    </main>
  );
}

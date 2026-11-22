import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfileForViewer } from "@/lib/profile-data";
import { ProfileSubBar, ProfileTopBar } from "@/components/profile/ProfileBars";
import { blockUser } from "@/lib/actions";
import { ProfileView, parseTab } from "@/components/profile/ProfileView";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Başkasının profili: kart herkese açık; istatistik ve maç geçmişi kişinin görünürlük ayarına bağlı */
export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ sekme?: string }>;
}) {
  const { userId } = await params;
  const { sekme } = await searchParams;
  const { user } = await requireUser();
  if (!UUID.test(userId)) notFound();
  if (userId === user.id) redirect(sekme ? `/profil?sekme=${encodeURIComponent(sekme)}` : "/profil");

  const data = await loadProfileForViewer(createAdminClient(), user.id, userId);
  if (!data) notFound();

  return (
    <main>
      <ProfileTopBar name={data.person.profile.displayName} photoUrl={data.person.profile.photoUrl} showAvatar={false} />
      <ProfileSubBar title={data.person.profile.displayName} subtitle="OYUNCU KARTI" />
      <ProfileView
        base={`/oyuncu/${userId}`}
        tab={parseTab(sekme, false)}
        person={data.person}
        isMe={false}
        stats={data.stats}
        matches={data.matches}
        noShows={data.noShows}
        viewerGroups={data.viewerGroups}
      />
      <form action={blockUser} className="mt-8 text-center">
        <input type="hidden" name="userId" value={userId} />
        <button className="text-xs text-on-surface-variant underline">Bu oyuncuyu engelle</button>
      </form>
    </main>
  );
}

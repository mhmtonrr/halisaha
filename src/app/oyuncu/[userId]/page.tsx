import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProfileForViewer } from "@/lib/profile-data";
import { ProfileSubBar } from "@/components/profile/ProfileBars";
import { blockUser, inviteToGroup, openDm } from "@/lib/actions";
import { getMemberships } from "@/lib/teams-data";
import { ProfileView, parseTab } from "@/components/profile/ProfileView";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Başkasının profili: kart herkese açık; istatistik ve maç geçmişi kişinin görünürlük ayarına bağlı */
export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ sekme?: string; error?: string; davet?: string }>;
}) {
  const { userId } = await params;
  const { sekme, error, davet } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!UUID.test(userId)) notFound();
  if (userId === user.id) redirect(sekme ? `/profil?sekme=${encodeURIComponent(sekme)}` : "/profil");

  const data = await loadProfileForViewer(createAdminClient(), user.id, userId);
  if (!data) notFound();

  // Davet edebileceğim takım/gruplar: kaptanı/yetkilisi olduklarım; kişi zaten üye veya bekleyen davet varsa çıkar
  const admin = createAdminClient();
  const mine = (await getMemberships(supabase, user.id)).filter((m) => m.role === "captain" || m.role === "admin");
  let invitable: { id: string; name: string; kind: string }[] = [];
  if (mine.length) {
    const ids = mine.map((m) => m.group.id);
    const [{ data: already }, { data: pending }] = await Promise.all([
      admin.from("group_players").select("group_id").eq("user_id", userId).eq("is_loan", false).is("left_at", null).in("group_id", ids),
      supabase.from("group_invites").select("group_id").eq("invitee_id", userId).eq("status", "pending").in("group_id", ids),
    ]);
    const skip = new Set([...(already ?? []), ...(pending ?? [])].map((r) => r.group_id as string));
    invitable = mine.filter((m) => !skip.has(m.group.id)).map((m) => ({ id: m.group.id, name: m.group.name, kind: m.group.kind }));
  }

  return (
    <main>
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
      {davet && <p className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-3 text-center text-sm">✅ Davet gönderildi. Yanıtı sohbette görürsün.</p>}
      {error && <p className="mt-4 rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-center text-sm text-red-200">{error}</p>}
      <form action={openDm} className="mt-4">
        <input type="hidden" name="userId" value={userId} />
        <button className="w-full rounded-xl bg-accent py-3 font-bold text-pitch-950">✉️ Mesaj gönder</button>
      </form>
      {invitable.length > 0 && (
        <form action={inviteToGroup} className="mt-3 space-y-2 rounded-xl border border-line bg-pitch-900 p-3">
          <input type="hidden" name="userId" value={userId} />
          <label className="block text-sm font-bold" htmlFor="invite-group">
            🛡️ Takıma / gruba davet et
          </label>
          <select id="invite-group" name="groupId" className="w-full rounded-lg border border-line bg-pitch-950 px-3 py-2.5">
            {invitable.map((g) => (
              <option key={g.id} value={g.id}>
                {g.kind === "team" ? "Takım" : "Grup"} · {g.name}
              </option>
            ))}
          </select>
          <button className="w-full rounded-xl bg-pitch-800 py-2.5 font-bold hover:bg-pitch-700">Davet gönder</button>
        </form>
      )}
      <form action={blockUser} className="mt-8 text-center">
        <input type="hidden" name="userId" value={userId} />
        <button className="text-xs text-on-surface-variant underline">Bu oyuncuyu engelle</button>
      </form>
    </main>
  );
}

import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getGroupSummaries, isGuestLike, isSquadMember } from "@/lib/data";
import { Header } from "@/components/ui";
import { SquadGrid } from "./SquadGrid";
import { RosterTabs } from "@/components/RosterTabs";

export default async function SquadPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ sekme?: string }>;
}) {
  const { groupId } = await params;
  const { sekme } = await searchParams;
  const { supabase } = await requireUser();
  const { data: group } = await supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle();
  if (!group) notFound();

  const all = await getGroupSummaries(supabase, groupId);
  const memberCount = all.filter(isSquadMember).length;
  const guestCount = all.length - memberCount;
  const tab = sekme === "misafir" && guestCount > 0 ? "misafir" : "kadro";
  // Asıl kadro ile misafirler ayrı sekmelerde
  const players = all.filter((p) => (tab === "misafir" ? isGuestLike(p) : isSquadMember(p)));

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "group_players", filter: `group_id=eq.${groupId}` },
          { table: "matches", filter: `group_id=eq.${groupId}` },
        ]}
      />
      <Header title="Kadro" back={`/g/${groupId}`} />
      <RosterTabs base={`/g/${groupId}/kadro`} active={tab} members={memberCount} guests={guestCount} memberLabel="Kadro" />
      <SquadGrid
        groupId={groupId}
        players={players.map((p) => ({
          id: p.id,
          name: p.display_name,
          overall: p.overall,
          position: p.position,
          secondary: p.secondary_positions,
          shirt: p.shirt_number,
          provisional: p.matches_played > 0 && p.confidence < 0.6,
          hasMatches: p.matches_played > 0,
          guest: isGuestLike(p),
          loan: p.is_loan,
          form: p.form,
          goals: p.totals.goals,
          played: p.totals.played,
          attributes: p.attributes.map((a) => ({ key: a.key, value: a.value })),
        }))}
      />
    </main>
  );
}

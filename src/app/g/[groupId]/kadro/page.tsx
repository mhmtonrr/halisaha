import { LiveRefresh } from "@/components/LiveRefresh";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getGroupSummaries } from "@/lib/data";
import { Header } from "@/components/ui";
import { SquadGrid } from "./SquadGrid";

export default async function SquadPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase } = await requireUser();
  const { data: group } = await supabase.from("groups").select("id, name").eq("id", groupId).maybeSingle();
  if (!group) notFound();

  const players = await getGroupSummaries(supabase, groupId);

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "group_players", filter: `group_id=eq.${groupId}` },
          { table: "matches", filter: `group_id=eq.${groupId}` },
        ]}
      />
      <Header title="Kadro" back={`/g/${groupId}`} />
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
          guest: !p.user_id,
          form: p.form,
          goals: p.totals.goals,
          played: p.totals.played,
          attributes: p.attributes.map((a) => ({ key: a.key, value: a.value })),
        }))}
      />
    </main>
  );
}

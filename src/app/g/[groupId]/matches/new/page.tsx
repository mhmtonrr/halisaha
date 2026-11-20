import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getGroupPlayers } from "@/lib/data";
import { ErrorNote, Header } from "@/components/ui";
import { NewMatchForm } from "./NewMatchForm";

/** Bugün (veya geçtiyse yarın) 21:00, Türkiye saati, datetime-local biçiminde */
function defaultKickoff() {
  const nowTr = new Date(Date.now() + 3 * 3600 * 1000);
  const d = new Date(Date.UTC(nowTr.getUTCFullYear(), nowTr.getUTCMonth(), nowTr.getUTCDate(), 21));
  if (nowTr.getUTCHours() >= 21) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 16);
}

export default async function NewMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { groupId } = await params;
  const { error } = await searchParams;
  const { supabase } = await requireUser();
  const { data: group } = await supabase.from("groups").select("id").eq("id", groupId).maybeSingle();
  if (!group) notFound();

  const players = (await getGroupPlayers(supabase, groupId)).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "tr"),
  );

  return (
    <main>
      <Header title="Yeni maç" back={`/g/${groupId}`} />
      <ErrorNote message={error} />
      <NewMatchForm
        groupId={groupId}
        defaultWhen={defaultKickoff()}
        players={players.map((p) => ({
          id: p.id,
          name: p.display_name,
          overall: p.overall,
          isGoalkeeper: p.position === "GK",
          position: p.position,
          guest: !p.user_id,
        }))}
      />
    </main>
  );
}

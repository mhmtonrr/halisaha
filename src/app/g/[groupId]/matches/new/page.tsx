import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { defaultKickoff, getGroupPlayers } from "@/lib/data";
import { ErrorNote, Header } from "@/components/ui";
import { NewMatchForm } from "./NewMatchForm";

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
  const [{ data: group }, { data: canCreate }] = await Promise.all([
    supabase.from("groups").select("id, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("can_create_match", { p_group_id: groupId }),
  ]);
  if (!group) notFound();
  // Maçı sadece kaptan/kurucu, yetkililer ve organizatörler kurar (veritabanı da bunu zorunlu kılar)
  if (!canCreate) redirect(`/g/${groupId}?error=${encodeURIComponent("Maçı sadece kurucu, yetkili ve organizatörler kurabilir")}`);

  const players = (await getGroupPlayers(supabase, groupId)).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "tr"),
  );

  return (
    <main>
      <Header title="Yeni maç" back={`/g/${groupId}`} />
      <ErrorNote message={error} />
      <NewMatchForm
        groupId={groupId}
        defaultKind={group.kind === "team" ? "external" : "internal"}
        defaultWhen={defaultKickoff()}
        players={players.map((p) => ({
          id: p.id,
          name: p.display_name,
          overall: p.overall,
          isGoalkeeper: p.position === "GK",
          position: p.position,
          guest: !p.user_id || p.is_loan,
        }))}
      />
    </main>
  );
}

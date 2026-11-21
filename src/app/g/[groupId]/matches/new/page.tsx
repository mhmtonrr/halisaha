import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { defaultKickoff, getGroupPlayers, toLocalInput } from "@/lib/data";
import { ErrorNote, Header } from "@/components/ui";
import { NewMatchForm } from "./NewMatchForm";

export default async function NewMatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string; cagri?: string }>;
}) {
  const { groupId } = await params;
  const { error, cagri } = await searchParams;
  const { supabase } = await requireUser();
  const [{ data: group }, { data: canCreate }] = await Promise.all([
    supabase.from("groups").select("id, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
  ]);
  if (!group) notFound();
  // Maçı sadece kaptan/kurucu ve yetkililer kurar (veritabanı da bunu zorunlu kılar)
  if (!canCreate) redirect(`/g/${groupId}?error=${encodeURIComponent("Maçı sadece yetkililer kurabilir")}`);

  // Maç çağrısından geliniyorsa: tarih, saha ve onaylanan oyuncular hazır gelsin
  const poll = cagri
    ? (
        await supabase
          .from("match_polls")
          .select("id, starts_at, venue, poll_responses(player_id, approved)")
          .eq("id", cagri)
          .eq("group_id", groupId)
          .maybeSingle()
      ).data
    : null;
  const preselected = (poll?.poll_responses ?? []).filter((r) => r.approved).map((r) => r.player_id);

  const players = (await getGroupPlayers(supabase, groupId)).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "tr"),
  );

  return (
    <main>
      <Header title="Yeni maç" back={poll ? `/g/${groupId}/cagri/${poll.id}` : `/g/${groupId}`} />
      {poll && (
        <p className="mb-4 rounded-xl bg-accent/10 p-3 text-sm text-accent">
          Maç çağrısından onaylanan {preselected.length} oyuncu seçili geldi. Kadroyu değiştirebilirsin; misafir oyuncuyu maç oluşunca maç ekranından ekleyebilirsin.
        </p>
      )}
      <ErrorNote message={error} />
      <NewMatchForm
        groupId={groupId}
        defaultKind={group.kind === "team" ? "external" : "internal"}
        defaultWhen={poll ? toLocalInput(poll.starts_at) : defaultKickoff()}
        preselected={preselected}
        pollId={poll?.id}
        defaultVenue={poll?.venue ?? undefined}
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

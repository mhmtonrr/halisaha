import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getGroupPlayers, one } from "@/lib/data";
import { istanbulDate } from "@/lib/call-rules";
import { MatchSetupForm } from "./MatchSetupForm";

type G = { id: string; name: string; kind: "team" | "community"; archived_at: string | null };
interface ManagedRow {
  role: string;
  groups: G | G[] | null;
}

/** "Maç ayarla" sihirbazı: takım/grup sayfadan gelir (?grup=, yoksa ana sayfaya), maç toplanmaya açılır veya kadro tamsa direkt kurulur */
export default async function MatchSetupPage({ searchParams }: { searchParams: Promise<{ grup?: string; rakip?: string; error?: string }> }) {
  const { grup, rakip, error } = await searchParams;
  const { supabase, user } = await requireUser();

  // Maç açabildiğim yerler: kaptan/kurucu, yetkili, organizatör (can_create_match ile aynı)
  const { data: rows } = await supabase
    .from("group_players")
    .select("role, groups(id, name, kind, archived_at)")
    .eq("user_id", user.id)
    .is("left_at", null)
    .eq("is_loan", false)
    .in("role", ["captain", "admin", "organizer"]);
  const managed = ((rows ?? []) as ManagedRow[])
    .map((r) => ({ role: r.role, group: one(r.groups) }))
    .filter((r): r is { role: string; group: G } => !!r.group && !r.group.archived_at)
    .sort((a, b) => a.group.name.localeCompare(b.group.name, "tr"));
  if (!managed.length) redirect(`/?error=${encodeURIComponent("Maç ayarlamak için bir takımda veya grupta kaptan, yetkili ya da organizatör olmalısın")}`);

  // Sayfa hep bir takım/grup için açılır (?grup=); yoksa veya yetkim yoksa ana sayfaya
  if (!grup) redirect("/");
  const current = managed.find((m) => m.group.id === grup);
  if (!current) redirect(`/?error=${encodeURIComponent("Bu takımda veya grupta maç ayarlama yetkin yok")}`);
  const group = current.group;
  const isAdmin = current.role === "captain" || current.role === "admin";

  const [players, rival, home, friendRows] = await Promise.all([
    getGroupPlayers(supabase, group.id),
    rakip && group.kind === "team"
      ? supabase.from("groups").select("id, name, kind").eq("id", rakip).eq("kind", "team").maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    supabase.from("groups").select("city").eq("id", group.id).maybeSingle().then((r) => r.data),
    supabase.from("friendships").select("user_a, user_b").eq("status", "accepted").limit(300).then((r) => r.data ?? []),
  ]);
  // Kendim en üstte, sonra ada göre
  const members = players
    .filter((p) => p.user_id && !p.is_loan)
    .map((p) => ({ userId: p.user_id as string, name: p.display_name, overall: p.overall, position: p.position }))
    .sort((a, b) => Number(b.userId === user.id) - Number(a.userId === user.id) || a.name.localeCompare(b.name, "tr"));
  // Takım dışından kadroya sadece arkadaşlar eklenir (create_match_v2 ile aynı kural)
  const memberIds = new Set(members.map((m) => m.userId));
  const friendIds = friendRows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a) as string).filter((id) => !memberIds.has(id));
  const { data: friendProfiles } = friendIds.length
    ? await supabase.from("profiles").select("id, display_name, photo_url").in("id", friendIds)
    : { data: [] };
  const friends = (friendProfiles ?? [])
    .map((p) => ({ userId: p.id as string, name: p.display_name as string, photoUrl: p.photo_url as string | null }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  return (
    <main>
      <MatchSetupForm
        key={group.id}
        group={{ id: group.id, name: group.name, kind: group.kind }}
        meId={user.id}
        isAdmin={isAdmin}
        members={members}
        friends={friends}
        homeCity={home?.city ?? ""}
        error={error}
        today={istanbulDate()}
        rival={rival && rival.id !== group.id ? { id: rival.id, name: rival.name } : null}
      />
    </main>
  );
}

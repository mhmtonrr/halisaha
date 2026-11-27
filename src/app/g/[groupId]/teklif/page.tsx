import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getMemberships } from "@/lib/teams-data";
import { TeamBadge } from "@/components/TeamBadge";
import { Icon } from "@/components/Icon";
import { Card, Header, LinkButton } from "@/components/ui";

/**
 * "Meydan oku / Maç teklif et" (bu sayfadaki takıma): teklif "Maç ayarla" sihirbazından gider.
 * Tek takımım varsa doğrudan yönlenir, birden fazlaysa hangisiyle oynanacağı sorulur.
 */
export default async function ChallengePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase, user } = await requireUser();

  const [{ data: target }, memberships] = await Promise.all([
    supabase.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle(),
    getMemberships(supabase, user.id),
  ]);
  if (!target || target.kind !== "team") notFound();

  // Teklifi sadece kaptan/yetkili olduğumuz takımlardan gönderebiliriz
  const mine = memberships.filter(
    (m) => m.group.kind === "team" && ["captain", "admin"].includes(m.role) && m.group.id !== groupId && !m.group.archived,
  );
  const setupHref = (from: string) => `/mac-ayarla?grup=${from}&rakip=${groupId}`;
  if (mine.length === 1) redirect(setupHref(mine[0].group.id));

  return (
    <main>
      <Header title="Maç teklif et" back={`/g/${groupId}`} />
      {mine.length === 0 ? (
        <Card className="space-y-3 text-center text-sm text-muted">
          <p>Teklif göndermek için bir takımın kaptanı veya yetkilisi olmalısın.</p>
          <LinkButton href="/takim-kur" variant="secondary" className="w-full">
            Takım kur
          </LinkButton>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">{target.name} ile hangi takımın oynayacak?</p>
          {mine.map((m) => (
            <LinkButton key={m.group.id} href={setupHref(m.group.id)} variant="secondary" className="w-full justify-start">
              <TeamBadge id={m.group.id} name={m.group.name} color={m.group.color} logo={m.group.logo} size="sm" />
              <span className="min-w-0 flex-1 truncate text-left">{m.group.name}</span>
              <Icon name="chevron_right" className="text-[20px]" />
            </LinkButton>
          ))}
        </div>
      )}
    </main>
  );
}

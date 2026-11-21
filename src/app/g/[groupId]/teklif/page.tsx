import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createChallenge } from "@/lib/actions";
import { defaultKickoff } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { getMemberships } from "@/lib/teams-data";
import { TeamBadge } from "@/components/TeamBadge";
import { OvrBadge } from "@/components/PlayerCard";
import { TeamSizeSelect } from "@/components/TeamSizeSelect";
import { Button, Card, ErrorNote, Header, Input, Label, LinkButton } from "@/components/ui";

/** Karşı takıma (bu sayfadaki takım) maç teklifi gönder */
export default async function ChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { groupId } = await params;
  const { error, from } = await searchParams;
  const { supabase, user } = await requireUser();

  const [{ data: target }, memberships] = await Promise.all([
    supabase.from("groups").select("id, name, kind, city, district, color").eq("id", groupId).maybeSingle(),
    getMemberships(supabase, user.id),
  ]);
  if (!target || target.kind !== "team") notFound();

  // Teklifi sadece kaptan/yetkili olduğumuz takımlardan gönderebiliriz
  const mine = memberships.filter(
    (m) => m.group.kind === "team" && m.role !== "member" && m.group.id !== groupId,
  );
  const targetRating = memberships.find((m) => m.group.id === groupId)?.group.rating;

  return (
    <main>
      <Header title="Maç teklif et" back={`/g/${groupId}`} />
      <Card className="mb-4 flex items-center gap-3">
        <TeamBadge name={target.name} color={target.color} />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted">Rakip takım</div>
          <div className="truncate font-bold">{target.name}</div>
          <div className="truncate text-xs text-muted">{formatRegion(target.city ?? "", target.district)}</div>
        </div>
        {targetRating !== undefined && <OvrBadge overall={targetRating} />}
      </Card>
      <ErrorNote message={error} />

      {mine.length === 0 ? (
        <Card className="mt-4 space-y-3 text-center text-sm text-muted">
          <p>Teklif göndermek için bir takımın kaptanı veya yetkilisi olmalısın.</p>
          <LinkButton href="/takim-kur" variant="secondary" className="w-full">
            Takım kur
          </LinkButton>
        </Card>
      ) : (
        <form action={createChallenge} className="mt-4 space-y-4">
          <input type="hidden" name="toGroupId" value={groupId} />
          <Card className="space-y-4">
            {mine.length === 1 ? (
              <>
                <input type="hidden" name="fromGroupId" value={mine[0].group.id} />
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Gönderen:</span>
                  <TeamBadge name={mine[0].group.name} color={mine[0].group.color} size="sm" />
                  <b>{mine[0].group.name}</b>
                </div>
              </>
            ) : (
              <label className="block">
                <Label>Hangi takımınızdan?</Label>
                <select
                  name="fromGroupId"
                  defaultValue={from && mine.some((m) => m.group.id === from) ? from : mine[0].group.id}
                  className="min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm"
                >
                  {mine.map((m) => (
                    <option key={m.group.id} value={m.group.id}>
                      {m.group.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <Label>Maç zamanı</Label>
              <Input type="datetime-local" name="playedAt" defaultValue={defaultKickoff()} required />
            </label>
            <TeamSizeSelect className="block" />
            <label className="block">
              <Label hint="isteğe bağlı">Saha</Label>
              <Input name="venue" maxLength={80} placeholder="Örn. Petroller Halısaha" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Ücret</Label>
              <Input name="fee" maxLength={120} placeholder="Örn. Saha ücreti yarı yarıya" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Mesaj</Label>
              <textarea
                name="message"
                maxLength={300}
                rows={3}
                placeholder="Örn. 7 kişilik, kaleciler dahil. Önceden haber verirseniz değiştirebiliriz."
                className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </label>
          </Card>
          <Button className="w-full">Teklifi gönder</Button>
          <p className="text-center text-xs text-muted">
            Karşı takımın kaptanı veya yetkilisi kabul ederse iki takımda da maç oluşur; kadroyu her takım kendi belirler.
          </p>
        </form>
      )}
    </main>
  );
}

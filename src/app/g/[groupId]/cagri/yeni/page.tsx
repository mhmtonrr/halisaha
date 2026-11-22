import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createPoll } from "@/lib/actions";
import { defaultKickoff } from "@/lib/data";
import { Button, Card, ErrorNote, Header, Input, Label } from "@/components/ui";

export default async function NewPollPage({
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
    supabase.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("can_create_match", { p_group_id: groupId }),
  ]);
  if (!group) notFound();
  // Çağrıyı sadece kurucu/kaptan, yetkili ve organizatör açar (0034); üye açamaz
  if (!canCreate) redirect(`/g/${groupId}`);

  return (
    <main>
      <Header title="Maç çağrısı aç" back={`/g/${groupId}`} />
      <p className="mb-4 text-sm text-muted">
        {group.name} üyelerine &quot;Geliyor musun?&quot; diye sor. Yanıtlara göre kadroyu onayla, tek tıkla maçı oluştur.
      </p>
      <ErrorNote message={error} />
      <form action={createPoll} className="space-y-4">
        <input type="hidden" name="groupId" value={groupId} />
        <Card className="space-y-4">
          <label className="block">
            <Label>Maç zamanı</Label>
            <Input type="datetime-local" name="startsAt" defaultValue={defaultKickoff()} required />
          </label>
          <label className="block">
            <Label>Saha</Label>
            <Input name="venue" maxLength={80} placeholder="Örn. Petroller Halısaha" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>Kontenjan</Label>
              <Input type="number" name="capacity" min={2} max={40} defaultValue={14} required inputMode="numeric" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Son yanıt</Label>
              <Input type="datetime-local" name="deadline" />
            </label>
          </div>
          <label className="block">
            <Label hint="isteğe bağlı">Not</Label>
            <textarea
              name="note"
              maxLength={300}
              rows={2}
              placeholder="Örn. Kişi başı 150 TL. Kaleciye ihtiyacımız var!"
              className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </label>
        </Card>
        <Button className="w-full">Çağrıyı aç</Button>
      </form>
    </main>
  );
}

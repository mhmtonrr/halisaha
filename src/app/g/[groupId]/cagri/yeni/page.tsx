import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createGatherPoll } from "@/lib/call-actions";
import { istanbulDate } from "@/lib/call-rules";
import { Card, ErrorNote, Header, Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CallFields } from "../CallFields";

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
  const today = istanbulDate();
  const max = istanbulDate(Date.now() + 30 * 86400_000);

  return (
    <main>
      <Header title="Kimler gelir?" back={`/g/${groupId}`} />
      <p className="mb-4 text-sm text-muted">
        {group.name} üyelerine sor. Sadece gün yeterli; saat, saha ve rakip netleşince düzenlersin. Kadroyu sen kesinleştirirsin.
      </p>
      <ErrorNote message={error} />
      <form action={createGatherPoll} className="space-y-4">
        <input type="hidden" name="groupId" value={groupId} />
        <Card className="space-y-4">
          <label className="block">
            <Label>Gün</Label>
            <Input type="date" name="day" min={today} max={max} defaultValue={today} required />
          </label>
          <CallFields />
        </Card>
        <Card className="space-y-1.5 text-xs text-muted">
          <div className="font-semibold text-white">Nasıl işler?</div>
          <p>• Üyeler &quot;Geliyorum / Belki / Gelemem&quot; der, istersen mevki ve not bırakır.</p>
          <p>• Kadroyu sen kesinleştirirsin: liste ilk gelenler işaretli gelir, değiştirebilirsin. Seçilmeyenler yedek olur.</p>
          <p>• Kesinleştirirken &quot;kendi aramızda&quot; ya da takımınla &quot;rakibe karşı&quot; seçersin.</p>
          <p>• Gün geçerse çağrı kendiliğinden kapanır. Aynı anda en fazla 3 açık çağrın olabilir.</p>
        </Card>
        <SubmitButton className="w-full" pendingLabel="Çağrı açılıyor…">
          Çağrıyı aç
        </SubmitButton>
      </form>
    </main>
  );
}

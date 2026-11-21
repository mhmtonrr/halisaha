import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createMemberPoll, createPoll } from "@/lib/actions";
import { defaultKickoff } from "@/lib/data";
import { Button, Card, ErrorNote, Header, Input, Label } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { TeamSizeSelect } from "@/components/TeamSizeSelect";
import { MIN_FILL_RATIO } from "@/lib/poll-rules";

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
  const [{ data: group }, { data: isAdmin }, { data: isMember }] = await Promise.all([
    supabase.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("is_group_admin", { p_group_id: groupId }),
    supabase.rpc("is_group_member", { p_group_id: groupId }),
  ]);
  if (!group) notFound();
  // Yetkililer elle onaylı çağrı açar; gruptaki üyeler otomatik maça dönüşen çağrı açar; takımda üye çağrı açamaz
  const memberCall = !isAdmin && isMember && group.kind === "community";
  if (!isAdmin && !memberCall) redirect(`/g/${groupId}`);

  if (memberCall) {
    return (
      <main>
        <Header title="Maç çağrısı aç" back={`/g/${groupId}`} />
        <p className="mb-4 text-sm text-muted">
          {group.name} üyelerine &quot;Geliyor musun?&quot; diye sor. Yeterli kişi toplanınca maç <b className="text-white">kendiliğinden kurulur</b>.
        </p>
        <ErrorNote message={error} />
        <form action={createMemberPoll} className="space-y-4">
          <input type="hidden" name="groupId" value={groupId} />
          <Card className="space-y-4">
            <label className="block">
              <Label>Maç zamanı</Label>
              <Input type="datetime-local" name="startsAt" defaultValue={defaultKickoff()} required />
            </label>
            <TeamSizeSelect className="block" />
            <label className="block">
              <Label hint="isteğe bağlı">Saha</Label>
              <Input name="venue" maxLength={80} placeholder="Örn. Petroller Halısaha" />
            </label>
            <label className="block">
              <Label hint="boşsa maçtan 3 saat önce">Son yanıt süresi</Label>
              <Input type="datetime-local" name="deadline" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Not</Label>
              <textarea
                name="note"
                maxLength={300}
                rows={2}
                placeholder="Örn. Kişi başı 150 TL. Kaleci lazım!"
                className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </label>
          </Card>
          <Card className="space-y-1.5 text-xs text-muted">
            <div className="font-semibold text-white">Nasıl işler?</div>
            <p>• Kontenjan (kişi sayısı × 2) dolunca maç hemen kurulur, takımlar dengeli bölünür.</p>
            <p>
              • Son yanıt süresi bitince &quot;geliyorum&quot; diyenler kontenjanın en az %{Math.round(MIN_FILL_RATIO * 100)}&apos;iyse eksik kadroyla yine kurulur;
              değilse çağrı iptal olur.
            </p>
            <p>• Maç en az 3 saat sonra, en fazla 14 gün içinde olmalı; son yanıt süresi maçtan en az 1 saat önce olmalı.</p>
            <p>• Aynı anda 1 açık çağrın olabilir. Çağrıyı sen açınca otomatik &quot;geliyorum&quot; olursun; istersen iptal edebilirsin.</p>
          </Card>
          <SubmitButton className="w-full" pendingLabel="Çağrı açılıyor…">
            Çağrıyı aç
          </SubmitButton>
        </form>
      </main>
    );
  }

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

import { Icon } from "@/components/Icon";
import { requireUser } from "@/lib/supabase/server";
import { createGroup } from "@/lib/actions";
import { TEAM_COLORS } from "@/lib/teams-data";
import { TeamFields } from "@/components/TeamFields";
import { Button, Card, ErrorNote, Header } from "@/components/ui";

export default async function NewGroupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city, district").eq("id", user.id).single();

  return (
    <main>
      <Header title="Grup kur" back="/" />
      <Card className="mb-4 space-y-2 text-sm">
        <div className="flex items-center gap-1.5 text-base font-semibold"><Icon name="groups" fill className="text-[20px] text-primary" />Grup: topluluk için</div>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Arkadaş çevreni, iş yerini, mahalleni ya da futbol severleri bir araya getir.</li>
          <li>Sadece üyelere görünür; davet linkiyle katılınır.</li>
          <li>İstediğinde maç çağrısı açıp kendi aranızda oynar, birbirinizi puanlarsınız.</li>
        </ul>
      </Card>
      <ErrorNote message={error} />
      <form action={createGroup} className="space-y-4">
        <Card className="space-y-4">
          <TeamFields kind="community" values={{ name: "", city: profile?.city ?? null, district: null, color: TEAM_COLORS[6], description: null }} />
        </Card>
        <Button className="w-full">Grubu kur</Button>
      </form>
    </main>
  );
}

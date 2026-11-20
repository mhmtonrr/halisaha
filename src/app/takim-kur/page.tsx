import { requireUser } from "@/lib/supabase/server";
import { createTeam } from "@/lib/actions";
import { Button, Card, ErrorNote, Header } from "@/components/ui";
import { TeamFields } from "@/components/TeamFields";

export default async function NewTeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city, district").eq("id", user.id).single();

  return (
    <main>
      <Header title="Takım kur" back="/" />
      <Card className="mb-4 space-y-2 text-sm">
        <div className="text-base font-semibold">🛡️ Takım: rekabet için</div>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Herkese açıktır; bölgendeki takım sıralamasında görünür.</li>
          <li>Başka takımlarla maç yapar, galibiyet-mağlubiyet karnesi tutulur.</li>
          <li>Kaptan sensin. Yetkilileri atar, kadroyu ve maç kadrolarını yönetirsiniz.</li>
        </ul>
      </Card>
      <ErrorNote message={error} />
      <form action={createTeam} className="space-y-4">
        <Card className="space-y-4">
          <TeamFields values={{ name: "", city: profile?.city ?? null, district: profile?.district ?? null, color: null, description: null }} />
        </Card>
        <Button className="w-full">Takımı kur</Button>
      </form>
    </main>
  );
}

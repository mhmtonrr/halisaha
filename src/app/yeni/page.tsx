import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { createGroup, createTeam } from "@/lib/actions";
import { Button, Card, ErrorNote, Header, Input, Label, cx } from "@/components/ui";
import { TeamFields } from "@/components/TeamFields";

export default async function NewPage({ searchParams }: { searchParams: Promise<{ tur?: string; error?: string }> }) {
  const { tur, error } = await searchParams;
  const team = tur !== "grup";
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city, district").eq("id", user.id).single();

  const tab = (active: boolean) =>
    cx("flex-1 rounded-lg py-2 text-center text-sm font-medium", active ? "bg-accent font-semibold text-pitch-950" : "text-muted");

  return (
    <main>
      <Header title={team ? "Takım kur" : "Grup kur"} back="/" />
      <div className="mb-4 flex gap-1 rounded-xl bg-pitch-950 p-1">
        <Link href="/yeni?tur=takim" className={tab(team)}>
          🛡️ Takım
        </Link>
        <Link href="/yeni?tur=grup" className={tab(!team)}>
          👥 Grup
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted">
        {team
          ? "Takımlar herkese açıktır: bölgendeki sıralamada görünür, başka takımlarla maç yapar. Kaptan sensin; yetkilileri sen atarsın."
          : "Gruplar arkadaş toplulukları içindir ve sadece üyelere görünür. Kendi aranızda maç kurup birbirinizi puanlarsınız."}
      </p>
      <ErrorNote message={error} />
      {team ? (
        <form action={createTeam} className="space-y-4">
          <Card className="space-y-4">
            <TeamFields values={{ name: "", city: profile?.city ?? null, district: profile?.district ?? null, color: null, description: null }} />
          </Card>
          <Button className="w-full">Takımı kur</Button>
        </form>
      ) : (
        <form action={createGroup} className="space-y-4">
          <Card className="space-y-4">
            <label className="block">
              <Label>Grup adı</Label>
              <Input name="name" required minLength={2} maxLength={60} placeholder="Örn. Salı Akşamı Ekibi" />
            </label>
            <label className="block">
              <Label hint="isteğe bağlı">Açıklama</Label>
              <Input name="description" maxLength={200} placeholder="Örn. Her salı 21:00, Petroller" />
            </label>
          </Card>
          <Button className="w-full">Grubu kur</Button>
        </form>
      )}
    </main>
  );
}

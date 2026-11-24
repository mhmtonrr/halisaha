import { Icon } from "@/components/Icon";
import { requireUser } from "@/lib/supabase/server";
import { createGroup } from "@/lib/actions";
import { TEAM_COLORS } from "@/lib/teams-data";
import { Button, Card, ErrorNote, Header, Input, Label } from "@/components/ui";
import { RegionSelect } from "@/components/RegionSelect";

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
          <label className="block">
            <Label>Grup adı</Label>
            <Input name="name" required minLength={2} maxLength={60} placeholder="Örn. Moda Futbol Severler" />
          </label>
          <label className="block">
            <Label hint="isteğe bağlı">Grup hakkında</Label>
            <textarea
              name="description"
              maxLength={200}
              rows={3}
              placeholder="Örn. Kadıköy'de yaşayan, hafta içi akşamları top oynamak isteyenlerin topluluğu."
              className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </label>
          <div>
            <p className="mb-2 text-xs text-muted">Grubun bir bölgesi varsa seç (isteğe bağlı)</p>
            <RegionSelect defaultCity={profile?.city} defaultDistrict={null} requireCity={false} />
          </div>
          <div>
            <Label>Grup rengi</Label>
            <div className="flex flex-wrap gap-2">
              {TEAM_COLORS.map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input type="radio" name="color" value={c} defaultChecked={i === 6} className="peer sr-only" />
                  <span
                    className="block h-9 w-9 rounded-full ring-offset-2 ring-offset-pitch-900 peer-checked:ring-2 peer-checked:ring-white"
                    style={{ background: c }}
                  />
                </label>
              ))}
            </div>
          </div>
        </Card>
        <Button className="w-full">Grubu kur</Button>
      </form>
    </main>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { joinGroup } from "@/lib/actions";
import { PROVINCES } from "@/lib/regions";
import { findTeams } from "@/lib/teams-data";
import { Button, Card, ErrorNote, Header, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";

const select = "min-h-11 w-full rounded-xl border border-line bg-pitch-950 px-3 text-sm outline-none focus:border-accent";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ il?: string; ilce?: string; q?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city").eq("id", user.id).single();

  // İl seçilmediyse kullanıcının ili; "tum" ise Türkiye geneli
  const city = sp.il === "tum" ? "" : (sp.il ?? profile?.city ?? "");
  const teams = await findTeams(supabase, { city: city || undefined, district: sp.ilce, q: sp.q, limit: 100 });

  return (
    <main>
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />

      <form className="space-y-2" action="/kesfet">
        <div className="grid grid-cols-2 gap-2">
          <select name="il" defaultValue={city || "tum"} className={select}>
            <option value="tum">Tüm Türkiye</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <Input name="ilce" defaultValue={sp.ilce ?? ""} placeholder="İlçe" />
        </div>
        <div className="flex gap-2">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Takım adı ara" />
          <Button variant="secondary">Ara</Button>
        </div>
      </form>

      <SectionTitle>
        {city ? `${city}${sp.ilce ? ` · ${sp.ilce}` : ""}` : "Türkiye"} takımları · {teams.length}
      </SectionTitle>
      {teams.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Bu bölgede takım bulunamadı.{" "}
          <Link href="/yeni?tur=takim" className="text-accent">
            İlk takımı sen kur
          </Link>
        </Card>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line">
            {teams.map((t, i) => (
              <li key={t.id}>
                <Link href={`/g/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800">
                  <span className={cx("w-6 text-center text-sm font-black", i < 3 ? "text-gold-1" : "text-muted")}>{i + 1}</span>
                  <TeamBadge name={t.name} color={t.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[t.district, t.city].filter(Boolean).join(", ")} · {t.members} oyuncu
                    </div>
                  </div>
                  <OvrBadge overall={t.rating} className={t.rated ? "" : "opacity-50"} />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="mt-2 text-center text-xs text-muted">Takım puanı: kadronun en iyi 7 oyuncusunun ortalaması. Soluk puanlı takımlar henüz puanlı maç oynamadı.</p>

      <SectionTitle>Davet kodun mu var?</SectionTitle>
      <Card>
        <form action={joinGroup} className="flex gap-2">
          <Input name="code" placeholder="Davet kodu veya linki" required />
          <Button variant="secondary">Katıl</Button>
        </form>
      </Card>
    </main>
  );
}

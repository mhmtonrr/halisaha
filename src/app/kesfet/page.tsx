import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { joinGroup } from "@/lib/actions";
import { canonicalDistrict, isProvince } from "@/lib/regions";
import { RegionSelect } from "@/components/RegionSelect";
import { findTeams } from "@/lib/teams-data";
import { getOpenListings } from "@/lib/listings-data";
import { formatDate } from "@/lib/data";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Card, ErrorNote, Header, Input, SectionTitle, cx } from "@/components/ui";
import { OvrBadge } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ il?: string; ilce?: string; q?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city").eq("id", user.id).single();

  // Filtre hiç seçilmediyse kullanıcının ili; boş seçildiyse Türkiye geneli
  const city = sp.il === undefined ? (profile?.city ?? "") : isProvince(sp.il) ? sp.il : "";
  const district = canonicalDistrict(city, sp.ilce) ?? undefined;
  const [teams, listings] = await Promise.all([
    findTeams(supabase, { city: city || undefined, district, q: sp.q, limit: 100 }),
    getOpenListings(supabase, { city: city || undefined, district, limit: 20 }),
  ]);

  return (
    <main>
      <LiveRefresh watches={[{ table: "player_listings" }]} />
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />

      <form className="space-y-2" action="/kesfet">
        <RegionSelect
          key={`${city}-${district ?? ""}`}
          cityName="il"
          districtName="ilce"
          defaultCity={city}
          defaultDistrict={district}
          requireCity={false}
          showLabels={false}
          anyLabel={{ city: "Tüm Türkiye", district: "Tüm ilçeler" }}
          onChangeSubmit
        />
        <div className="flex gap-2">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Takım adı ara" />
          <Button variant="secondary">Ara</Button>
        </div>
      </form>

      {listings.length > 0 && (
        <>
          <SectionTitle>🔎 Oyuncu arayan takımlar · {listings.length}</SectionTitle>
          <div className="space-y-2">
            {listings.map((l) => (
              <Link key={l.id} href={`/ilan/${l.id}`}>
                <Card className="flex items-center gap-3 border-amber-400/30 transition hover:border-amber-400">
                  <TeamBadge name={l.team.name} color={l.team.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {l.team.name} · {l.needed} oyuncu
                    </div>
                    <div className="truncate text-xs text-muted">
                      {formatDate(l.playedAt)}
                      {l.positions.length ? ` · ${l.positions.join("/")}` : ""}
                      {l.minOverall ? ` · min ${l.minOverall}` : ""}
                    </div>
                  </div>
                  <span className="text-amber-300">›</span>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionTitle>
        {city ? `${city}${district ? ` · ${district}` : ""}` : "Türkiye"} takımları · {teams.length}
      </SectionTitle>
      {teams.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Bu bölgede takım bulunamadı.{" "}
          <Link href="/takim-kur" className="text-accent">
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

import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { canonicalDistrict, isProvince } from "@/lib/regions";
import { RegionSelect } from "@/components/RegionSelect";
import { findTeams } from "@/lib/teams-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCandidates } from "@/lib/players-data";
import { parseFilter, searchCandidates } from "@/lib/player-search";
import { PAGE_SIZE, PlayerFilters, PlayerResults } from "./PlayerSearch";
import { Badge, Button, Card, ErrorNote, Header, Input, LinkButton, SectionTitle, cx } from "@/components/ui";
import { OvrBadge } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";
import { Icon } from "@/components/Icon";
import { openListings } from "@/lib/listings-data";
import { matchWhen } from "@/lib/match-rules";
import { POSITION_NAME, type Position } from "@/lib/data";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const players = sp.sekme === "oyuncu";
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("city").eq("id", user.id).single();

  // Filtre hiç seçilmediyse kullanıcının ili; boş seçildiyse Türkiye geneli
  const city = sp.il === undefined ? (profile?.city ?? "") : isProvince(sp.il) ? sp.il : "";
  const district = canonicalDistrict(city, sp.ilce) ?? undefined;
  if (players) return <PlayersTab sp={sp} userId={user.id} city={city} district={district} />;
  if (sp.sekme === "mac") return <FillCallsTab city={city} district={district} />;

  const [allTeams, { data: teamBlocks }] = await Promise.all([
    findTeams(supabase, { city: city || undefined, district, q: sp.q, limit: 100 }),
    supabase.from("user_blocks").select("blocked_group_id").not("blocked_group_id", "is", null),
  ]);
  // Engellediğim takımlar listede görünmez
  const blockedTeams = new Set((teamBlocks ?? []).map((b) => b.blocked_group_id as string));
  const teams = allTeams.filter((t) => !blockedTeams.has(t.id));

  return (
    <main>
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />
      <Tabs active="takim" city={city} district={district} />

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
      <div className="grid grid-cols-2 gap-2">
        <LinkButton href="/katil?tur=takim" variant="secondary" className="w-full">
          Takıma katıl
        </LinkButton>
        <LinkButton href="/katil?tur=grup" variant="secondary" className="w-full">
          Gruba katıl
        </LinkButton>
      </div>
    </main>
  );
}

type Tab = "takim" | "oyuncu" | "mac";

function Tabs({ active, city, district }: { active: Tab; city: string; district?: string }) {
  // Sekme değişince seçili bölge korunur
  const region = new URLSearchParams({ il: city, ...(district ? { ilce: district } : {}) }).toString();
  const tab = (key: Tab, label: string) => (
    <Link
      href={`/kesfet?${key === "takim" ? "" : `sekme=${key}&`}${region}`}
      className={cx(
        "flex min-h-10 flex-1 items-center justify-center rounded-lg text-sm font-semibold transition",
        active === key ? "bg-accent text-pitch-950" : "text-muted hover:text-white",
      )}
    >
      {label}
    </Link>
  );
  return <div className="mb-3 flex gap-1 rounded-xl border border-line bg-pitch-900/80 p-1">{tab("takim", "Takımlar")}{tab("oyuncu", "Oyuncular")}{tab("mac", "Adam arayan")}</div>;
}

/** Herkese açık adam aramalar (0041): bölgedeki eksiği olan maçlar; "Başvur" çağrı sayfasına götürür */
async function FillCallsTab({ city, district }: { city: string; district?: string }) {
  const { supabase } = await requireUser();
  const calls = await openListings(supabase, city || undefined, district);
  return (
    <main>
      <Header title="Keşfet" />
      <Tabs active="mac" city={city} district={district} />
      <form action="/kesfet">
        <input type="hidden" name="sekme" value="mac" />
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
      </form>

      <SectionTitle>
        {city ? `${city}${district ? ` · ${district}` : ""}` : "Türkiye"} · adam arayan maçlar · {calls.length}
      </SectionTitle>
      {calls.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Bu bölgede şu an oyuncu arayan maç yok. Kendi maçında eksik varsa maç ekranında &quot;Adam ara&quot; → &quot;Keşfet (herkese açık)&quot;.
        </Card>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => {
            const left = Math.max((c.capacity ?? 0) - c.roster_count, 0);
            const pct = Math.min(100, Math.round((c.roster_count / Math.max(1, c.capacity ?? 1)) * 100));
            const badge =
              c.can_manage ? <Badge>Senin maçın</Badge>
              : c.my_status === "pending" ? <Badge tone="warn">Başvurdun</Badge>
              : c.my_status === "in" ? <Badge tone="accent">Kadrodasın</Badge>
              : c.my_status === "reserve" ? <Badge tone="warn">Yedektesin</Badge>
              : c.is_member ? <Badge>Senin grubun</Badge>
              : <span className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-pitch-950">Başvur</span>;
            return (
              <Link key={c.listing_id} href={`/g/${c.group_id}/m/${c.match_id}`} className="block">
                <Card className="space-y-2 transition hover:border-accent/50">
                  <div className="flex items-center gap-3">
                    <Icon name="person_search" fill className="text-[26px] text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{matchWhen(c.played_at, c.time_tbd)}</div>
                      <div className="truncate text-xs text-on-surface-variant">
                        {c.group_kind === "team" ? "Takım" : "Grup"} · {c.group_name}
                        {c.opponent_name ? ` vs ${c.opponent_name}` : ""}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[c.venue, [c.district, c.city].filter(Boolean).join(", "), c.team_size ? `${c.team_size}v${c.team_size}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {badge}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold tabular-nums">
                      {c.roster_count}/{c.capacity}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-pitch-800">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span>
                      <b className="text-accent">{left} oyuncu</b> aranıyor
                    </span>
                  </div>
                  {c.positions.length > 0 && <div className="text-xs text-muted">Aranan: {c.positions.map((p) => POSITION_NAME[p as Position] ?? p).join(", ")}</div>}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-center text-xs text-muted">
        Kadroya alınırsan o maçta ödünç oyuncu olursun: maçı ve oylamasını görürsün, puanın genel ratingine işler.
      </p>
    </main>
  );
}

async function PlayersTab({
  sp,
  userId,
  city,
  district,
}: {
  sp: Record<string, string | undefined>;
  userId: string;
  city: string;
  district?: string;
}) {
  const { filter, sort } = parseFilter(sp);
  const page = Math.max(1, Math.min(50, Number(sp.sayfa) || 1));
  const admin = createAdminClient();
  // Engellediklerim aramada görünmez
  const { data: blocks } = await admin.from("user_blocks").select("blocked_user_id").eq("blocker_id", userId).not("blocked_user_id", "is", null);
  const blocked = new Set((blocks ?? []).map((b) => b.blocked_user_id as string));
  const allCandidates = await loadCandidates(admin, {
    city: city || undefined,
    district,
    q: filter.q,
    position: filter.position,
    includeSecondary: filter.includeSecondary,
    foot: filter.foot,
  });
  const candidates = allCandidates.filter((c) => !blocked.has(c.userId));
  const found = searchCandidates(candidates, filter, sort);
  const items = found.slice(0, page * PAGE_SIZE);
  const more = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "sayfa" && e[0] !== "error"));
  more.set("sayfa", String(page + 1));

  return (
    <main>
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />
      <Tabs active="oyuncu" city={city} district={district} />
      <PlayerFilters city={city} district={district} filter={filter} sort={sort} />
      <SectionTitle>
        {city ? `${city}${district ? ` · ${district}` : ""}` : "Türkiye"} oyuncuları · {found.length}
      </SectionTitle>
      <PlayerResults
        items={items}
        total={found.length}
        userId={userId}
        skill={filter.skill}
        moreHref={items.length < found.length ? `/kesfet?${more.toString()}` : null}
      />
      <p className="mt-2 text-center text-xs text-muted">
        Soluk puanlı oyuncular henüz puanlı maç oynamadı. Aramada görünmek istemezsen Profil → Ayarlar&apos;dan kapatabilirsin.
      </p>
    </main>
  );
}

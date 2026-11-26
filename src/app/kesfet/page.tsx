import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { canonicalDistrict, isProvince } from "@/lib/regions";
import { DiscoverForm, type DiscoverTab } from "./DiscoverForm";
import { SortSelect } from "./DiscoverControls";
import { loadRisingDeltas, loadTeamForms } from "@/lib/featured-data";
import { NO_FORM, TEAM_SORTS, parseTeamSort, sortTeams, winRate, type TeamSort } from "@/lib/team-sort";
import type { TeamForm } from "@/lib/featured-rules";
import { isSkillKey } from "@/lib/skills";
import { MIN_LISTED_MEMBERS, findTeams, type TeamSummary } from "@/lib/teams-data";
import { CALL_SORTS, GROUP_SORTS, parseCallSort, parseGroupSort, sortCalls, sortGroups } from "@/lib/discover-sort";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCandidates } from "@/lib/players-data";
import { fold, parseFilter, searchCandidates } from "@/lib/player-search";
import { PAGE_SIZE, PlayerFilters, PlayerResults } from "./PlayerSearch";
import { Badge, Card, ErrorNote, Header, LinkButton, SectionTitle, cx } from "@/components/ui";
import { OvrBadge } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";
import { Icon } from "@/components/Icon";
import { matchExtras, openListings } from "@/lib/listings-data";
import { feeText, matchWhen, opponentLabel } from "@/lib/match-rules";
import { POSITION_NAME, type Position } from "@/lib/data";
import { JoinRequest } from "@/components/JoinRequest";

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
  if (sp.sekme === "mac") return <FillCallsTab sp={sp} city={city} district={district} />;
  if (sp.sekme === "grup") return <GroupsTab sp={sp} city={city} district={district} />;

  const sort = parseTeamSort(sp.sirala);
  const [allTeams, { data: teamBlocks }, forms] = await Promise.all([
    findTeams(supabase, { city: city || undefined, district, q: sp.q, limit: 500, minMembers: 1 }),
    supabase.from("user_blocks").select("blocked_group_id").not("blocked_group_id", "is", null),
    loadTeamForms(),
  ]);
  // Engellediğim takımlar listede görünmez
  const blockedTeams = new Set((teamBlocks ?? []).map((b) => b.blocked_group_id as string));
  const visible = allTeams.filter((t) => !blockedTeams.has(t.id));
  // Önce sırala, sonra ilk 100
  const teams = sortTeams(visible.filter((t) => t.members >= MIN_LISTED_MEMBERS), sort, forms).slice(0, 100);
  // Kadrosu henüz tamamlanmamış takımlar sıralamaya girmez; tamamlanmaya en yakın olan önde
  const fresh = visible.filter((t) => t.members < MIN_LISTED_MEMBERS).sort((a, b) => b.members - a.members || a.name.localeCompare(b.name, "tr")).slice(0, 20);

  return (
    <main>
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />
      <Tabs active="takim" city={city} district={district} />

      <DiscoverForm key={sort} tab="takim" city={city} district={district} q={sp.q} placeholder="Takım adı ara">
        <SortSelect value={sort} groups={[{ options: [...TEAM_SORTS] }]} />
      </DiscoverForm>

      <SectionTitle>
        {where(city, district)} takımları · {teams.length}
      </SectionTitle>
      {teams.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          {fresh.length ? "Bu bölgede sıralamaya giren takım henüz yok." : "Bu bölgede takım bulunamadı."}{" "}
          <Link href="/takim-kur" className="text-accent">
            {fresh.length ? "Sen de takım kur" : "İlk takımı sen kur"}
          </Link>
        </Card>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line">
            {teams.map((t, i) => (
              <li key={t.id}>
                <Link href={`/g/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800">
                  <span className={cx("w-6 text-center text-sm font-black", i < 3 ? "text-gold-1" : "text-muted")}>{i + 1}</span>
                  <TeamBadge id={t.id} name={t.name} color={t.color} logo={t.logo} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[t.district, t.city].filter(Boolean).join(", ")} · {t.members} oyuncu
                    </div>
                    <TeamRecord form={forms.get(t.id) ?? NO_FORM} sort={sort} />
                  </div>
                  <OvrBadge overall={t.rating} className={t.rated ? "" : "opacity-50"} />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <NewTeams teams={fresh} />
      <p className="mt-2 text-center text-xs text-muted">
        Takım puanı: kadronun en iyi 7 oyuncusunun ortalaması; soluk puanlı takımlar henüz puanlı maç oynamadı. Maç ve galibiyet sayıları sadece uygulamadaki takımlarla oynanan, skoru onaylı maçlardandır.
      </p>
      <InviteCode href="/katil?tur=takim" label="Takıma katıl" />
    </main>
  );
}

/** Bölge başlığı: "İl · İlçe" ya da Türkiye */
const where = (city: string, district?: string) => (city ? `${city}${district ? ` · ${district}` : ""}` : "Türkiye");

function InviteCode({ href, label }: { href: string; label: string }) {
  return (
    <>
      <SectionTitle>Davet kodun mu var?</SectionTitle>
      <LinkButton href={href} variant="secondary" className="w-full">
        {label}
      </LinkButton>
    </>
  );
}

/** MIN_LISTED_MEMBERS'tan az üyeli takımlar: puansız, sırasız ayrı liste */
function NewTeams({ teams }: { teams: TeamSummary[] }) {
  if (!teams.length) return null;
  return (
    <>
      <SectionTitle>Yeni takımlar · {teams.length}</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {teams.map((t) => (
            <li key={t.id}>
              <Link href={`/g/${t.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800">
                <TeamBadge id={t.id} name={t.name} color={t.color} logo={t.logo} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted">
                    {[t.district, t.city].filter(Boolean).join(", ") || "Bölge yok"} · {t.members} oyuncu
                  </div>
                </div>
                <Icon name="chevron_right" className="text-[18px] text-on-surface-variant" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-2 text-center text-xs text-muted">Takımlar {MIN_LISTED_MEMBERS} oyuncuya ulaşınca sıralamaya girer.</p>
    </>
  );
}

/** Takım satırındaki maç özeti; seri/aktiflik/averaj sıralamasında ilgili değer de yazar */
function TeamRecord({ form, sort }: { form: TeamForm; sort: TeamSort }) {
  if (!form.played) {
    return sort === "rating" || sort === "isim" || sort === "kadro" ? null : <div className="text-xs text-muted/70">Henüz maç yok</div>;
  }
  const extra =
    sort === "seri" ? `${form.streak} maçlık seri`
    : sort === "aktif" ? `30 günde ${form.recent} maç`
    : sort === "averaj" ? `averaj ${form.diff > 0 ? "+" : ""}${form.diff}`
    : null;
  return (
    <div className="truncate text-xs text-on-surface-variant">
      {form.played} maç · {form.wins}G {form.draws}B {form.losses}M · %{winRate(form)}
      {extra && <b className="text-accent"> · {extra}</b>}
    </div>
  );
}

function Tabs({ active, city, district }: { active: DiscoverTab; city: string; district?: string }) {
  // Sekme değişince seçili bölge korunur
  const region = new URLSearchParams({ il: city, ...(district ? { ilce: district } : {}) }).toString();
  const tab = (key: DiscoverTab, label: string) => (
    <Link
      href={`/kesfet?${key === "takim" ? "" : `sekme=${key}&`}${region}`}
      className={cx(
        "flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-1 text-[13px] font-semibold transition",
        active === key ? "bg-accent text-pitch-950" : "text-muted hover:text-white",
      )}
    >
      {label}
    </Link>
  );
  return <div className="mb-3 flex gap-1 rounded-xl border border-line bg-pitch-900/80 p-1">{tab("takim", "Takımlar")}{tab("oyuncu", "Oyuncular")}{tab("mac", "Adam arayan")}{tab("grup", "Gruplar")}</div>;
}

interface DiscoverGroup {
  group_id: string;
  name: string;
  kind: "team" | "community";
  city: string | null;
  district: string | null;
  description: string | null;
  color: string | null;
  logo: string | null;
  member_count: number;
  accepts_requests: boolean;
  is_member: boolean;
  my_request: string | null;
}

/** Keşfet'te görünen topluluk grupları (0044 discover_groups) ve katılma isteği; takımlar "Takımlar" sekmesinde */
async function GroupsTab({ sp, city, district }: { sp: Record<string, string | undefined>; city: string; district?: string }) {
  const { supabase } = await requireUser();
  const [{ data }, { data: blocks }] = await Promise.all([
    supabase.rpc("discover_groups", { p_city: city || null, p_district: district ?? null, p_kind: "community" }),
    supabase.from("user_blocks").select("blocked_group_id").not("blocked_group_id", "is", null),
  ]);
  const blocked = new Set((blocks ?? []).map((b) => b.blocked_group_id as string));
  const q = fold(sp.q ?? "");
  const sort = parseGroupSort(sp.sirala);
  const groups = sortGroups(
    ((data ?? []) as DiscoverGroup[]).filter((g) => !blocked.has(g.group_id) && (!q || fold(g.name).includes(q))),
    sort,
  );
  const back = `/kesfet?${new URLSearchParams({ sekme: "grup", il: city, ...(district ? { ilce: district } : {}), ...(sp.q ? { q: sp.q } : {}), sirala: sort }).toString()}`;
  return (
    <main>
      <Header title="Keşfet" />
      <ErrorNote message={sp.error} />
      {sp.istek === "gonderildi" && (
        <p className="mb-3 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">İsteğin gönderildi. Kaptan ya da yetkili karar verince haber gelir.</p>
      )}
      <Tabs active="grup" city={city} district={district} />
      <DiscoverForm key={sort} tab="grup" city={city} district={district} q={sp.q} placeholder="Grup adı ara">
        <SortSelect value={sort} groups={[{ options: [...GROUP_SORTS] }]} />
      </DiscoverForm>

      <SectionTitle>
        {where(city, district)} grupları · {groups.length}
      </SectionTitle>
      {groups.length === 0 ? (
        <Card className="text-center text-sm text-muted">Bu bölgede listelenen grup yok. Gruplar, kurucusu &quot;Keşfet&apos;te görünsün&quot; derse burada çıkar.</Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const head = (
              <div className="flex items-center gap-3">
                <TeamBadge id={g.group_id} name={g.name} color={g.color} logo={g.logo} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="truncate text-xs text-muted">
                    {[g.district, g.city].filter(Boolean).join(", ") || "Bölge yok"} · {g.member_count} üye
                  </div>
                </div>
                {g.is_member && <Badge tone="accent">Üyesin</Badge>}
              </div>
            );
            return (
              <Card key={g.group_id} className="space-y-2 p-3">
                {g.is_member ? (
                  <Link href={`/g/${g.group_id}`} className="block">
                    {head}
                  </Link>
                ) : (
                  head
                )}
                {g.description && <p className="line-clamp-2 text-xs text-on-surface-variant">{g.description}</p>}
                {!g.is_member &&
                  (g.my_request === "pending" || g.accepts_requests ? (
                    <JoinRequest groupId={g.group_id} back={back} pending={g.my_request === "pending"} isTeam={false} />
                  ) : (
                    <p className="text-[11px] text-muted">Grup şu an katılma isteği almıyor.</p>
                  ))}
              </Card>
            );
          })}
        </div>
      )}
      <InviteCode href="/katil?tur=grup" label="Gruba katıl" />
    </main>
  );
}

/** Herkese açık adam aramalar (0041): bölgedeki eksiği olan maçlar; "Başvur" çağrı sayfasına götürür */
async function FillCallsTab({ sp, city, district }: { sp: Record<string, string | undefined>; city: string; district?: string }) {
  const { supabase } = await requireUser();
  const needle = fold(sp.q ?? "");
  const sort = parseCallSort(sp.sirala);
  const calls = sortCalls(
    (await openListings(supabase, city || undefined, district)).filter(
      (c) => !needle || [c.group_name, c.venue, c.opponent_name].some((v) => v && fold(v).includes(needle)),
    ),
    sort,
  );
  const extras = await matchExtras(supabase, calls.map((c) => c.match_id));
  return (
    <main>
      <Header title="Keşfet" />
      <Tabs active="mac" city={city} district={district} />
      <DiscoverForm key={sort} tab="mac" city={city} district={district} q={sp.q} placeholder="Takım, grup veya saha ara">
        <SortSelect value={sort} groups={[{ options: [...CALL_SORTS] }]} />
      </DiscoverForm>

      <SectionTitle>
        {where(city, district)} · adam arayan maçlar · {calls.length}
      </SectionTitle>
      {calls.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Bu bölgede şu an oyuncu arayan maç yok. Kendi maçında eksik varsa Taktik Odası&apos;nda &quot;Adam ara&quot; → &quot;Keşfet (herkese açık)&quot;.
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
                        {opponentLabel(c.opponent_name, extras.get(c.match_id)?.pendingRival) ? ` ${opponentLabel(c.opponent_name, extras.get(c.match_id)?.pendingRival)}` : ""}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {[c.venue, [c.district, c.city].filter(Boolean).join(", "), c.team_size ? `${c.team_size}v${c.team_size}` : null, extras.get(c.match_id)?.fee ? feeText(extras.get(c.match_id)!.fee!) : null]
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
  const rising = sort === "yukselen" ? await loadRisingDeltas() : undefined;
  const found = searchCandidates(candidates, filter, sort, rising);
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
        {where(city, district)} oyuncuları · {found.length}
      </SectionTitle>
      <PlayerResults
        items={items}
        total={found.length}
        userId={userId}
        skill={isSkillKey(sort) ? sort : filter.skill}
        rising={rising}
        moreHref={items.length < found.length ? `/kesfet?${more.toString()}` : null}
      />
      <p className="mt-2 text-center text-xs text-muted">
        Soluk puanlı oyuncular henüz puanlı maç oynamadı. Aramada görünmek istemezsen Profil → Ayarlar&apos;dan kapatabilirsin.
      </p>
    </main>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { decideJoinRequest } from "@/lib/join-actions";
import { decideListing } from "@/lib/match-manage-actions";
import { matchWhen } from "@/lib/match-rules";
import { POSITION_NAME, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorNote, Header, cx } from "@/components/ui";
import { ProposalDecisions, type PendingProposal } from "../GroupExtras";

// Bekleyen istekler (0044 pending_requests): her bölüm sadece karar verebilene dolu döner; boş sekme gösterilmez

interface JoinReq {
  id: string;
  name: string;
  photo_url: string | null;
  city: string | null;
  district: string | null;
  message: string | null;
}
interface ListingReq {
  id: string;
  match_id: string;
  group_id: string;
  group_name: string;
  played_at: string;
  time_tbd: boolean;
  venue: string | null;
  capacity: number | null;
  roster_count: number;
  positions: string[] | null;
  note: string | null;
  by: string | null;
}
interface Application {
  match_id: string;
  user_id: string;
  name: string;
  photo_url: string | null;
  source: string;
  position: string | null;
  note: string | null;
  played_at: string;
  time_tbd: boolean;
}
interface Pending {
  joins: JoinReq[];
  listings: ListingReq[];
  proposals: PendingProposal[];
  applications: Application[];
}

const TABS = [
  { key: "katilma", label: "Katılma", field: "joins" },
  { key: "ilan", label: "İlan onayı", field: "listings" },
  { key: "oneri", label: "Öneri", field: "proposals" },
  { key: "basvuru", label: "Başvuru", field: "applications" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const SOURCE: Record<string, string> = { listing: "İlandan", link: "Bağlantıdan", invite: "Davetten", member: "Üye" };

export default async function PendingPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ sekme?: string; error?: string }>;
}) {
  const { groupId } = await params;
  const { sekme, error } = await searchParams;
  const { supabase } = await requireUser();

  const { data: group } = await supabase.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle();
  if (!group) notFound();
  const { data, error: rpcError } = await supabase.rpc("pending_requests", { p_group: groupId });
  // Yetkisi yoksa (ör. rolü düştü) grup sayfasına
  if (rpcError || !data) redirect(`/g/${groupId}`);
  const pending = data as Pending;

  const tabs = TABS.filter((t) => pending[t.field].length > 0);
  const active: TabKey | undefined = tabs.find((t) => t.key === sekme)?.key ?? tabs[0]?.key;
  const isTeam = group.kind === "team";

  return (
    <main>
      <Header title="İstekler" back={`/g/${groupId}`} />
      <ErrorNote message={error} />

      {tabs.length === 0 ? (
        <Card className="mt-2 text-center text-sm text-on-surface-variant">
          <Icon name="task_alt" className="mb-1 text-[32px] text-primary" />
          <div>Bekleyen istek yok.</div>
        </Card>
      ) : (
        <>
          <nav className="mb-3 flex gap-1 rounded-xl border border-line bg-pitch-900/80 p-1">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={`/g/${groupId}/istekler?sekme=${t.key}`}
                className={cx(
                  "flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-[13px] font-semibold transition",
                  active === t.key ? "bg-accent text-pitch-950" : "text-muted hover:text-white",
                )}
              >
                {t.label}
                <span className={cx("rounded-full px-1.5 text-[11px] font-bold", active === t.key ? "bg-pitch-950/20" : "bg-amber-400 text-pitch-950")}>
                  {pending[t.field].length}
                </span>
              </Link>
            ))}
          </nav>

          {active === "katilma" && (
            <div className="space-y-2">
              {pending.joins.map((r) => (
                <Card key={r.id} className="space-y-2 p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} photoUrl={r.photo_url} className="h-10 w-10 bg-surface-highest text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.name}</div>
                      <div className="text-xs text-on-surface-variant">{formatRegion(r.city, r.district) || "Bölge yok"}</div>
                    </div>
                  </div>
                  {r.message && <p className="rounded-lg bg-surface-low p-2 text-xs text-on-surface-variant">“{r.message}”</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {(["1", "0"] as const).map((a) => (
                      <form key={a} action={decideJoinRequest}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="accept" value={a} />
                        <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="min-h-10 w-full text-sm" pendingLabel="…">
                          {a === "1" ? (isTeam ? "Takıma al" : "Gruba al") : "Reddet"}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {active === "ilan" && (
            <div className="space-y-2">
              {pending.listings.map((l) => (
                <Card key={l.id} className="space-y-2 p-3">
                  <div className="text-sm">
                    <b>{l.group_name}</b> maçı için adam arıyor · {matchWhen(l.played_at, l.time_tbd)}
                    {l.venue ? ` · ${l.venue}` : ""}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    Paylaşan: {l.by ?? "bir üye"} · kadro {l.roster_count}/{l.capacity ?? "?"}
                    {l.positions?.length ? ` · ${l.positions.map((p) => POSITION_NAME[p as Position]).join(", ")}` : ""}
                  </div>
                  {l.note && <p className="rounded-lg bg-surface-low p-2 text-xs text-on-surface-variant">“{l.note}”</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {(["1", "0"] as const).map((a) => (
                      <form key={a} action={decideListing}>
                        <input type="hidden" name="groupId" value={groupId} />
                        <input type="hidden" name="listingId" value={l.id} />
                        <input type="hidden" name="accept" value={a} />
                        <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="min-h-10 w-full text-sm" pendingLabel="…">
                          {a === "1" ? (isTeam ? "Takımda yayınla" : "Grupta yayınla") : "Reddet"}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                  <p className="text-[11px] text-on-surface-variant">Yayınlarsan ilan üyelere duyurulur; başvuranları maçı yöneten onaylar.</p>
                </Card>
              ))}
            </div>
          )}

          {active === "oneri" && <ProposalDecisions groupId={groupId} proposals={pending.proposals} />}

          {active === "basvuru" && (
            <div className="space-y-2">
              {pending.applications.map((a) => (
                <Link
                  key={`${a.match_id}:${a.user_id}`}
                  href={`/g/${groupId}/m/${a.match_id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface-container p-3 transition hover:border-primary/50"
                >
                  <Avatar name={a.name} photoUrl={a.photo_url} className="h-10 w-10 bg-surface-highest text-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.name}</div>
                    <div className="truncate text-xs text-on-surface-variant">
                      {matchWhen(a.played_at, a.time_tbd)}
                      {SOURCE[a.source] ? ` · ${SOURCE[a.source]}` : ""}
                      {a.position ? ` · ${POSITION_NAME[a.position as Position] ?? a.position}` : ""}
                    </div>
                    {a.note && <div className="truncate text-xs text-on-surface-variant">“{a.note}”</div>}
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-primary">Maçta karar ver</span>
                  <Icon name="chevron_right" className="shrink-0 text-[18px] text-on-surface-variant" />
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

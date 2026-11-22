import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getMemberships, ROLE_LABEL } from "@/lib/teams-data";
import { friendAction, openDm } from "@/lib/actions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Avatar } from "@/components/Avatar";
import { TeamBadge } from "@/components/TeamBadge";
import { Card, Header, cx } from "@/components/ui";

const TABS = [
  { key: "arkadaslar", label: "Arkadaşlar" },
  { key: "takimlar", label: "Takımlar" },
  { key: "gruplar", label: "Gruplar" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Person {
  id: string;
  display_name: string;
  photo_url: string | null;
  city: string | null;
}

function PersonRow({ p, children }: { p: Person; children: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3">
      <Link href={`/oyuncu/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={p.display_name} photoUrl={p.photo_url} className="h-10 w-10 shrink-0 bg-pitch-700 text-sm" />
        <div className="min-w-0">
          <div className="truncate font-medium">{p.display_name}</div>
          {p.city && <div className="truncate text-xs text-muted">{p.city}</div>}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </Card>
  );
}

const HiddenFields = ({ op, userId }: { op: string; userId: string }) => (
  <>
    <input type="hidden" name="op" value={op} />
    <input type="hidden" name="userId" value={userId} />
    <input type="hidden" name="back" value="/sosyal" />
  </>
);

/** Sosyal: arkadaşlar (istekler dahil), takımlarım, gruplarım */
export default async function SocialPage({ searchParams }: { searchParams: Promise<{ sekme?: string; error?: string }> }) {
  const { sekme, error } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sekme) ? (sekme as Tab) : "arkadaslar";
  const { supabase, user } = await requireUser();

  const [{ data: rows }, memberships] = await Promise.all([
    supabase.from("friendships").select("user_a, user_b, status, requested_by").limit(500),
    getMemberships(supabase, user.id),
  ]);
  const friendRows = rows ?? [];
  const otherId = (r: { user_a: string; user_b: string }) => (r.user_a === user.id ? r.user_b : r.user_a);
  const ids = friendRows.map(otherId);
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, display_name, photo_url, city").in("id", ids)
    : { data: [] as Person[] };
  const byId = new Map((people ?? []).map((p) => [p.id, p as Person]));
  const pick = (f: (r: (typeof friendRows)[number]) => boolean) =>
    friendRows.filter(f).map((r) => byId.get(otherId(r))).filter((p): p is Person => !!p);

  const incoming = pick((r) => r.status === "pending" && r.requested_by !== user.id);
  const outgoing = pick((r) => r.status === "pending" && r.requested_by === user.id);
  const friends = pick((r) => r.status === "accepted").sort((a, b) => a.display_name.localeCompare(b.display_name, "tr"));

  const canInvite = memberships.some((m) => m.role === "captain" || m.role === "admin");
  const mine = (kind: "team" | "community") =>
    memberships.filter((m) => m.group.kind === kind).sort((a, b) => a.group.name.localeCompare(b.group.name, "tr"));

  const renderGroups = (kind: "team" | "community") => {
    const list = mine(kind);
    if (!list.length)
      return (
        <Card className="space-y-2 text-center text-sm text-muted">
          <p>{kind === "team" ? "Henüz bir takımın yok." : "Henüz bir grubun yok."}</p>
          <Link href={kind === "team" ? "/takim-kur" : "/grup-kur"} className="text-accent">
            {kind === "team" ? "Takım kur ›" : "Grup kur ›"}
          </Link>
        </Card>
      );
    return (
      <div className="space-y-2">
        {list.map((m) => (
          <Card key={m.group.id} className="flex items-center gap-3">
            <Link href={`/g/${m.group.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <TeamBadge name={m.group.name} color={m.group.color} size="sm" />
              <div className="min-w-0">
                <div className="truncate font-medium">{m.group.name}</div>
                <div className="text-xs text-muted">{ROLE_LABEL[kind][m.role]}</div>
              </div>
            </Link>
            <Link href={`/g/${m.group.id}/sohbet`} aria-label="Sohbet" className="rounded-lg bg-pitch-800 px-3 py-1.5 text-sm hover:text-accent">
              💬
            </Link>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <main>
      <LiveRefresh watches={[{ table: "friendships", filter: `user_a=eq.${user.id}` }, { table: "friendships", filter: `user_b=eq.${user.id}` }]} />
      <Header title="Sosyal" back="/" />
      <nav className="mb-4 flex gap-1 rounded-xl bg-pitch-900 p-1" aria-label="Sosyal sekmeler">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/sosyal?sekme=${t.key}`}
            replace
            className={cx("flex-1 rounded-lg py-2 text-center text-sm font-bold transition", tab === t.key ? "bg-accent text-pitch-950" : "text-muted hover:text-white")}
          >
            {t.label}
            {t.key === "arkadaslar" && incoming.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[11px] text-pitch-950">{incoming.length}</span>
            )}
          </Link>
        ))}
      </nav>
      {error && <p className="mb-3 rounded-xl border border-red-400/40 bg-red-950/40 p-3 text-center text-sm text-red-200">{error}</p>}

      {tab === "arkadaslar" && (
        <div className="space-y-5">
          {incoming.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-amber-300">Arkadaşlık istekleri ({incoming.length})</h2>
              {incoming.map((p) => (
                <PersonRow key={p.id} p={p}>
                  <form action={friendAction}>
                    <HiddenFields op="accept" userId={p.id} />
                    <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-pitch-950">Kabul</button>
                  </form>
                  <form action={friendAction}>
                    <HiddenFields op="decline" userId={p.id} />
                    <button className="rounded-lg bg-pitch-800 px-3 py-1.5 text-sm">Reddet</button>
                  </form>
                </PersonRow>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Arkadaşlarım ({friends.length})</h2>
              <Link href="/kesfet" className="text-xs text-accent">
                Oyuncu bul ›
              </Link>
            </div>
            {friends.length === 0 ? (
              <Card className="space-y-2 text-center text-sm text-muted">
                <div className="text-3xl">👋</div>
                <p>Henüz arkadaşın yok. Keşfet’ten oyuncu bul, profilinden “Arkadaş ekle”ye bas.</p>
              </Card>
            ) : (
              friends.map((p) => (
                <PersonRow key={p.id} p={p}>
                  {canInvite && (
                    <Link href={`/oyuncu/${p.id}#davet`} aria-label={`${p.display_name} kişisini davet et`} className="rounded-lg bg-pitch-800 px-2.5 py-1.5 text-sm hover:text-accent">
                      🛡️
                    </Link>
                  )}
                  <form action={openDm}>
                    <input type="hidden" name="userId" value={p.id} />
                    <button aria-label={`${p.display_name} ile mesajlaş`} className="rounded-lg bg-pitch-800 px-3 py-1.5 text-sm hover:text-accent">
                      💬 Mesaj
                    </button>
                  </form>
                </PersonRow>
              ))
            )}
          </section>

          {outgoing.length > 0 && (
            <section className="space-y-2">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted">Gönderilen istekler ({outgoing.length})</h2>
              {outgoing.map((p) => (
                <PersonRow key={p.id} p={p}>
                  <form action={friendAction}>
                    <HiddenFields op="remove" userId={p.id} />
                    <button className="rounded-lg bg-pitch-800 px-3 py-1.5 text-xs">Geri çek</button>
                  </form>
                </PersonRow>
              ))}
            </section>
          )}
        </div>
      )}
      {tab === "takimlar" && renderGroups("team")}
      {tab === "gruplar" && renderGroups("community")}
    </main>
  );
}

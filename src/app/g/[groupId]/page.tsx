import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { formatDate, getGroupPlayers, getGroupStats, statsFor, POSITION_LABEL } from "@/lib/data";
import { Badge, Card, Header, LinkButton, SectionTitle } from "@/components/ui";
import { OvrBadge } from "@/components/PlayerCard";
import { InviteLink } from "./InviteLink";

const STATUS: Record<string, { label: string; tone: "default" | "accent" | "warn" }> = {
  planned: { label: "Planlandı", tone: "default" },
  voting: { label: "Oylama açık", tone: "warn" },
  closed: { label: "Tamamlandı", tone: "accent" },
};

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, invite_code")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();

  await finalizeExpired(groupId);

  const [players, stats, { data: matches }] = await Promise.all([
    getGroupPlayers(supabase, groupId),
    getGroupStats(supabase, groupId),
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, match_players(count)")
      .eq("group_id", groupId)
      .order("played_at", { ascending: false })
      .limit(20),
  ]);

  const ranked = [...players].sort(
    (a, b) =>
      Number(b.matches_played > 0) - Number(a.matches_played > 0) ||
      b.overall - a.overall ||
      a.display_name.localeCompare(b.display_name, "tr"),
  );
  const active = (matches ?? []).filter((m) => m.status !== "closed");
  const recent = (matches ?? []).filter((m) => m.status === "closed").slice(0, 8);

  const leader = (key: "goals" | "assists" | "mvps") =>
    players
      .map((p) => ({ p, v: statsFor(stats, p.id)[key] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)[0];
  const leaders = [
    { label: "Gol kralı", icon: "⚽", x: leader("goals") },
    { label: "Asist kralı", icon: "🎯", x: leader("assists") },
    { label: "En çok MVP", icon: "⭐", x: leader("mvps") },
  ].filter((l) => l.x);

  return (
    <main>
      <Header
        title={group.name}
        back="/"
        right={
          <LinkButton href={`/g/${groupId}/players`} variant="ghost">
            Oyuncular
          </LinkButton>
        }
      />

      <LinkButton href={`/g/${groupId}/matches/new`} className="w-full">
        + Yeni maç
      </LinkButton>

      {active.length > 0 && (
        <>
          <SectionTitle>Aktif maçlar</SectionTitle>
          <ul className="space-y-2">
            {active.map((m) => (
              <li key={m.id}>
                <Link href={`/g/${groupId}/m/${m.id}`}>
                  <Card className="flex items-center justify-between transition hover:border-accent/50">
                    <div>
                      <div className="font-semibold">{formatDate(m.played_at)}</div>
                      <div className="text-xs text-muted">
                        {m.venue ?? "Saha belirtilmedi"} · {m.match_players[0]?.count ?? 0} oyuncu
                      </div>
                    </div>
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Sıralama</SectionTitle>
      <Card className="p-0">
        <ol className="divide-y divide-line">
          {ranked.map((p, i) => {
            const s = statsFor(stats, p.id);
            return (
              <li key={p.id}>
                <Link
                  href={`/g/${groupId}/p/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-pitch-800"
                >
                  <span className="w-5 text-right text-sm font-bold text-muted">{i + 1}</span>
                  <OvrBadge overall={p.overall} className={p.matches_played === 0 ? "opacity-50" : ""} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {p.display_name}
                      {!p.user_id && <span className="ml-2 text-xs text-muted">misafir</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {p.position ? POSITION_LABEL[p.position] + " · " : ""}
                      {s.played} maç · {s.goals} gol · {s.assists} asist
                      {s.mvps > 0 && ` · ${s.mvps}⭐`}
                    </div>
                  </div>
                  {p.matches_played > 0 && p.confidence < 0.6 && <Badge>geçici</Badge>}
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      {leaders.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {leaders.map((l) => (
            <Card key={l.label} className="p-3 text-center">
              <div className="text-xl">{l.icon}</div>
              <div className="mt-1 truncate text-sm font-semibold">{l.x!.p.display_name}</div>
              <div className="text-xs text-muted">
                {l.label} · {l.x!.v}
              </div>
            </Card>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle>Son maçlar</SectionTitle>
          <ul className="space-y-2">
            {recent.map((m) => (
              <li key={m.id}>
                <Link href={`/g/${groupId}/m/${m.id}`}>
                  <Card className="flex items-center justify-between py-3 transition hover:border-accent/50">
                    <div className="text-sm">
                      <div>{formatDate(m.played_at)}</div>
                      <div className="text-xs text-muted">{m.venue ?? ""}</div>
                    </div>
                    <div className="text-lg font-black tabular-nums">
                      <span className="text-team-a">{m.score_a}</span>
                      <span className="mx-1 text-muted">-</span>
                      <span className="text-team-b">{m.score_b}</span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Arkadaşlarını davet et</SectionTitle>
      <Card>
        <InviteLink code={group.invite_code} groupName={group.name} />
      </Card>
    </main>
  );
}

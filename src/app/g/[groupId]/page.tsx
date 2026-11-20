import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { byRanking, formatDate, getGroupSummaries, POSITION_LABEL } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { ROLE_LABEL, teamRating, type GroupKind, type Role } from "@/lib/teams-data";
import { TeamBadge } from "@/components/TeamBadge";
import { Badge, Card, Header, LinkButton, SectionTitle } from "@/components/ui";
import { OvrBadge, initials } from "@/components/PlayerCard";
import { InviteLink } from "./InviteLink";
import { regenerateInvite } from "@/lib/actions";

const STATUS: Record<string, { label: string; tone: "default" | "accent" | "warn" }> = {
  planned: { label: "Planlandı", tone: "default" },
  voting: { label: "Oylama açık", tone: "warn" },
  closed: { label: "Tamamlandı", tone: "accent" },
};

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { supabase, user } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, kind, city, district, color, description")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();
  const isTeam = group.kind === "team";
  const labels = ROLE_LABEL[group.kind as GroupKind];

  await finalizeExpired(groupId);

  const [players, { data: matches }, { data: inviteCode }, { data: polls }] = await Promise.all([
    getGroupSummaries(supabase, groupId),
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, kind, opponent_name, match_players(count)")
      .eq("group_id", groupId)
      .order("played_at", { ascending: false })
      .limit(50),
    supabase.rpc("group_invite_code", { p_group_id: groupId }),
    supabase
      .from("match_polls")
      .select("id, starts_at, venue, capacity, status, deadline, poll_responses(player_id, answer)")
      .eq("group_id", groupId)
      .eq("status", "open")
      .order("starts_at")
      .limit(10),
  ]);

  const me = players.find((p) => p.user_id === user.id);
  const myRole = (me?.role ?? null) as Role | null;
  const canManage = myRole === "captain" || myRole === "admin";
  const ranked = [...players].sort(byRanking);
  const active = (matches ?? []).filter((m) => m.status !== "closed");
  const recent = (matches ?? []).filter((m) => m.status === "closed").slice(0, 8);
  const rating = teamRating(players.map((p) => p.overall));

  // Takımın rakiplere karşı karnesi
  const ext = (matches ?? []).filter((m) => m.status === "closed" && m.kind === "external");
  const record = {
    w: ext.filter((m) => (m.score_a ?? 0) > (m.score_b ?? 0)).length,
    d: ext.filter((m) => (m.score_a ?? 0) === (m.score_b ?? 0)).length,
    l: ext.filter((m) => (m.score_a ?? 0) < (m.score_b ?? 0)).length,
  };
  const staff = players.filter((p) => p.role !== "member").sort((a, b) => (a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0));

  const leader = (key: "goals" | "assists" | "mvps") =>
    players
      .map((p) => ({ p, v: p.totals[key] }))
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
        title=""
        back="/"
        right={
          canManage ? (
            <LinkButton href={`/g/${groupId}/players`} variant="ghost" aria-label="Yönet">
              ⚙︎ Yönet
            </LinkButton>
          ) : undefined
        }
      />

      <div className="-mt-2 mb-5 flex items-center gap-4">
        <TeamBadge name={group.name} color={group.color} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted">{isTeam ? "🛡️ Takım" : "👥 Topluluk"}</div>
          <h1 className="truncate text-2xl font-black">{group.name}</h1>
          <div className="text-xs text-muted">
            {group.city && `${formatRegion(group.city, group.district)} · `}
            {players.length} {isTeam ? "oyuncu" : "üye"}
            {myRole && ` · Sen: ${labels[myRole]}`}
          </div>
        </div>
        {isTeam && (
          <div className="text-center">
            <OvrBadge overall={rating} className="h-12 w-12 text-lg" />
            <div className="mt-1 text-[10px] text-muted">takım</div>
          </div>
        )}
      </div>
      {group.description && <p className="-mt-2 mb-4 text-sm text-muted">{group.description}</p>}

      {!isTeam && (
        <Link href={`/g/${groupId}/players`} className="mb-4 flex items-center gap-3">
          <div className="flex -space-x-2">
            {players
              .filter((p) => p.user_id)
              .slice(0, 8)
              .map((p) => (
                <span
                  key={p.id}
                  title={p.display_name}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-pitch-950 bg-pitch-700 text-[11px] font-bold"
                >
                  {initials(p.display_name)}
                </span>
              ))}
          </div>
          <span className="text-sm text-muted">
            {players.filter((p) => p.user_id).length} üye
            {players.length - players.filter((p) => p.user_id).length > 0 &&
              ` · ${players.length - players.filter((p) => p.user_id).length} misafir`}{" "}
            ›
          </span>
        </Link>
      )}

      {isTeam && (
        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {[
            { v: record.w + record.d + record.l, l: "Maç" },
            { v: record.w, l: "Galibiyet", c: "text-accent" },
            { v: record.d, l: "Beraberlik" },
            { v: record.l, l: "Mağlubiyet", c: "text-red-300" },
          ].map((x) => (
            <Card key={x.l} className="p-2">
              <div className={"text-xl font-black " + (x.c ?? "")}>{x.v}</div>
              <div className="text-[10px] text-muted">{x.l}</div>
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <LinkButton href={`/g/${groupId}/cagri/yeni`}>📣 Maç çağrısı</LinkButton>
          <LinkButton href={`/g/${groupId}/matches/new`} variant="secondary">
            {isTeam ? "+ Maç kur" : "+ Doğrudan maç"}
          </LinkButton>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <LinkButton href={`/g/${groupId}/kadro`} variant="secondary">
          🃏 {isTeam ? "Kadro" : "Üye kartları"}
        </LinkButton>
        <LinkButton href={`/g/${groupId}/players`} variant="secondary">
          {isTeam ? "👥 Oyuncular" : "👥 Üyeler"}
        </LinkButton>
      </div>

      {(polls ?? []).length > 0 && (
        <>
          <SectionTitle>{isTeam ? "Maç çağrıları" : "Yaklaşan etkinlikler"}</SectionTitle>
          <div className="space-y-2">
            {(polls ?? []).map((poll) => {
              const yes = poll.poll_responses.filter((r) => r.answer === "yes").length;
              const mine = poll.poll_responses.find((r) => r.player_id === me?.id)?.answer;
              return (
                <Link key={poll.id} href={`/g/${groupId}/cagri/${poll.id}`}>
                  <Card className="flex items-center gap-3 border-accent/30 transition hover:border-accent">
                    <span className="text-2xl">📣</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{formatDate(poll.starts_at)}</div>
                      <div className="truncate text-xs text-muted">
                        {poll.venue ?? "Saha belirtilmedi"} · {yes}/{poll.capacity} geliyor
                      </div>
                    </div>
                    {mine === "yes" ? (
                      <Badge tone="accent">Geliyorsun</Badge>
                    ) : mine === "maybe" ? (
                      <Badge tone="warn">Belki</Badge>
                    ) : mine === "no" ? (
                      <Badge>Gelmiyorsun</Badge>
                    ) : me ? (
                      <Badge tone="warn">Yanıtla</Badge>
                    ) : null}
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
      {!me && isTeam && (
        <p className="mt-3 text-center text-xs text-muted">
          Bu takımın oyuncusu değilsin. Katılmak için kaptandan davet linki iste.
        </p>
      )}
      {me && !canManage && (
        <p className="mt-2 text-center text-xs text-muted">Maçları {isTeam ? "kaptan ve yetkililer" : "kurucu ve yetkililer"} kurar.</p>
      )}

      {staff.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {staff.map((p) => (
            <Link key={p.id} href={`/g/${groupId}/p/${p.id}`}>
              <Badge tone={p.role === "captain" ? "warn" : "default"}>
                {p.role === "captain" ? (isTeam ? "© " : "★ ") : ""}
                {labels[p.role as Role]}: {p.display_name}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <>
          <SectionTitle>Aktif maçlar</SectionTitle>
          <ul className="space-y-2">
            {active.map((m) => (
              <li key={m.id}>
                <Link href={`/g/${groupId}/m/${m.id}`}>
                  <Card className="flex items-center justify-between transition hover:border-accent/50">
                    <div>
                      <div className="font-semibold">
                        {m.kind === "external" ? `vs ${m.opponent_name}` : formatDate(m.played_at)}
                      </div>
                      <div className="text-xs text-muted">
                        {m.kind === "external" && `${formatDate(m.played_at)} · `}
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

      <SectionTitle
        action={
          !isTeam && ranked.length > 5 ? (
            <LinkButton href={`/g/${groupId}/kadro`} variant="ghost" className="min-h-8 px-2 text-accent">
              Tümü ›
            </LinkButton>
          ) : undefined
        }
      >
        {isTeam ? "Kadro sıralaması" : "Topluluk sıralaması"}
      </SectionTitle>
      <Card className="p-0">
        <ol className="divide-y divide-line">
          {(isTeam ? ranked : ranked.slice(0, 5)).map((p, i) => {
            const s = p.totals;
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
                      <div>{m.kind === "external" ? `vs ${m.opponent_name}` : "Kendi aramızda"}</div>
                      <div className="text-xs text-muted">
                        {formatDate(m.played_at)}
                        {m.venue ? ` · ${m.venue}` : ""}
                      </div>
                    </div>
                    {m.kind === "external" ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "rounded-md px-1.5 py-0.5 text-xs font-bold " +
                            ((m.score_a ?? 0) > (m.score_b ?? 0)
                              ? "bg-accent/20 text-accent"
                              : (m.score_a ?? 0) < (m.score_b ?? 0)
                                ? "bg-red-400/20 text-red-300"
                                : "bg-pitch-700 text-muted")
                          }
                        >
                          {(m.score_a ?? 0) > (m.score_b ?? 0) ? "G" : (m.score_a ?? 0) < (m.score_b ?? 0) ? "M" : "B"}
                        </span>
                        <span className="text-lg font-black tabular-nums">
                          {m.score_a} - {m.score_b}
                        </span>
                      </div>
                    ) : (
                      <div className="text-lg font-black tabular-nums">
                        <span className="text-team-a">{m.score_a}</span>
                        <span className="mx-1 text-muted">-</span>
                        <span className="text-team-b">{m.score_b}</span>
                      </div>
                    )}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {inviteCode && (
        <>
          <SectionTitle>{isTeam ? "Takıma oyuncu davet et" : "Arkadaşlarını davet et"}</SectionTitle>
          <Card className="space-y-2">
            <InviteLink code={inviteCode} groupName={group.name} />
            {canManage && (
              <form action={regenerateInvite} className="text-right">
                <input type="hidden" name="groupId" value={groupId} />
                <button className="text-xs text-muted hover:text-white" title="Eski link çalışmaz olur">
                  Linki yenile
                </button>
              </form>
            )}
          </Card>
        </>
      )}
    </main>
  );
}

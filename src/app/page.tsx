import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { settleExpiredPolls } from "@/lib/polls";
import { formatDate } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { ROLE_LABEL, getMemberships, type Membership } from "@/lib/teams-data";
import { countIncoming } from "@/lib/challenges-data";
import { getMyApplications, getOpenListings } from "@/lib/listings-data";
import { FeaturedSections } from "@/components/FeaturedSections";
import { Badge, Card, ErrorNote, LinkButton, SectionTitle, cx } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { inList } from "@/lib/live";
import { OvrBadge, initials, tierOf } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";
import { SkillQueueBanner } from "@/components/SkillQueueBanner";
import { MenuControls } from "@/components/AppMenu";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; left?: string; deleted?: string }> }) {
  const { error, left, deleted } = await searchParams;
  const { supabase, user } = await requireUser();

  const [{ data: profile }, memberships] = await Promise.all([
    supabase.from("profiles").select("display_name, city, district").eq("id", user.id).single(),
    getMemberships(supabase, user.id),
  ]);

  const groupIds = memberships.map((m) => m.group.id);
  await Promise.all(groupIds.map((id) => finalizeExpired(id)));
  await Promise.all(groupIds.map((id) => settleExpiredPolls(id)));

  const [{ data: active }, { data: myVotes }, listings, { data: openPolls }, { data: unreadRows }] = await Promise.all([
    groupIds.length
      ? supabase
          .from("matches")
          .select("id, group_id, played_at, status, kind, opponent_name, voting_deadline, match_players(player_id)")
          .in("group_id", groupIds)
          .in("status", ["planned", "played", "voting"])
          .order("played_at")
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("votes")
      .select("match_id")
      .in("voter_id", memberships.map((m) => m.playerId)),
    profile?.city ? getOpenListings(supabase, { city: profile.city, limit: 3 }) : Promise.resolve([]),
    groupIds.length
      ? supabase
          .from("match_polls")
          .select("id, group_id, starts_at, venue, capacity, poll_responses(player_id, answer)")
          .in("group_id", groupIds)
          .eq("status", "open")
          .gt("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(10)
      : Promise.resolve({ data: [] as never[] }),
    supabase.rpc("unread_counts"),
  ]);
  const unread = new Map(((unreadRows ?? []) as { group_id: string; unread: number }[]).map((u) => [u.group_id, u.unread]));

  const adminTeamIds = memberships.filter((m) => m.group.kind === "team" && m.role !== "member").map((m) => m.group.id);
  const [incoming, myApplications] = await Promise.all([countIncoming(supabase, adminTeamIds), getMyApplications(supabase, user.id)]);

  // Ödünç oynadığım maçlar (takımın üyesi değilim, ama maçın kadrosundayım): oylamaya geçince oy vermem gerekir
  const { data: loanRows } = await supabase.from("group_players").select("id, group_id, groups(name)").eq("user_id", user.id).eq("is_loan", true);
  const loans = loanRows ?? [];
  await Promise.all([...new Set(loans.map((l) => l.group_id))].map((id) => finalizeExpired(id)));
  const loanIds = loans.map((l) => l.id);
  const [{ data: loanMatchRows }, { data: loanVoteRows }] = loanIds.length
    ? await Promise.all([
        supabase
          .from("match_players")
          .select("player_id, matches!inner(id, group_id, played_at, kind, opponent_name, status)")
          .in("player_id", loanIds)
          .eq("matches.status", "voting"),
        supabase.from("votes").select("match_id").in("voter_id", loanIds),
      ])
    : [{ data: [] }, { data: [] }];
  const loanVoted = new Set((loanVoteRows ?? []).map((v) => v.match_id));
  type LoanMatch = { id: string; group_id: string; played_at: string; kind: string; opponent_name: string | null; status: string };
  const loanToVote = (loanMatchRows ?? []).flatMap((r) => {
    const m = (Array.isArray(r.matches) ? r.matches[0] : r.matches) as LoanMatch | null;
    if (!m || loanVoted.has(m.id)) return [];
    const loan = loans.find((l) => l.id === r.player_id);
    const g = Array.isArray(loan?.groups) ? loan?.groups[0] : loan?.groups;
    return [{ ...m, teamName: (g as { name: string } | null | undefined)?.name ?? "Takım" }];
  });

  const voted = new Set((myVotes ?? []).map((v) => v.match_id));
  const myPlayerIds = new Set(memberships.map((m) => m.playerId));
  const byGroup = new Map(memberships.map((m) => [m.group.id, m]));
  const matches = (active ?? []).map((m) => ({
    ...m,
    group: byGroup.get(m.group_id)!.group,
    inRoster: m.match_players.some((p: { player_id: string }) => myPlayerIds.has(p.player_id)),
  }));
  // Yanıt vermediğim açık çağrılar
  const toAnswer = (openPolls ?? []).filter(
    (p) => !p.poll_responses.some((r: { player_id: string }) => myPlayerIds.has(r.player_id)),
  );
  const toVote = matches.filter((m) => m.status === "voting" && m.inRoster && !voted.has(m.id));
  const upcoming = matches.filter((m) => !toVote.includes(m));

  const teams = memberships.filter((m) => m.group.kind === "team");
  const groups = memberships.filter((m) => m.group.kind === "community");
  const best = memberships.reduce<number>((a, m) => Math.max(a, m.overall), DEFAULT_OVERALL);
  const totalMatches = memberships.reduce((a, m) => a + m.matchesPlayed, 0);
  const firstName = (profile?.display_name ?? "").split(" ")[0];

  return (
    <main className="pt-1">
      <div className="flex justify-end">
        <MenuControls className="-mr-2" />
      </div>
      <LiveRefresh
        watches={[
          { table: "listing_applications", filter: `user_id=eq.${user.id}` },
          ...(groupIds.length
            ? [
                { table: "matches", filter: inList("group_id", groupIds) },
                { table: "match_polls", filter: inList("group_id", groupIds) },
              ]
            : []),
          ...(adminTeamIds.length
            ? [
                { table: "match_challenges", filter: inList("to_group_id", adminTeamIds) },
                { table: "match_challenges", filter: inList("from_group_id", adminTeamIds) },
              ]
            : []),
        ]}
      />
      <ErrorNote message={error} />
      {left && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Gruptan ayrıldın. Geçmişin korunuyor; davet koduyla istediğin zaman geri dönebilirsin.</p>}
      {deleted && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-center text-sm text-accent">Silindi.</p>}

      {/* Karşılama + kişisel kart */}
      <Link href="/profil" className="mb-6 flex items-center gap-4">
        <div
          className={cx(
            "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br font-black",
            tierOf(best) === "gold"
              ? "from-gold-1 to-gold-2 text-[#3b2a05]"
              : tierOf(best) === "silver"
                ? "from-silver-1 to-silver-2 text-[#1f262d]"
                : "from-bronze-1 to-bronze-2 text-[#3a1d0a]",
          )}
        >
          <span className="text-2xl leading-none">{best}</span>
          <span className="text-[9px] uppercase opacity-70">{initials(profile?.display_name ?? "")}</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm text-muted">Merhaba</div>
          <div className="truncate text-2xl font-black">{firstName} 👋</div>
          <div className="text-xs text-muted">
            {formatRegion(profile?.city ?? null, profile?.district ?? null)} · {totalMatches} maç
          </div>
        </div>
      </Link>

      <SkillQueueBanner supabase={supabase} className="mb-3 block" />

      {/* Takımıma gelen maç teklifleri (kaptan/yetkili) */}
      {[...incoming].map(([groupId, count]) => (
        <Link key={groupId} href={`/g/${groupId}/teklifler`}>
          <Card className="mb-3 flex items-center gap-3 border-amber-400/40 bg-amber-400/10">
            <span className="text-2xl">🤝</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{count} maç teklifi yanıtını bekliyor</div>
              <div className="truncate text-xs text-muted">{byGroup.get(groupId)?.group.name}</div>
            </div>
            <span className="text-amber-300">›</span>
          </Card>
        </Link>
      ))}

      {/* Oyuncu ilanlarına başvurularım (ödünç oyuncu olarak) */}
      {myApplications.map((a) => (
        <Link key={a.listingId} href={a.status === "accepted" ? `/g/${a.groupId}/m/${a.matchId}` : `/ilan/${a.listingId}`}>
          <Card className={cx("mb-3 flex items-center gap-3", a.status === "accepted" ? "border-accent/40 bg-accent/10" : "border-line")}>
            <span className="text-2xl">{a.status === "accepted" ? "✅" : "⏳"}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {a.status === "accepted" ? `${a.team} seni maça aldı` : `${a.team} ilanına başvurun yanıt bekliyor`}
              </div>
              <div className="truncate text-xs text-muted">{formatDate(a.playedAt)}</div>
            </div>
            <span className="text-muted">›</span>
          </Card>
        </Link>
      ))}

      {/* Yanıt bekleyen maç çağrıları */}
      {toAnswer.map((p) => {
        const g = byGroup.get(p.group_id)!.group;
        const yes = p.poll_responses.filter((r: { answer: string }) => r.answer === "yes").length;
        return (
          <Link key={p.id} href={`/g/${p.group_id}/cagri/${p.id}`}>
            <Card className="mb-3 flex items-center gap-3 border-accent/40 bg-accent/10">
              <span className="text-2xl">📣</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Maça geliyor musun?</div>
                <div className="truncate text-xs text-muted">
                  {g.name} · {formatDate(p.starts_at)}
                  {p.venue ? ` · ${p.venue}` : ""} · {yes}/{p.capacity}
                </div>
              </div>
              <span className="text-accent">›</span>
            </Card>
          </Link>
        );
      })}

      {/* Ödünç oynadığım ve oylamaya geçen maçlar */}
      {loanToVote.map((m) => (
        <Link key={m.id} href={`/g/${m.group_id}/m/${m.id}`}>
          <Card className="mb-3 flex items-center gap-3 border-amber-400/40 bg-amber-400/10">
            <span className="text-2xl">🗳️</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Oyunu bekliyorlar!</div>
              <div className="truncate text-xs text-muted">
                {m.teamName} (ödünç) · {m.kind === "external" ? `vs ${m.opponent_name}` : "kendi aramızda"} · {formatDate(m.played_at)}
              </div>
            </div>
            <span className="text-amber-300">›</span>
          </Card>
        </Link>
      ))}

      {/* Oy bekleyen maçlar: en önemli eylem */}
      {toVote.map((m) => (
        <Link key={m.id} href={`/g/${m.group_id}/m/${m.id}`}>
          <Card className="mb-3 flex items-center gap-3 border-amber-400/40 bg-amber-400/10">
            <span className="text-2xl">🗳️</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Oyunu bekliyorlar!</div>
              <div className="truncate text-xs text-muted">
                {m.group.name} · {m.kind === "external" ? `vs ${m.opponent_name}` : "kendi aramızda"} · {formatDate(m.played_at)}
              </div>
            </div>
            <span className="text-amber-300">›</span>
          </Card>
        </Link>
      ))}

      {upcoming.length > 0 && (
        <>
          <SectionTitle>Yaklaşan maçlar</SectionTitle>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/g/${m.group_id}/m/${m.id}`} className="w-56 shrink-0">
                <Card className="h-full p-3 transition hover:border-accent/50">
                  <div className="flex items-center gap-2">
                    <TeamBadge name={m.group.name} color={m.group.color} size="sm" />
                    <span className="truncate text-sm font-semibold">{m.group.name}</span>
                  </div>
                  <div className="mt-2 text-sm">{m.kind === "external" ? `vs ${m.opponent_name}` : "Kendi aramızda"}</div>
                  <div className="text-xs text-muted">{formatDate(m.played_at)}</div>
                  <div className="mt-2">
                    {m.status === "voting" ? <Badge tone="warn">Oylama</Badge> : m.status === "played" ? <Badge tone="warn">Skor onayı</Badge> : m.inRoster ? <Badge tone="accent">Kadrodasın</Badge> : <Badge>Planlandı</Badge>}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionTitle
        action={
          <span className="flex items-center">
            <LinkButton href="/katil?tur=takim" variant="ghost" className="min-h-8 px-2 text-accent">Takıma katıl</LinkButton>
            <LinkButton href="/takim-kur" variant="ghost" className="min-h-8 px-2 text-accent">+ Kur</LinkButton>
          </span>
        }
      >
        Takımlarım
      </SectionTitle>
      {teams.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Henüz bir takımda değilsin. Takımını kur ya da kaptanından davet kodunu iste ve &quot;Takıma katıl&quot; ile gir.
        </Card>
      ) : (
        <div className="space-y-2">{teams.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} />)}</div>
      )}

      <SectionTitle
        action={
          <span className="flex items-center">
            <LinkButton href="/katil?tur=grup" variant="ghost" className="min-h-8 px-2 text-accent">Gruba katıl</LinkButton>
            <LinkButton href="/grup-kur" variant="ghost" className="min-h-8 px-2 text-accent">+ Kur</LinkButton>
          </span>
        }
      >
        Gruplarım
      </SectionTitle>
      {groups.length === 0 ? (
        <Card className="text-center text-sm text-muted">
          Gruplar arkadaş toplulukların içindir: kendi aranızda maç kurup puanlaşırsınız. Kurucudan davet kodunu iste ve &quot;Gruba katıl&quot; ile gir.
        </Card>
      ) : (
        <div className="space-y-2">{groups.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} />)}</div>
      )}

      <FeaturedSections city={profile?.city ?? null} />

      {listings.length > 0 && (
        <>
          <SectionTitle
            action={<LinkButton href={`/kesfet${profile?.city ? `?il=${encodeURIComponent(profile.city)}` : ""}`} variant="ghost" className="min-h-8 px-2 text-accent">Tümü ›</LinkButton>}
          >
            🔎 Oyuncu arayan takımlar
          </SectionTitle>
          <div className="space-y-2">
            {listings.map((l) => (
              <Link key={l.id} href={`/ilan/${l.id}`}>
                <Card className="flex items-center gap-3 border-amber-400/30 transition hover:border-amber-400">
                  <TeamBadge name={l.team.name} color={l.team.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{l.team.name} · {l.needed} oyuncu</div>
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
    </main>
  );
}

function MembershipRow({ m, unread }: { m: Membership; unread: number }) {
  const g = m.group;
  const role = ROLE_LABEL[g.kind][m.role];
  return (
    <Link href={`/g/${g.id}`}>
      <Card className="flex items-center gap-3 p-3 transition hover:border-accent/50">
        <span className="relative">
          <TeamBadge name={g.name} color={g.color} />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-pitch-900 bg-accent px-1 text-[10px] font-bold text-pitch-950" title={`${unread} okunmamış mesaj`}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{g.name}</div>
          <div className="text-xs text-muted">
            {g.kind === "team" ? `${formatRegion(g.city, g.district)} · ` : ""}
            {g.members} {g.kind === "team" ? "oyuncu" : "üye"}
            {m.role !== "member" && ` · ${role}`}
          </div>
        </div>
        {g.kind === "team" ? (
          <div className="text-right">
            <OvrBadge overall={g.rating} />
            <div className="mt-0.5 text-[10px] text-muted">takım</div>
          </div>
        ) : (
          <div className="text-right">
            <OvrBadge overall={m.overall} />
            <div className="mt-0.5 text-[10px] text-muted">senin</div>
          </div>
        )}
      </Card>
    </Link>
  );
}

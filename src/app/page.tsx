import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { callWhen, decisionDue, istanbulDate } from "@/lib/call-rules";
import { myOpenGatherCalls } from "@/lib/calls-data";
import { formatDate } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { ROLE_LABEL, getMemberships, type Membership } from "@/lib/teams-data";
import { countIncoming } from "@/lib/challenges-data";
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
    supabase.from("profiles").select("display_name, photo_url, city, district").eq("id", user.id).single(),
    getMemberships(supabase, user.id),
  ]);

  const groupIds = memberships.map((m) => m.group.id);
  await Promise.all(groupIds.map((id) => finalizeExpired(id)));
  // Günü geçen açık çağrılar kapanır (cron yok)
  await Promise.all(groupIds.map((id) => supabase.rpc("close_stale_polls", { p_group: id })));

  const today = istanbulDate();
  const [{ data: active }, { data: myVotes }, myCalls, { data: openPolls }, { data: unreadRows }, { data: myWaiting }] = await Promise.all([
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
    myOpenGatherCalls(supabase, user.id),
    groupIds.length
      ? supabase
          .from("match_polls")
          .select("id, group_id, purpose, play_on, starts_at, venue, capacity, poll_responses(user_id, answer)")
          .in("group_id", groupIds)
          .eq("status", "open")
          .gte("play_on", today)
          .order("play_on")
          .limit(10)
      : Promise.resolve({ data: [] as never[] }),
    supabase.rpc("unread_counts"),
    // "Geliyorum" dediğim ve organizatörün kararını beklediğim / yedekte olduğum çağrılar
    supabase
      .from("poll_responses")
      .select("status, match_polls!inner(id, group_id, purpose, status, play_on, starts_at, groups(name))")
      .eq("user_id", user.id)
      .eq("answer", "yes")
      .or("status.is.null,status.eq.reserve")
      .in("match_polls.status", ["open", "filled", "converted"])
      .gte("match_polls.play_on", today)
      .limit(10),
  ]);
  const unread = new Map(((unreadRows ?? []) as { group_id: string; unread: number }[]).map((u) => [u.group_id, u.unread]));

  const adminTeamIds = memberships.filter((m) => m.group.kind === "team" && m.role !== "member").map((m) => m.group.id);
  const incoming = await countIncoming(supabase, adminTeamIds);

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
  const toAnswer = (openPolls ?? []).filter((p) => !p.poll_responses.some((r: { user_id: string }) => r.user_id === user.id));
  type WaitingCall = { id: string; group_id: string; purpose: string; status: string; play_on: string; starts_at: string | null; groups: { name: string } | { name: string }[] | null };
  const waiting = (myWaiting ?? []).flatMap((w) => {
    const c = (Array.isArray(w.match_polls) ? w.match_polls[0] : w.match_polls) as WaitingCall | null;
    // Açık toplama çağrısında beklemek olağan (organizatör kesinleştirecek); sadece yedek ve adam arama başvurusu gösterilir
    if (!c || (c.purpose === "gather" && c.status === "open")) return [];
    const g = Array.isArray(c.groups) ? c.groups[0] : c.groups;
    return [{ ...c, reserve: w.status === "reserve", groupName: g?.name ?? "" }];
  });
  const dueCalls = myCalls.filter((c) => decisionDue(c));
  const toVote = matches.filter((m) => m.status === "voting" && m.inRoster && !voted.has(m.id));
  const upcoming = matches.filter((m) => !toVote.includes(m));

  // Geçici ve dağıtılmış takımlar ayrı, kapalı bölümde (Takımlarım kalabalıklaşmasın)
  const teams = memberships.filter((m) => m.group.kind === "team" && !m.group.temporary && !m.group.archived);
  const tempTeams = memberships.filter((m) => m.group.kind === "team" && (m.group.temporary || m.group.archived));
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
          { table: "poll_responses", filter: `user_id=eq.${user.id}` },
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
            "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl font-black",
            // fotoğraf varsa zemin yok (şeffaf kesim doğrudan sayfanın üstünde durur)
            !profile?.photo_url && "bg-gradient-to-br",
            tierOf(best) === "gold"
              ? "from-gold-1 to-gold-2 text-[#3b2a05]"
              : tierOf(best) === "silver"
                ? "from-silver-1 to-silver-2 text-[#1f262d]"
                : "from-bronze-1 to-bronze-2 text-[#3a1d0a]",
          )}
        >
          {profile?.photo_url ? (
            <div className="relative h-full w-full overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.photo_url} alt={profile.display_name ?? ""} className="h-full w-full object-contain object-bottom" draggable={false} />
              <span className="absolute bottom-0.5 left-0.5 rounded-md bg-black/55 px-1.5 py-0.5 text-xs leading-none text-white">{best}</span>
            </div>
          ) : (
            <>
              <span className="text-2xl leading-none">{best}</span>
              <span className="text-[9px] uppercase opacity-70">{initials(profile?.display_name ?? "")}</span>
            </>
          )}
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

      {/* Organizatör: kadro kararı zamanı gelen çağrılarım */}
      {dueCalls.map((c) => (
        <Link key={c.id} href={`/g/${c.group_id}/cagri/${c.id}?kesinlestir=1`}>
          <Card className="mb-3 flex items-center gap-3 border-amber-400/50 bg-amber-400/10">
            <span className="text-2xl">⏰</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Kadroyu kesinleştir</div>
              <div className="truncate text-xs text-muted">
                {c.group_name} · {callWhen(c)}
              </div>
            </div>
            <span className="text-amber-300">›</span>
          </Card>
        </Link>
      ))}

      {/* Yedekte olduğum veya adam aramaya başvurup kararı beklediğim çağrılar */}
      {waiting.map((w) => (
        <Link key={w.id} href={`/g/${w.group_id}/cagri/${w.id}`}>
          <Card className="mb-3 flex items-center gap-3 border-line">
            <span className="text-2xl">⏳</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{w.reserve ? "Yedektesin" : "Başvurun organizatörün kararını bekliyor"}</div>
              <div className="truncate text-xs text-muted">
                {w.groupName} · {callWhen(w)}
              </div>
            </div>
            <span className="text-muted">›</span>
          </Card>
        </Link>
      ))}

      {/* Yanıt bekleyen maç çağrıları */}
      {toAnswer.map((p) => {
        const g = byGroup.get(p.group_id)!.group;
        const yes = p.poll_responses.filter((r: { answer: string }) => r.answer === "yes").length;
        const fill = p.purpose === "fill";
        return (
          <Link key={p.id} href={`/g/${p.group_id}/cagri/${p.id}`}>
            <Card className="mb-3 flex items-center gap-3 border-accent/40 bg-accent/10">
              <span className="text-2xl">{fill ? "🔎" : "📣"}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{fill ? `${p.capacity} oyuncu aranıyor` : "Maça geliyor musun?"}</div>
                <div className="truncate text-xs text-muted">
                  {g.name} · {callWhen(p)}
                  {p.venue ? ` · ${p.venue}` : ""} · {yes} geliyor
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
      {tempTeams.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer py-2 text-sm text-muted">⏳ Geçici ve dağıtılmış takımlarım · {tempTeams.length}</summary>
          <div className="space-y-2">{tempTeams.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} />)}</div>
        </details>
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

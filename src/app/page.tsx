import { matchWhen, feeText, opponentLabel } from "@/lib/match-rules";
import { matchExtras } from "@/lib/listings-data";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { respondMatch } from "@/lib/match-actions";
import { formatDate, POSITION_NAME, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { DEFAULT_OVERALL } from "@/lib/rating";
import { cardDateTime, daysLeftLabel, rosterCapacity, tierProgress } from "@/lib/home";
import { ROLE_LABEL, canCreateMatch, getMemberships, type Membership } from "@/lib/teams-data";
import { countIncoming } from "@/lib/challenges-data";
import { FeaturedSections } from "@/components/FeaturedSections";
import { ErrorNote, LinkButton, SectionTitle, cx } from "@/components/ui";
import { UpcomingMatches, type UpcomingCard } from "@/components/home/UpcomingMatches";
import { LiveRefresh } from "@/components/LiveRefresh";
import { inList } from "@/lib/live";
import { OvrBadge, initials, tierOf } from "@/components/PlayerCard";
import { TeamBadge } from "@/components/TeamBadge";
import { SkillQueueBanner } from "@/components/SkillQueueBanner";
import { MenuControls } from "@/components/AppMenu";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { istanbulDate } from "@/lib/call-rules";
import { ActionItem } from "@/components/home/ActionItem";
import { HomeTabs } from "@/components/home/HomeTabs";

/** Yapılacaklar kutusunda açık görünen satır sayısı; gerisi "+n daha" altında */
const VISIBLE_ACTIONS = 3;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; left?: string; deleted?: string }> }) {
  const { error, left, deleted } = await searchParams;
  const { supabase, user } = await requireUser();

  const [{ data: profile }, memberships] = await Promise.all([
    supabase.from("profiles").select("display_name, photo_url, city, district").eq("id", user.id).single(),
    getMemberships(supabase, user.id),
  ]);

  const groupIds = memberships.map((m) => m.group.id);
  await Promise.all(groupIds.map((id) => finalizeExpired(id)));
  const [{ data: active }, { data: myVotes }, { data: unreadRows }, { data: myEntryRows }, { data: listingRows }] = await Promise.all([
    groupIds.length
      ? supabase
          .from("matches")
          .select("id, group_id, played_at, status, kind, opponent_name, venue, team_size, voting_deadline, capacity, time_tbd, open_to_members, created_by, roster_count, match_players(player_id)")
          .in("group_id", groupIds)
          .in("status", ["gathering", "planned", "played", "voting"])
          .order("played_at")
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("votes")
      .select("match_id")
      .in("voter_id", memberships.map((m) => m.playerId)),
    supabase.rpc("unread_counts"),
    // Maç kayıtlarım (yeni yapı): yedek, başvuru, davet; açık maçlarda
    supabase
      .from("match_entries")
      .select("match_id, status, matches!inner(id, group_id, played_at, time_tbd, status, groups!matches_group_id_fkey(name))")
      .eq("user_id", user.id)
      .in("matches.status", ["gathering", "planned"])
      .limit(40),
    // Üyesi olduğum gruplara açılmış ilanlar (Keşfet ilanları ana sayfada yok: kullanıcı kararı 2026-11-25)
    groupIds.length
      ? supabase.from("match_listings").select("id, match_id, positions").in("target_group_id", groupIds).eq("status", "active").limit(10)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const unread = new Map(((unreadRows ?? []) as { group_id: string; unread: number }[]).map((u) => [u.group_id, u.unread]));

  const adminTeamIds = memberships.filter((m) => m.group.kind === "team" && m.role !== "member").map((m) => m.group.id);
  // Yönettiğim gruplardaki bekleyen istekler (katılma, ilan onayı, öneri, başvuru; 0044); teklif sayısıyla aynı anda
  const managedIds = memberships.filter((m) => m.role !== "member").map((m) => m.group.id);
  const [incoming, { data: pendingRows }] = await Promise.all([
    countIncoming(supabase, adminTeamIds),
    managedIds.length ? supabase.rpc("my_pending_counts") : Promise.resolve({ data: [] }),
  ]);
  const pendingByGroup = ((pendingRows ?? []) as { group_id: string; group_name: string; joins: number; listings: number; proposals: number; applications: number }[])
    .map((r) => ({
      ...r,
      parts: [
        r.joins && `${r.joins} katılma isteği`,
        r.listings && `${r.listings} ilan onayı`,
        r.proposals && `${r.proposals} maç önerisi`,
        r.applications && `${r.applications} başvuru`,
      ].filter(Boolean) as string[],
    }))
    .filter((r) => r.parts.length > 0);

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
    return [{ ...m, teamName: `${(g as { name: string } | null | undefined)?.name ?? "Takım"} (ödünç)` }];
  });

  const voted = new Set((myVotes ?? []).map((v) => v.match_id));
  const myPlayerIds = new Set(memberships.map((m) => m.playerId));
  const byGroup = new Map(memberships.map((m) => [m.group.id, m]));
  const matches = (active ?? []).map((m) => ({
    ...m,
    group: byGroup.get(m.group_id)!.group,
    inRoster: m.match_players.some((p: { player_id: string }) => myPlayerIds.has(p.player_id)),
  }));

  // Yeni maç yapısı: kayıtlarım, yanıt bekleyen toplanan maçlar, kesinleştirilecekler, gruplarıma açılan ilanlar
  type EntryMatch = { id: string; group_id: string; played_at: string; time_tbd: boolean; status: string; groups: { name: string } | { name: string }[] | null };
  const myEntries = (myEntryRows ?? []).flatMap((e) => {
    const m = (Array.isArray(e.matches) ? e.matches[0] : e.matches) as EntryMatch | null;
    if (!m) return [];
    const g = Array.isArray(m.groups) ? m.groups[0] : m.groups;
    return [{ ...m, entry: e.status as string, groupName: g?.name ?? "" }];
  });
  const entryOf = new Map(myEntries.map((e) => [e.id, e.entry]));
  const isManager = (m: { group_id: string; created_by: string | null }) => m.created_by === user.id || ["captain", "admin"].includes(byGroup.get(m.group_id)?.role ?? "");
  const nowMs = Date.now();
  const notPassed = (m: { played_at: string; time_tbd: boolean }) =>
    m.time_tbd ? istanbulDate(new Date(m.played_at).getTime()) >= istanbulDate(nowMs) : new Date(m.played_at).getTime() > nowMs;
  const toAnswer = matches.filter((m) => m.status === "gathering" && m.open_to_members && !entryOf.has(m.id) && !m.inRoster && notPassed(m));
  const invited = myEntries.filter((e) => e.entry === "invited");
  const waiting = myEntries.filter((e) => e.entry === "reserve" || e.entry === "pending");
  const dueConfirm = matches.filter(
    (m) => m.status === "gathering" && isManager(m) && ((m.capacity && m.roster_count >= m.capacity) || istanbulDate(new Date(m.played_at).getTime()) === istanbulDate(nowMs)),
  );
  const listingIds = [...new Set((listingRows ?? []).map((l) => l.match_id as string))].filter((id) => !entryOf.has(id) && !matches.some((m) => m.id === id && m.inRoster));
  const { data: listingOverview } = listingIds.length ? await supabase.rpc("match_overview", { p_ids: listingIds }) : { data: [] };
  type Overview = { match_id: string; group_id: string; group_name: string; played_at: string; time_tbd: boolean; capacity: number | null; roster_count: number; positions: string[]; my_status: string | null };
  const lookingFor = ((listingOverview ?? []) as Overview[]).filter((o) => !o.my_status && (o.capacity ?? 0) > o.roster_count);

  const extras = await matchExtras(supabase, [...matches.map((m) => m.id), ...invited.map((e) => e.id), ...lookingFor.map((o) => o.match_id)]);
  /** Karar verirken görülsün: rakip (onay bekliyorsa belirtilir) ve ücret */
  const extraText = (id: string, opponent?: string | null) => {
    const x = extras.get(id);
    return [opponentLabel(opponent, x?.pendingRival), x?.fee ? feeText(x.fee) : null].filter(Boolean).join(" · ");
  };

  const toVote = matches.filter((m) => m.status === "voting" && m.inRoster && !voted.has(m.id));
  const upcoming = matches.filter((m) => !toVote.includes(m));
  // Grup satırında "sıradaki maç": grubun ilk planlı maçı
  const nextByGroup = new Map<string, string>();
  for (const m of upcoming) if (m.status === "planned" && !nextByGroup.has(m.group_id)) nextByGroup.set(m.group_id, m.played_at);

  // Geçici ve dağıtılmış takımlar ayrı, kapalı bölümde (Takımlarım kalabalıklaşmasın)
  const teams = memberships.filter((m) => m.group.kind === "team" && !m.group.temporary && !m.group.archived);
  const tempTeams = memberships.filter((m) => m.group.kind === "team" && (m.group.temporary || m.group.archived));
  const groups = memberships.filter((m) => m.group.kind === "community");
  const managed = memberships.filter((m) => canCreateMatch(m.role) && !m.group.archived);
  const best = memberships.reduce<number>((a, m) => Math.max(a, m.overall), DEFAULT_OVERALL);
  const tier = tierProgress(best);
  const totalMatches = memberships.reduce((a, m) => a + m.matchesPlayed, 0);
  const firstName = (profile?.display_name ?? "").split(" ")[0];
  const vsText = (m: { kind: string; opponent_name: string | null }) => (m.kind === "external" ? `vs ${m.opponent_name ?? "?"}` : "kendi aramızda");
  const quick = (groupId: string, matchId: string) => (
    // Ana sayfadan hızlı yanıt; mevki/not için maç ekranı
    <form action={respondMatch} className="flex gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="returnTo" value="/" />
      <SubmitButton name="answer" value="yes" pendingLabel="…" className="min-h-10 flex-1">Geliyorum</SubmitButton>
      <SubmitButton name="answer" value="no" variant="secondary" pendingLabel="…" className="min-h-10 flex-1">Gelemem</SubmitButton>
    </form>
  );

  // Yaklaşan maç kartları: boş bilgiler de "belli değil" / "-" olarak görünür
  const cards: UpcomingCard[] = upcoming.map((m) => {
    const x = extras.get(m.id);
    const capacity = m.capacity ?? rosterCapacity(m.team_size, m.kind);
    const count = m.match_players.length;
    const status: UpcomingCard["status"] =
      m.status === "voting"
        ? { label: "Oylama", icon: "how_to_vote", tone: "warn" }
        : m.status === "played"
          ? { label: "Skor onayı", icon: "scoreboard", tone: "warn" }
          : m.inRoster
            ? { label: "Kadrodasın", icon: "check_circle", tone: "on" }
            : m.status === "gathering"
              ? { label: "Toplanıyor", icon: "group_add", tone: "warn" }
              : { label: "Planlandı", icon: null, tone: "neutral" };
    const past = m.status === "voting" || m.status === "played";
    return {
      id: m.id,
      href: `/g/${m.group_id}/m/${m.id}`,
      status,
      days: past ? "Oynandı" : (daysLeftLabel(m.played_at) ?? "Tarihi geçti"),
      title: m.kind === "external" ? `${m.group.name} vs ${m.opponent_name ?? x?.pendingRival ?? "Belli değil"}` : `${m.group.name} · Kendi aramızda`,
      ...cardDateTime(m.played_at, m.time_tbd),
      venue: m.venue || "Saha: -",
      fee: x?.fee ? feeText(x.fee) : "Ücret: -",
      pendingRival: !m.opponent_name && !!x?.pendingRival,
      count,
      capacity,
      tactics: m.status === "planned" && !!capacity && count >= capacity,
    };
  });

  // Yapılacaklar: önem sırasıyla (oy > kesinleştir > teklif > bekleyen istekler > çağrıldın > geliyor musun > adam aranıyor > bekleyiş)
  const actions: { key: string; node: ReactNode }[] = [
    ...[...loanToVote.map((m) => ({ ...m, groupName: m.teamName })), ...toVote.map((m) => ({ ...m, groupName: m.group.name }))].map((m) => ({
      key: `v${m.id}`,
      node: (
        <ActionItem href={`/g/${m.group_id}/m/${m.id}`} icon="how_to_vote" tone="amber" cta="Oy ver" title="Oyunu bekliyorlar!" sub={`${m.groupName} · ${vsText(m)} · ${formatDate(m.played_at)}`} />
      ),
    })),
    ...dueConfirm.map((m) => ({
      key: `d${m.id}`,
      node: (
        <ActionItem
          href={`/g/${m.group_id}/m/${m.id}`}
          icon="alarm"
          tone="amber"
          title={m.capacity && m.roster_count >= m.capacity ? "Kadro tamam, maçı kesinleştir" : "Maç bugün, kadro eksik"}
          sub={`${m.group.name} · ${m.roster_count}/${m.capacity ?? "?"} · ${matchWhen(m.played_at, m.time_tbd)}`}
        />
      ),
    })),
    ...[...incoming].map(([groupId, count]) => ({
      key: `t${groupId}`,
      node: <ActionItem href={`/g/${groupId}/teklifler`} icon="handshake" tone="blue" title={`${count} maç teklifi yanıtını bekliyor`} sub={byGroup.get(groupId)?.group.name} />,
    })),
    ...pendingByGroup.map((r) => ({
      key: `p${r.group_id}`,
      node: <ActionItem href={`/g/${r.group_id}/istekler`} icon="inbox" tone="blue" title={r.parts.join(", ")} sub={r.group_name} />,
    })),
    ...invited.map((e) => ({
      key: `i${e.id}`,
      node: (
        <ActionItem href={`/g/${e.group_id}/m/${e.id}`} icon="mail" tone="green" title="Maça çağrıldın" sub={`${e.groupName} · ${matchWhen(e.played_at, e.time_tbd)}`} note={extraText(e.id, matches.find((m) => m.id === e.id)?.opponent_name)}>
          {quick(e.group_id, e.id)}
        </ActionItem>
      ),
    })),
    ...toAnswer.map((m) => ({
      key: `a${m.id}`,
      node: (
        <ActionItem
          href={`/g/${m.group_id}/m/${m.id}`}
          icon="campaign"
          tone="green"
          title="Maça geliyor musun?"
          sub={`${m.group.name} · ${matchWhen(m.played_at, m.time_tbd)}${m.venue ? ` · ${m.venue}` : ""} · ${m.roster_count}/${m.capacity ?? "?"}`}
          note={extraText(m.id, m.opponent_name)}
        >
          {quick(m.group_id, m.id)}
        </ActionItem>
      ),
    })),
    ...lookingFor.map((o) => ({
      key: `l${o.match_id}`,
      node: (
        <ActionItem
          href={`/g/${o.group_id}/m/${o.match_id}`}
          icon="person_search"
          tone="green"
          cta="Başvur"
          title={`${(o.capacity ?? 0) - o.roster_count} oyuncu aranıyor`}
          sub={`${o.group_name} · ${matchWhen(o.played_at, o.time_tbd)}${o.positions.length ? ` · ${o.positions.map((p) => POSITION_NAME[p as Position]).join(", ")}` : ""}`}
        />
      ),
    })),
    ...waiting.map((w) => ({
      key: `w${w.id}`,
      node: (
        <ActionItem
          href={`/g/${w.group_id}/m/${w.id}`}
          icon="hourglass_top"
          tone="neutral"
          title={w.entry === "reserve" ? "Yedektesin" : "Başvurun onay bekliyor"}
          sub={`${w.groupName} · ${matchWhen(w.played_at, w.time_tbd)}`}
        />
      ),
    })),
  ];
  const shown = actions.slice(0, VISIBLE_ACTIONS);
  const more = actions.slice(VISIBLE_ACTIONS);

  return (
    <main className="pt-1">
      <div className="flex justify-end">
        <MenuControls className="-mr-2" />
      </div>
      <LiveRefresh
        watches={[
          { table: "match_entries", filter: `user_id=eq.${user.id}` },
          ...(groupIds.length
            ? [
                { table: "matches", filter: inList("group_id", groupIds) },
                { table: "match_listings", filter: inList("target_group_id", groupIds) },
              ]
            : []),
          // Yönettiğim gruplara gelen katılma istekleri ve maç önerileri (yapılacaklar sayacı; 0048)
          ...(managedIds.length
            ? [
                { table: "group_join_requests", filter: inList("group_id", managedIds) },
                { table: "match_proposals", filter: inList("group_id", managedIds) },
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
      {left && <p className="mb-4 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary">Gruptan ayrıldın. Geçmişin korunuyor; davet koduyla istediğin zaman geri dönebilirsin.</p>}
      {deleted && <p className="mb-4 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary">Silindi.</p>}

      {/* Karşılama + kişisel kart */}
      <Link href="/profil" className="mb-3 flex items-center gap-4">
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
              <span className="font-display text-2xl leading-none">{best}</span>
              <span className="text-[9px] uppercase opacity-70">{initials(profile?.display_name ?? "")}</span>
            </>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-on-surface-variant">Merhaba</div>
          <div className="truncate font-display text-2xl font-bold">{firstName}</div>
          <div className="flex items-center gap-1 text-xs text-on-surface-variant">
            <Icon name="location_on" className="text-[14px] text-primary" />
            <span className="truncate">
              {formatRegion(profile?.city ?? null, profile?.district ?? null)} · {totalMatches} maç
            </span>
          </div>
        </div>
      </Link>

      {/* Seviye şeridi */}
      <Link href="/profil" className="mb-6 block rounded-xl border border-line bg-surface-low px-3.5 py-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-display text-sm font-bold">
            <Icon name="workspace_premium" fill className={cx("text-[18px]", tier.name === "Altın" ? "text-gold-1" : tier.name === "Gümüş" ? "text-silver-1" : "text-bronze-1")} />
            {tier.name} seviye
          </span>
          <span className="text-xs text-on-surface-variant">
            {tier.next ? (
              <>
                {tier.next === "Altın" ? "Altına" : "Gümüşe"} <strong className="font-display text-gold-1 tabular-nums">{tier.left} puan</strong>
              </>
            ) : (
              "En üst seviye"
            )}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-highest">
          <div className="h-full rounded-full bg-gradient-to-r from-silver-2 to-gold-1" style={{ width: `${tier.pct}%` }} />
        </div>
      </Link>

      <SkillQueueBanner supabase={supabase} className="mb-3" />

      {/* Yapılacaklar */}
      {actions.length > 0 && (
        <section className="mb-2">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-4 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <h2 className="font-display text-base font-bold uppercase tracking-wider">Yapılacaklar</h2>
            <span className="rounded-full bg-amber-400/15 px-2 font-display text-xs font-bold text-amber-300 tabular-nums">{actions.length}</span>
          </div>
          <div className="space-y-2">
            {shown.map((a) => (
              <div key={a.key}>{a.node}</div>
            ))}
          </div>
          {more.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center justify-center gap-1 py-2 text-sm font-semibold text-primary">
                +{more.length} daha
                <Icon name="expand_more" className="text-[18px] transition group-open:rotate-180" />
              </summary>
              <div className="space-y-2">
                {more.map((a) => (
                  <div key={a.key}>{a.node}</div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <UpcomingMatches matches={cards} />

      {/* Duruma göre eylem şeridi: yönettiğin yer varsa maç ayarla, hiçbir yerde değilsen kur/katıl */}
      {managed.length > 0 ? (
        <section className="mt-6 rounded-2xl bg-gradient-to-br from-primary-container to-[#00a572] p-4 text-on-primary">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-on-primary/15">
              <Icon name="sports_soccer" fill className="text-[24px]" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-base font-bold">Maç ayarla</div>
              <div className="text-xs font-medium">Üyeler &quot;geliyorum&quot; desin, eksik için adam ara, kadro tamamlanınca kesinleştir.</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {managed.slice(0, 4).map((m) => (
              <Link key={m.playerId} href={`/mac-ayarla?grup=${m.group.id}`} className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full bg-pitch-950 px-3.5 font-display text-[13px] font-bold text-primary">
                <Icon name="add" className="text-[16px]" />
                <span className="truncate">{m.group.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : memberships.length === 0 ? (
        <section className="mt-6 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-primary-container to-[#00a572] p-4 text-on-primary">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-bold">Sahaya çık</div>
            <div className="text-xs font-medium">Takımını kur ya da davet koduyla bir takıma katıl.</div>
          </div>
          <Link href="/takim-kur" className="shrink-0 rounded-full bg-pitch-950 px-4 py-2.5 font-display text-[13px] font-bold text-primary">
            Takım kur
          </Link>
        </section>
      ) : null}

      {/* Takımlarım / Gruplarım */}
      <SectionTitle>Takımlarım ve gruplarım</SectionTitle>
      <HomeTabs
        initial={teams.length || tempTeams.length || !groups.length ? "takim" : "grup"}
        tabs={[
          {
            key: "takim",
            label: `Takımlar · ${teams.length}`,
            content: (
              <>
                {teams.length === 0 ? (
                  <EmptyNote>Henüz bir takımda değilsin. Takımını kur ya da kaptanından davet kodunu iste ve &quot;Takıma katıl&quot; ile gir.</EmptyNote>
                ) : (
                  <div className="space-y-2">{teams.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} next={nextByGroup.get(m.group.id)} />)}</div>
                )}
                {tempTeams.length > 0 && (
                  <details className="mt-2">
                    <summary className="flex cursor-pointer items-center gap-1.5 py-2 text-sm text-on-surface-variant">
                      <Icon name="hourglass_top" className="text-[16px]" />
                      Geçici ve dağıtılmış takımlarım · {tempTeams.length}
                    </summary>
                    <div className="space-y-2">{tempTeams.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} next={nextByGroup.get(m.group.id)} />)}</div>
                  </details>
                )}
                <JoinLinks kind="takim" />
              </>
            ),
          },
          {
            key: "grup",
            label: `Gruplar · ${groups.length}`,
            content: (
              <>
                {groups.length === 0 ? (
                  <EmptyNote>Gruplar arkadaş toplulukların içindir: kendi aranızda maç kurup puanlaşırsınız. Kurucudan davet kodunu iste ve &quot;Gruba katıl&quot; ile gir.</EmptyNote>
                ) : (
                  <div className="space-y-2">{groups.map((m) => <MembershipRow key={m.playerId} m={m} unread={unread.get(m.group.id) ?? 0} next={nextByGroup.get(m.group.id)} />)}</div>
                )}
                <JoinLinks kind="grup" />
              </>
            ),
          },
        ]}
      />

      <FeaturedSections
        city={profile?.city || null}
        district={profile?.city ? profile.district || null : null}
        challengerTeamIds={memberships.filter((m) => m.group.kind === "team" && m.role !== "member" && !m.group.archived).map((m) => m.group.id)}
        myTeamIds={memberships.filter((m) => m.group.kind === "team").map((m) => m.group.id)}
      />
    </main>
  );
}

function JoinLinks({ kind }: { kind: "takim" | "grup" }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <LinkButton href={kind === "takim" ? "/takim-kur" : "/grup-kur"} variant="secondary" className="w-full gap-1.5">
        <Icon name="add" className="text-[18px]" />
        {kind === "takim" ? "Takım kur" : "Grup kur"}
      </LinkButton>
      <LinkButton href={`/katil?tur=${kind}`} variant="secondary" className="w-full gap-1.5">
        <Icon name="group_add" className="text-[18px]" />
        {kind === "takim" ? "Takıma katıl" : "Gruba katıl"}
      </LinkButton>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-line bg-surface-container p-4 text-center text-sm text-on-surface-variant">{children}</p>;
}

function MembershipRow({ m, unread, next }: { m: Membership; unread: number; next?: string }) {
  const g = m.group;
  const role = ROLE_LABEL[g.kind][m.role];
  return (
    <Link href={`/g/${g.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface-container p-3 transition hover:border-primary/50">
      <span className="relative">
        <TeamBadge name={g.name} color={g.color} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface-container bg-primary px-1 text-[10px] font-bold text-on-primary" title={`${unread} okunmamış mesaj`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{g.name}</div>
        <div className="truncate text-xs text-on-surface-variant">
          {g.kind === "team" ? `${formatRegion(g.city, g.district)} · ` : ""}
          {g.members} {g.kind === "team" ? "oyuncu" : "üye"}
          {m.role !== "member" && ` · ${role}`}
        </div>
        {next && (
          <div className="flex items-center gap-1 text-xs text-tertiary">
            <Icon name="schedule" className="text-[14px]" />
            Sıradaki maç: {formatDate(next)}
          </div>
        )}
      </div>
      <div className="text-right">
        <OvrBadge overall={g.kind === "team" ? g.rating : m.overall} />
        <div className="mt-0.5 text-[10px] text-on-surface-variant">{g.kind === "team" ? "takım" : "senin"}</div>
      </div>
    </Link>
  );
}

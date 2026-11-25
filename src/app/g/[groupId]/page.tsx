import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { decideListing } from "@/lib/match-manage-actions";
import { matchWhen } from "@/lib/match-rules";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { finalizeExpired } from "@/lib/finalize";
import { byRanking, formatDate, getGroupSummaries, isGuestLike, isSquadMember, POSITION_LABEL } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { ROLE_LABEL, canCreateMatch, teamRating, type GroupKind, type Role } from "@/lib/teams-data";
import { TeamBadge } from "@/components/TeamBadge";
import { RosterTabs } from "@/components/RosterTabs";
import { Badge, Button, Card, Header, LinkButton, SectionTitle, cx } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { OvrBadge } from "@/components/PlayerCard";
import { Avatar } from "@/components/Avatar";
import { InviteLink } from "./InviteLink";
import { openDm, regenerateInvite } from "@/lib/actions";
import { countIncoming } from "@/lib/challenges-data";
import { LiveRefresh } from "@/components/LiveRefresh";
import { MuteToggle, Proposals, TeamStateBanner, type Proposal } from "./GroupExtras";

const STATUS: Record<string, { label: string; tone: "default" | "accent" | "warn" }> = {
  gathering: { label: "Toplanıyor", tone: "warn" },
  planned: { label: "Planlandı", tone: "default" },
  played: { label: "Skor onayı", tone: "warn" },
  voting: { label: "Oylama açık", tone: "warn" },
  closed: { label: "Tamamlandı", tone: "accent" },
};

interface PendingListing {
  id: string;
  group_name: string;
  played_at: string;
  time_tbd: boolean;
  venue: string | null;
  capacity: number | null;
  roster_count: number;
  note: string | null;
  by: string | null;
}

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ sekme?: string; oner?: string; oneri?: string }>;
}) {
  const { groupId } = await params;
  const { sekme, oner, oneri } = await searchParams;
  const { supabase, user } = await requireUser();

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, kind, city, district, color, description, is_temporary, archived_at")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) notFound();
  const isTeam = group.kind === "team";
  const labels = ROLE_LABEL[group.kind as GroupKind];

  await finalizeExpired(groupId);
  // Günü geçen açık çağrılar kapanır (cron yok; sayfa açılışında)
  await supabase.rpc("close_stale_polls", { p_group: groupId });

  const [players, { data: matches }, { data: inviteCode }, { data: unread }] = await Promise.all([
    getGroupSummaries(supabase, groupId),
    supabase
      .from("matches")
      .select("id, played_at, venue, status, score_a, score_b, kind, opponent_name, time_tbd, capacity, roster_count, match_players(count)")
      .eq("group_id", groupId)
      .order("played_at", { ascending: false })
      .limit(50),
    supabase.rpc("group_invite_code", { p_group_id: groupId }),
    supabase.rpc("unread_counts"),
  ]);
  const pendingOffers = isTeam && (await supabase.rpc("is_group_member", { p_group_id: groupId })).data
    ? ((await countIncoming(supabase, [groupId])).get(groupId) ?? 0)
    : 0;
  const unreadHere = ((unread ?? []) as { group_id: string; unread: number }[]).find((u) => u.group_id === groupId)?.unread ?? 0;

  const me = players.find((p) => p.user_id === user.id && !p.is_loan);
  const myRole = (me?.role ?? null) as Role | null;
  const canManage = myRole === "captain" || myRole === "admin";
  const canCreate = canCreateMatch(myRole) && !group.archived_at;
  // Öneriler (RLS: kendi önerim veya maç açabiliyorsam hepsi) ve sessize alma durumu
  const [{ data: proposalRows }, { data: myRow }] = me
    ? await Promise.all([
        supabase.from("match_proposals").select("id, proposed_by, play_on, starts_at, venue, note").eq("group_id", groupId).eq("status", "pending").order("created_at"),
        supabase.from("group_players").select("muted").eq("group_id", groupId).eq("user_id", user.id).is("left_at", null).maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];
  const proposals = (proposalRows ?? []) as Proposal[];
  // Başka grupların bu gruba gönderdiği, kaptan/yetkili onayı bekleyen ilanlar (0043/0044; tam sayfa: Parça 6)
  const pendingListings = canManage
    ? (((await supabase.rpc("pending_requests", { p_group: groupId })).data as { listings?: PendingListing[] } | null)?.listings ?? [])
    : [];
  const nameOf = new Map(players.filter((p) => p.user_id).map((p) => [p.user_id as string, p.display_name]));
  // Asıl kadro hesabı olan üyelerdir; misafirler ayrı sekmede (istatistikleri orada görünür)
  const members = players.filter(isSquadMember);
  const guests = players.filter(isGuestLike);
  const tab = sekme === "misafir" && guests.length > 0 ? "misafir" : "kadro";
  const ranked = [...members].sort(byRanking);
  const guestRanked = [...guests].sort(byRanking);
  // İptal edilen ve sonuçsuz kapanan maçlar listelenmez (maç ekranında durur)
  const active = (matches ?? []).filter((m) => m.status in STATUS && m.status !== "closed");
  const recent = (matches ?? []).filter((m) => m.status === "closed").slice(0, 8);
  const rating = teamRating(members.map((p) => p.overall));

  // Takımın rakiplere karşı karnesi
  const ext = (matches ?? []).filter((m) => m.status === "closed" && m.kind === "external");
  const record = {
    w: ext.filter((m) => (m.score_a ?? 0) > (m.score_b ?? 0)).length,
    d: ext.filter((m) => (m.score_a ?? 0) === (m.score_b ?? 0)).length,
    l: ext.filter((m) => (m.score_a ?? 0) < (m.score_b ?? 0)).length,
  };
  const staff = players.filter((p) => p.role !== "member").sort((a, b) => (a.role === "captain" ? -1 : b.role === "captain" ? 1 : 0));

  const leader = (key: "goals" | "assists" | "mvps") =>
    members
      .map((p) => ({ p, v: p.totals[key] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)[0];
  const leaders = [
    { label: "Gol kralı", icon: "sports_soccer", x: leader("goals") },
    { label: "Asist kralı", icon: "target", x: leader("assists") },
    { label: "En çok MVP", icon: "star", x: leader("mvps") },
  ].filter((l) => l.x);
  const accounts = players.filter((p) => p.user_id);
  const guestCount = players.length - accounts.length;

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "matches", filter: `group_id=eq.${groupId}` },
          { table: "group_players", filter: `group_id=eq.${groupId}` },
          ...(isTeam
            ? [
                { table: "match_challenges", filter: `to_group_id=eq.${groupId}` },
                { table: "match_challenges", filter: `from_group_id=eq.${groupId}` },
              ]
            : []),
        ]}
      />
      <Header
        title=""
        back="/"
        right={
          canManage ? (
            <LinkButton href={`/g/${groupId}/players`} variant="ghost" aria-label="Yönet" className="min-h-10 gap-1 px-3">
              <Icon name="settings" className="text-[18px]" />
              Yönet
            </LinkButton>
          ) : undefined
        }
      />

      {isTeam && (
        <TeamStateBanner groupId={groupId} archived={!!group.archived_at} temporary={!!group.is_temporary} isCaptain={myRole === "captain"} />
      )}

      {/* Üst bilgi kartı (profildeki başlık dili) */}
      <section className="-mt-2 mb-4 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-primary/10 via-surface-container to-surface-container p-4 shadow-md">
        <div className="flex items-center gap-4">
          <TeamBadge name={group.name} color={group.color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="t-label-caps flex items-center gap-1 uppercase text-primary">
              <Icon name={isTeam ? "shield" : "groups"} fill className="text-[14px]" />
              {isTeam ? "Takım" : "Topluluk"}
            </div>
            <h1 className="line-clamp-2 break-words font-display text-2xl font-bold leading-7">{group.name}</h1>
            <div className="flex items-start gap-1 text-xs text-on-surface-variant">
              {group.city && <Icon name="location_on" className="text-[14px]" />}
              <span>
                {group.city && `${formatRegion(group.city, group.district)} · `}
                {members.length} {isTeam ? "oyuncu" : "üye"}
                {myRole && ` · Sen: ${labels[myRole]}`}
              </span>
            </div>
          </div>
          {isTeam && (
            <div className="flex flex-col items-center rounded-xl bg-surface-high px-2.5 py-1.5">
              <span className="font-display text-[9px] font-bold tracking-wider text-on-surface-variant">PUAN</span>
              <span className="font-display text-2xl font-bold leading-7 tabular-nums">{rating}</span>
            </div>
          )}
        </div>
        {group.description && <p className="mt-3 text-sm text-on-surface-variant">{group.description}</p>}
        {!isTeam && (
          <Link href={`/g/${groupId}/players`} className="mt-3 flex items-center gap-3">
            <div className="flex -space-x-2">
              {accounts.slice(0, 8).map((p) => (
                <Avatar key={p.id} name={p.display_name} photoUrl={p.photo_url} title={p.display_name} className="h-9 w-9 border-2 border-surface-container bg-surface-highest text-[11px]" />
              ))}
            </div>
            <span className="flex items-center text-sm text-on-surface-variant">
              {accounts.length} üye
              {guestCount > 0 && ` · ${guestCount} misafir`}
              <Icon name="chevron_right" className="text-[18px]" />
            </span>
          </Link>
        )}
      </section>

      {isTeam && (
        <Link href={`/g/${groupId}/istatistik`} className="mb-4 block">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { v: record.w + record.d + record.l, l: "Maç" },
              { v: record.w, l: "Galibiyet", c: "text-primary" },
              { v: record.d, l: "Beraberlik" },
              { v: record.l, l: "Mağlubiyet", c: "text-error" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl bg-surface-container p-2 shadow-sm">
                <div className={cx("t-stat-md", x.c)}>{x.v}</div>
                <div className="text-[10px] text-on-surface-variant">{x.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-end text-[11px] font-semibold text-primary">
            Tüm istatistikler
            <Icon name="chevron_right" className="text-[16px]" />
          </div>
        </Link>
      )}

      {isTeam && !me && !group.archived_at && (
        <LinkButton href={`/g/${groupId}/teklif`} className="mb-2 w-full">
          <Icon name="handshake" className="text-[20px]" />
          Maç teklif et
        </LinkButton>
      )}
      {isTeam && !me && (() => {
        const captain = players.find((p) => p.role === "captain" && isSquadMember(p));
        return captain?.user_id ? (
          <form action={openDm} className="mb-2">
            <input type="hidden" name="userId" value={captain.user_id} />
            <Button variant="secondary" className="w-full">
              <Icon name="chat" className="text-[20px]" />
              Kaptana mesaj yaz
            </Button>
          </form>
        ) : null;
      })()}

      {pendingListings.length > 0 && (
        <section id="bekleyen-ilanlar" className="mb-4 space-y-2">
          <SectionTitle>Onay bekleyen ilanlar · {pendingListings.length}</SectionTitle>
          {pendingListings.map((l) => (
            <Card key={l.id} className="space-y-2">
              <div className="text-sm">
                <b>{l.group_name}</b> maçı için adam arıyor · {matchWhen(l.played_at, l.time_tbd)}
                {l.venue ? ` · ${l.venue}` : ""}
              </div>
              <div className="text-xs text-muted">
                Paylaşan: {l.by ?? "bir üye"} · kadro {l.roster_count}/{l.capacity ?? "?"}
                {l.note ? ` · "${l.note}"` : ""}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["1", "0"] as const).map((a) => (
                  <form key={a} action={decideListing}>
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="listingId" value={l.id} />
                    <input type="hidden" name="accept" value={a} />
                    <SubmitButton variant={a === "1" ? "primary" : "secondary"} className="w-full" pendingLabel="…">
                      {a === "1" ? "Grupta yayınla" : "Reddet"}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </Card>
          ))}
        </section>
      )}

      {canCreate && (
        <LinkButton href={`/mac-ayarla?grup=${groupId}`} className="mb-2 w-full">
          <Icon name="sports_soccer" className="text-[20px]" />
          Maç ayarla
        </LinkButton>
      )}

      {/* Kısayollar: sohbet, teklifler, kadro, oyuncular */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        {me && (
          <Tile href={`/g/${groupId}/sohbet`} icon="forum" label={isTeam ? "Takım sohbeti" : "Grup sohbeti"} badge={unreadHere > 0 ? `${unreadHere > 99 ? "99+" : unreadHere} yeni` : undefined} />
        )}
        {isTeam && me && <Tile href={`/g/${groupId}/teklifler`} icon="handshake" label="Maç teklifleri" badge={pendingOffers > 0 ? `${pendingOffers} yeni` : undefined} warn />}
        <Tile href={`/g/${groupId}/kadro`} icon="style" label={isTeam ? "Kadro" : "Üye kartları"} />
        <Tile href={`/g/${groupId}/players`} icon="group" label={isTeam ? "Oyuncular" : "Üyeler"} />
      </div>

      {me && <MuteToggle groupId={groupId} muted={!!myRow?.muted} />}
      <Proposals
        groupId={groupId}
        canCreate={canCreate}
        isMember={!!me && !group.archived_at}
        proposals={proposals}
        names={nameOf}
        userId={user.id}
        openForm={!!oner}
        sent={oneri === "gonderildi"}
      />

      {!me && isTeam && (
        <p className="mt-3 text-center text-xs text-on-surface-variant">
          Bu takımın oyuncusu değilsin. Katılmak için kaptandan davet linki iste.
        </p>
      )}
      {me && !canCreate && (
        <p className="mt-2 text-center text-xs text-on-surface-variant">
          Maçları ve maç çağrılarını {labels.captain.toLocaleLowerCase("tr")}, yetkililer ve organizatörler açar.
        </p>
      )}

      {staff.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {staff.map((p) => (
            <Link key={p.id} href={`/g/${groupId}/p/${p.id}`}>
              <Badge tone={p.role === "captain" ? "warn" : "default"}>
                {p.role === "captain" && <Icon name={isTeam ? "military_tech" : "star"} fill className="text-[14px]" />}
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
                <Link href={`/g/${groupId}/m/${m.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface-container p-3 transition hover:border-primary/50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-highest text-on-surface-variant">
                    <Icon name="sports_soccer" className="text-[22px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {m.kind === "external" ? (m.opponent_name ? `vs ${m.opponent_name}` : "Rakip belli değil") : m.time_tbd ? matchWhen(m.played_at, true) : formatDate(m.played_at)}
                    </div>
                    <div className="truncate text-xs text-on-surface-variant">
                      {m.kind === "external" && `${m.time_tbd ? matchWhen(m.played_at, true) : formatDate(m.played_at)} · `}
                      {m.venue ?? "Saha belirtilmedi"} ·{" "}
                      {m.capacity ? `${m.roster_count}/${m.capacity} kadro` : `${m.match_players[0]?.count ?? 0} oyuncu`}
                    </div>
                  </div>
                  <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle
        action={
          tab === "kadro" && !isTeam && ranked.length > 5 ? (
            <Link href={`/g/${groupId}/kadro`} className="flex items-center text-sm font-semibold text-primary">
              Tümü
              <Icon name="chevron_right" className="text-[18px]" />
            </Link>
          ) : undefined
        }
      >
        {tab === "misafir" ? "Misafir oyuncular" : isTeam ? "Kadro sıralaması" : "Topluluk sıralaması"}
      </SectionTitle>
      <RosterTabs base={`/g/${groupId}`} active={tab} members={members.length} guests={guests.length} memberLabel={isTeam ? "Kadro" : "Üyeler"} />
      <Card className="p-0">
        <ol className="divide-y divide-line">
          {(tab === "misafir" ? guestRanked : isTeam ? ranked : ranked.slice(0, 5)).map((p, i) => {
            const s = p.totals;
            return (
              <li key={p.id}>
                <Link href={`/g/${groupId}/p/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-high">
                  <span className={cx("w-5 text-right font-display text-sm font-bold tabular-nums", i < 3 ? "text-gold-1" : "text-on-surface-variant")}>{i + 1}</span>
                  <OvrBadge overall={p.overall} className={p.matches_played === 0 ? "opacity-50" : ""} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {p.display_name}
                      {!isSquadMember(p) && <span className="ml-2 text-xs text-on-surface-variant">{p.is_loan ? "ödünç" : "misafir"}</span>}
                    </div>
                    <div className="flex items-center text-xs text-on-surface-variant">
                      {p.position ? POSITION_LABEL[p.position] + " · " : ""}
                      {s.played} maç · {s.goals} gol · {s.assists} asist
                      {s.mvps > 0 && (
                        <>
                          {" · "}
                          {s.mvps}
                          <Icon name="star" fill className="text-[13px] text-gold-1" />
                        </>
                      )}
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
            <div key={l.label} className="rounded-xl bg-surface-container p-3 text-center shadow-sm">
              <Icon name={l.icon} fill className="text-[22px] text-gold-1" />
              <div className="mt-1 truncate text-sm font-semibold">{l.x!.p.display_name}</div>
              <div className="text-xs text-on-surface-variant">
                {l.label} · {l.x!.v}
              </div>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle>Son maçlar</SectionTitle>
          <ul className="space-y-2">
            {recent.map((m) => (
              <li key={m.id}>
                <Link href={`/g/${groupId}/m/${m.id}`} className="flex items-center justify-between rounded-xl border border-line bg-surface-container px-4 py-3 transition hover:border-primary/50">
                  <div className="min-w-0 text-sm">
                    <div className="truncate">{m.kind === "external" ? `vs ${m.opponent_name}` : "Kendi aramızda"}</div>
                    <div className="truncate text-xs text-on-surface-variant">
                      {formatDate(m.played_at)}
                      {m.venue ? ` · ${m.venue}` : ""}
                    </div>
                  </div>
                  {m.kind === "external" ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cx(
                          "rounded-md px-1.5 py-0.5 font-display text-xs font-bold",
                          (m.score_a ?? 0) > (m.score_b ?? 0)
                            ? "bg-primary/20 text-primary"
                            : (m.score_a ?? 0) < (m.score_b ?? 0)
                              ? "bg-error/20 text-error"
                              : "bg-surface-highest text-on-surface-variant",
                        )}
                      >
                        {(m.score_a ?? 0) > (m.score_b ?? 0) ? "G" : (m.score_a ?? 0) < (m.score_b ?? 0) ? "M" : "B"}
                      </span>
                      <span className="font-display text-lg font-bold tabular-nums">
                        {m.score_a} - {m.score_b}
                      </span>
                    </div>
                  ) : (
                    <div className="shrink-0 font-display text-lg font-bold tabular-nums">
                      <span className="text-team-a">{m.score_a}</span>
                      <span className="mx-1 text-on-surface-variant">-</span>
                      <span className="text-team-b">{m.score_b}</span>
                    </div>
                  )}
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
            <InviteLink code={inviteCode} groupName={group.name} isTeam={isTeam} />
            {canManage && (
              <form action={regenerateInvite} className="text-right">
                <input type="hidden" name="groupId" value={groupId} />
                <button className="text-xs text-on-surface-variant hover:text-on-surface" title="Eski kod ve link çalışmaz olur">
                  Yeni kod oluştur
                </button>
              </form>
            )}
          </Card>
        </>
      )}
    </main>
  );
}

/** Grup sayfası kısayol kutucuğu: ikon, ad, varsa "n yeni" rozeti */
function Tile({ href, icon, label, badge, warn }: { href: string; icon: string; label: string; badge?: string; warn?: boolean }) {
  return (
    <Link href={href} className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-surface-container px-3 py-2.5 transition hover:border-primary/50">
      <Icon name={icon} className="shrink-0 text-[20px] text-primary" />
      <span className="min-w-0 flex-1 text-sm font-semibold leading-tight">{label}</span>
      {badge && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", warn ? "bg-amber-400 text-pitch-950" : "bg-primary text-on-primary")}>{badge}</span>}
    </Link>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, SectionTitle, cx } from "@/components/ui";
import { PlayerCard, PositionChip } from "@/components/PlayerCard";
import { SkillBars } from "@/components/SkillBars";
import { RadarChart } from "./RadarChart";
import { ShareButton } from "./ShareButton";
import { MatchesList } from "./MatchesList";
import { FlipCard } from "./FlipCard";
import { computeBadges, type Badge as BadgeInfo } from "@/lib/badges";
import type { UpcomingMatch } from "@/lib/profile-data";
import { TeamBadge } from "@/components/TeamBadge";
import { FOOT_NAME, POSITION_NAME, formatDate, type Position } from "@/lib/data";
import { formatRegion } from "@/lib/regions";
import { cardSkills } from "@/lib/skills";
import { reliability } from "@/lib/reliability";
import { computeProfileStats, streakText, type Outcome, type ProfileMatch } from "@/lib/profile-stats";
import type { Person } from "@/lib/profile-data";

export type ProfileTab = "genel" | "istatistik" | "maclar" | "ayarlar";

const TAB_LABEL: Record<ProfileTab, string> = { genel: "Genel", istatistik: "İstatistik", maclar: "Maçlar", ayarlar: "Ayarlar" };

export function parseTab(raw: string | undefined, isMe: boolean): ProfileTab {
  const t = (raw ?? "genel") as ProfileTab;
  if (t === "ayarlar") return isMe ? "ayarlar" : "genel";
  return t in TAB_LABEL ? t : "genel";
}

function Tabs({ base, active, isMe }: { base: string; active: ProfileTab; isMe: boolean }) {
  const tabs: ProfileTab[] = isMe ? ["genel", "istatistik", "maclar", "ayarlar"] : ["genel", "istatistik", "maclar"];
  return (
    <div className="mb-4 flex gap-1 rounded-full border border-line bg-surface-container p-1" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t}
          href={t === "genel" ? base : `${base}?sekme=${t}`}
          replace
          role="tab"
          aria-selected={active === t}
          className={cx(
            "min-w-0 flex-1 truncate rounded-full px-2 py-2 text-center font-display text-xs font-bold uppercase tracking-wide transition",
            active === t ? "bg-accent text-on-primary shadow-[0_0_16px_rgba(75,226,119,0.35)]" : "text-on-surface-variant hover:bg-surface-high",
          )}
        >
          {TAB_LABEL[t]}
        </Link>
      ))}
    </div>
  );
}

const outcomeStyle: Record<Outcome, string> = {
  win: "bg-accent/20 text-accent",
  draw: "bg-tertiary/20 text-tertiary",
  loss: "bg-error-container/60 text-error",
};
const outcomeLetter: Record<Outcome, string> = { win: "G", draw: "B", loss: "M" };

function ResultChip({ outcome, className }: { outcome: Outcome; className?: string }) {
  return (
    <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", outcomeStyle[outcome], className)}>
      {outcomeLetter[outcome]}
    </span>
  );
}

const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : "–");

// ---------------------------------------------------------------------------
// Genel
// ---------------------------------------------------------------------------

/** Kartın arka yüzü: özet istatistikler */
function CardBack({ person, stats }: { person: Person; stats: ReturnType<typeof computeProfileStats> | null }) {
  const p = person.profile;
  const t = stats?.totals;
  const tiles = [
    { label: "Gol", value: t ? t.goals : "–" },
    { label: "Asist", value: t ? t.assists : "–" },
    { label: "Maç", value: t ? t.played : "–" },
    { label: "MVP", value: t ? t.mvps : "–" },
  ];
  return (
    <div className="flex aspect-[640/925] w-full flex-col justify-center gap-3 rounded-[8%] border border-white/20 bg-gradient-to-b from-surface-high to-surface p-5 shadow-[0_0_30px_rgba(75,226,119,0.12)]">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">Sezon · {person.overall} OVR</div>
        <div className="mt-0.5 truncate font-display text-lg font-bold">{p.cardName || p.displayName}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl bg-white/5 py-2 text-center">
            <div className="font-display text-xl font-bold tabular-nums">{x.value}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted">{x.label}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 py-2 text-center text-[10px]">
        <div><div className="text-muted">AYAK</div><b>{p.foot ? FOOT_NAME[p.foot] : "–"}</b></div>
        <div><div className="text-muted">FORMA</div><b>{p.shirt ? `#${p.shirt}` : "–"}</b></div>
        <div><div className="text-muted">KAZANMA</div><b>{t && t.played ? pct(t.wins, t.played) : "–"}</b></div>
      </div>
      {stats && stats.form.length > 0 && (
        <div className="flex items-center justify-center gap-1.5">
          {stats.form.map((o, i) => (
            <ResultChip key={i} outcome={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function UpcomingCard({ u, compact }: { u: UpcomingMatch; compact?: boolean }) {
  const when = new Date(u.playedAt);
  const day = when.toLocaleDateString("tr-TR", { weekday: "long", timeZone: "Europe/Istanbul" });
  const time = when.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
  const title = u.kind === "external" ? `${u.groupName} - ${u.opponentName ?? "Rakip"}` : `${u.groupName} · kendi aramızda`;
  return (
    <Link href={`/g/${u.groupId}/m/${u.matchId}`} className="block rounded-2xl border border-line bg-surface-container p-4 hover:brightness-110">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display font-bold">{title}</div>
          <div className="truncate text-xs text-muted">
            {u.venue ? `${u.venue} · ` : ""}
            {formatDate(u.playedAt)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted">{day}</div>
          <div className="rounded-lg bg-black/30 px-2 py-1 font-display text-lg font-bold tabular-nums">{time}</div>
        </div>
      </div>
      {!compact && <div className="mt-3 rounded-full bg-accent py-2.5 text-center text-sm font-bold text-on-primary">Maç detayı ve kadro</div>}
    </Link>
  );
}

function BadgeGrid({ badges }: { badges: BadgeInfo[] }) {
  const tone: Record<BadgeInfo["tone"], string> = {
    green: "from-green-700 to-green-900",
    blue: "from-sky-600 to-sky-900",
    teal: "from-teal-600 to-teal-900",
    gold: "from-amber-500 to-amber-800",
  };
  return (
    <>
      <SectionTitle action={<span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">{badges.length} rozet</span>}>
        Kazanılan rozetler
      </SectionTitle>
      <Card className="space-y-2">
        {badges.map((b) => (
          <div key={b.id} className="flex items-center gap-3 rounded-xl bg-surface-low p-3">
            <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xl", tone[b.tone])}>{b.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-bold">{b.title}</div>
              <div className="text-xs text-on-surface-variant">{b.description}</div>
            </div>
            <span className="shrink-0 text-right text-[10px] font-bold uppercase text-accent">{b.value}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

function GeneralPanel({
  person,
  isMe,
  stats,
  noShows,
  upcoming,
}: {
  person: Person;
  isMe: boolean;
  stats: ReturnType<typeof computeProfileStats> | null;
  noShows: number | null;
  upcoming: UpcomingMatch[];
}) {
  const p = person.profile;
  const keeper = p.position === "GK";
  const team = person.groups.find((g) => g.kind === "team" && !g.isLoan && !g.left);
  const rel = stats && noShows !== null ? reliability(stats.totals.played, noShows) : null;
  const mostPlayed = stats?.byPosition[0];
  // Başkasının profilinde sadece herkese açık takımlar görünür; özel topluluklar gizli kalır
  const shownGroups = person.groups.filter((g) => !g.isLoan && !g.left && (isMe || g.kind === "team"));

  const facts = [
    p.city ? { label: "Bölge", value: formatRegion(p.city, p.district) } : null,
    p.position ? { label: "Ana mevki", value: POSITION_NAME[p.position] } : null,
    p.secondary.length ? { label: "Diğer mevkiler", value: p.secondary.map((x) => POSITION_NAME[x]).join(", ") } : null,
    p.foot ? { label: "Ayak", value: FOOT_NAME[p.foot] } : null,
    p.shirt ? { label: "Forma", value: `#${p.shirt}` } : null,
    mostPlayed ? { label: "En çok oynadığı", value: `${POSITION_NAME[mostPlayed.position as Position] ?? mostPlayed.position} (${mostPlayed.count} maç)` } : null,
  ].filter((x): x is { label: string; value: string } => !!x);

  return (
    <>
      <FlipCard
        back={<CardBack person={person} stats={stats} />}
        front={
      <PlayerCard
        name={p.displayName}
        cardName={p.cardName}
        photoUrl={p.photoUrl}
        overall={person.overall}
        position={p.position}
        shirtNumber={p.shirt}
        skills={cardSkills(person.skills, keeper)}
        city={p.city}
        district={p.district}
        team={team ? { name: team.name, color: team.color } : null}
        unrated={person.matchesPlayed === 0}
        provisional={person.matchesPlayed > 0 && person.confidence < 0.6}
      />
        }
      />
      <p className="mt-2 text-center text-xs text-muted">
        {formatRegion(p.city, p.district)}
        {p.city ? " · " : ""}Rating tüm grup ve takımlardaki maçlardan tek hesaplanır.
      </p>
      {rel && (
        <div className="mt-3 flex justify-center">
          <Badge tone={rel.tone === "good" ? "accent" : rel.tone === "bad" ? "warn" : "default"}>{rel.label}</Badge>
        </div>
      )}
      {p.bio && <p className="mt-3 text-center text-sm italic text-muted">“{p.bio}”</p>}

      {stats && stats.totals.played > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            { label: "Maç", value: stats.totals.played },
            { label: "Gol", value: stats.totals.goals },
            { label: "Asist", value: stats.totals.assists },
            { label: "Galibiyet", value: pct(stats.totals.wins, stats.totals.played) },
          ].map((x) => (
            <div key={x.label} className="rounded-2xl border border-line bg-surface-container px-1 py-3">
              <div className="font-display text-xl font-bold tabular-nums">{x.value}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted">{x.label}</div>
            </div>
          ))}
        </div>
      )}
      {stats && stats.form.length > 0 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Son {stats.form.length} maç</span>
          {stats.form.map((o, i) => (
            <ResultChip key={i} outcome={o} className="h-8 w-8 text-sm" />
          ))}
        </div>
      )}
      <div className="mt-4">
        <ShareButton path={`/oyuncu/${p.id}`} title={`${p.displayName} · Halısaha kartı`} />
      </div>

      <SectionTitle
        action={
          isMe ? (
            <Link href="/yetenek" className="text-xs text-accent underline">
              Arkadaşlarını puanla
            </Link>
          ) : undefined
        }
      >
        Yetenekler
      </SectionTitle>
      <Card className="space-y-3">
        <SkillBars skills={cardSkills(person.skills, keeper)} keeper={keeper} />
        <p className="text-[11px] text-muted">
          Birlikte en az 2 maç oynayanlar 1-10 puanlar; kimin ne verdiği görünmez. En az 2 farklı kişi puan verince değer görünür.
        </p>
      </Card>

      {facts.length > 0 && (
        <>
          <SectionTitle>Oyuncu bilgisi</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {facts.map((f) => (
              <div key={f.label} className="rounded-2xl border border-line bg-surface-container p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{f.label}</div>
                <div className="mt-1 text-sm font-bold leading-snug">{f.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {isMe && upcoming.length > 0 && (
        <>
          <SectionTitle>Planlanmış maçlar</SectionTitle>
          <div className="space-y-2">
            {upcoming.slice(0, 3).map((u) => (
              <UpcomingCard key={u.matchId} u={u} compact />
            ))}
          </div>
        </>
      )}

      {shownGroups.length > 0 && (
        <>
          <SectionTitle>{isMe ? "Takımlarım ve gruplarım" : "Takımları"}</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {shownGroups.map((g) => (
                <li key={g.groupId}>
                  <Link href={`/g/${g.groupId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-pitch-800">
                    <TeamBadge name={g.name} color={g.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="text-xs text-muted">{g.kind === "team" ? "Takım" : "Grup"} ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// İstatistik
// ---------------------------------------------------------------------------

function SplitRow({ label, s }: { label: string; s: { played: number; wins: number; draws: number; losses: number } }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="text-right tabular-nums">
        {s.played} maç · <b className="text-accent">{s.wins}</b>G <b>{s.draws}</b>B <b className="text-red-300">{s.losses}</b>M · {pct(s.wins, s.played)}
      </span>
    </div>
  );
}

function StatsPanel({ person, stats, noShows, isMe, allMatches }: { person: Person; stats: ReturnType<typeof computeProfileStats>; noShows: number; isMe: boolean; allMatches: ProfileMatch[] }) {
  const t = stats.totals;
  const keeper = person.profile.position === "GK";
  const rel = reliability(t.played, noShows);
  const streak = streakText(stats.streak);
  const badges = computeBadges(allMatches, noShows);

  if (t.played === 0) {
    return (
      <Card className="text-center text-sm text-muted">
        {isMe ? "Henüz sonucu girilmiş maçın yok." : "Henüz sonucu girilmiş maçı yok."} İlk maçtan sonra gol, asist, galibiyet ve form burada görünür.
      </Card>
    );
  }

  const tiles = [
    { label: "Maç", value: t.played },
    { label: "Gol", value: t.goals },
    { label: "Asist", value: t.assists },
    keeper ? { label: "Kurtarış", value: t.saves } : { label: "Gol+Asist", value: t.goals + t.assists },
    { label: "MVP", value: t.mvps },
    { label: "Galibiyet", value: pct(t.wins, t.played) },
  ];

  return (
    <>
      <SectionTitle>Performans dağılımı</SectionTitle>
      <Card>
        <RadarChart skills={cardSkills(person.skills, keeper)} keeper={keeper} />
        {t.mvps > 0 && (
          <p className="mt-2 text-center text-xs text-muted">
            Maçın adamı: <b className="text-accent">{t.mvps} kez MVP</b>
          </p>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {tiles.map((x) => (
          <Card key={x.label} className="p-3 text-center">
            <div className="font-display text-2xl font-bold tabular-nums">{x.value}</div>
            <div className="text-xs text-muted">{x.label}</div>
          </Card>
        ))}
      </div>
      <Card className="mt-2 flex items-center justify-around py-3 text-sm">
        <span><b className="text-accent">{t.wins}</b> <span className="text-muted">G</span></span>
        <span><b>{t.draws}</b> <span className="text-muted">B</span></span>
        <span><b className="text-red-300">{t.losses}</b> <span className="text-muted">M</span></span>
      </Card>

      <SectionTitle>Form ve performans</SectionTitle>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {stats.form.map((o, i) => (
              <ResultChip key={i} outcome={o} className="h-9 w-9 text-sm" />
            ))}
          </div>
          <div className="text-right">
            <div className="text-2xl font-black tabular-nums">{stats.avgScore !== null ? stats.avgScore.toFixed(1) : "–"}</div>
            <div className="text-[10px] text-muted">ortalama maç puanı</div>
          </div>
        </div>
        {streak && <p className="mt-3 text-sm text-accent">🔥 {streak}</p>}
        {stats.recentScores.length > 0 && (
          <div className="mt-4 flex h-28 items-end justify-around gap-1.5">
            {stats.recentScores.map((f) => (
              <div key={f.matchId} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold tabular-nums">{f.score.toFixed(1)}</span>
                <div
                  className={cx("w-full max-w-8 rounded-t-md", f.score >= 7.5 ? "bg-accent" : f.score >= 5.5 ? "bg-accent/50" : "bg-red-400/60")}
                  style={{ height: `${Math.max(6, f.score * 7)}px` }}
                />
                <span className="text-[9px] text-muted">
                  {new Date(f.playedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "numeric", timeZone: "Europe/Istanbul" })}
                </span>
              </div>
            ))}
          </div>
        )}
        {stats.recentScores.length > 0 && <p className="mt-2 text-center text-[11px] text-muted">Son {stats.recentScores.length} puanlı maç</p>}
      </Card>

      <SectionTitle>Ortalamalar</SectionTitle>
      <Card className="p-0">
        <dl className="divide-y divide-line text-sm">
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Maç başına gol</dt><dd className="font-medium tabular-nums">{stats.goalsPerMatch!.toFixed(2)}</dd></div>
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Maç başına asist</dt><dd className="font-medium tabular-nums">{stats.assistsPerMatch!.toFixed(2)}</dd></div>
          <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Maçın adamı oranı</dt><dd className="font-medium tabular-nums">%{stats.mvpRate}</dd></div>
          {stats.best && (
            <div className="flex justify-between gap-4 px-4 py-2.5">
              <dt className="text-muted">En iyi maçı</dt>
              <dd className="text-right font-medium">{stats.best.matchScore!.toFixed(1)} · {formatDate(stats.best.playedAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <SectionTitle>Rakibe karşı / kendi aramızda</SectionTitle>
      <Card className="p-0">
        <div className="divide-y divide-line">
          <SplitRow label="Rakip takıma karşı" s={stats.external} />
          <SplitRow label="Kendi aramızda" s={stats.internal} />
        </div>
      </Card>

      {stats.byGroup.length > 0 && (
        <>
          <SectionTitle>Takım ve gruplara göre</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {stats.byGroup.map((g) => (
                <li key={g.groupId} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{g.name}</span>
                    <span className="shrink-0 text-xs text-muted">{g.kind === "team" ? "Takım" : "Grup"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted tabular-nums">
                    {g.played} maç · {g.wins}G {g.draws}B {g.losses}M
                    {g.goals > 0 && ` · ${g.goals} gol`}
                    {g.assists > 0 && ` · ${g.assists} asist`}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {stats.byPosition.length > 0 && (
        <>
          <SectionTitle>Oynadığı mevkiler</SectionTitle>
          <Card className="flex flex-wrap gap-2">
            {stats.byPosition.map((x) => (
              <span key={x.position} className="inline-flex items-center gap-1.5 text-sm">
                <PositionChip position={x.position as Position} />
                <b className="tabular-nums">{x.count}</b> maç
              </span>
            ))}
          </Card>
        </>
      )}

      {badges.length > 0 && <BadgeGrid badges={badges} />}

      <SectionTitle>Güvenilirlik</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Oynadığı maç</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums text-accent">{rel.played}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Gelmediği maç</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums text-error">{rel.noShows}</div>
        </Card>
      </div>
      {rel.pct !== null && rel.tone !== "new" && (
        <p className="mt-2 text-center text-xs">
          <span className="rounded-full bg-accent/15 px-3 py-1 font-semibold text-accent">%{rel.pct} güven skoru</span>
        </p>
      )}
      <p className="mt-3 text-center text-[11px] text-muted">
        Sonucu girilmiş (oylamada veya kapanmış) tüm grup ve takım maçları sayılır. Gruplardaki maçlar rating&apos;e yarım etki eder.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Maçlar
// ---------------------------------------------------------------------------

function MatchesPanel({ matches, isMe, viewerGroups, upcoming }: { matches: ProfileMatch[]; isMe: boolean; viewerGroups: Set<string>; upcoming: UpcomingMatch[] }) {
  return (
    <>
      {isMe && upcoming.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider">
            <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
            Yaklaşan maç
          </div>
          <div className="mb-6 space-y-3">
            {upcoming.map((u) => (
              <UpcomingCard key={u.matchId} u={u} />
            ))}
          </div>
        </>
      )}
      {matches.length === 0 ? (
        <Card className="text-center text-sm text-muted">Henüz sonucu girilmiş maç yok.</Card>
      ) : (
        <MatchesList matches={matches} isMe={isMe} viewerGroups={[...viewerGroups]} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bütün
// ---------------------------------------------------------------------------

/** Sekmeli profil: kendi profilim (`/profil`) ve başkasının profili (`/oyuncu/[id]`) aynı bileşeni kullanır */
export function ProfileView({
  base,
  tab,
  person,
  isMe,
  stats,
  matches,
  noShows,
  viewerGroups,
  upcoming = [],
  settings,
}: {
  base: string;
  tab: ProfileTab;
  person: Person;
  isMe: boolean;
  /** İstatistikleri göremiyorsa null */
  stats: ReturnType<typeof computeProfileStats> | null;
  matches: ProfileMatch[] | null;
  noShows: number | null;
  viewerGroups: Set<string>;
  /** Yaklaşan maçlar (sadece kendi profilinde dolu) */
  upcoming?: UpcomingMatch[];
  /** Ayarlar sekmesi içeriği (sadece kendi profil) */
  settings?: ReactNode;
}) {
  const locked = stats === null || matches === null;
  return (
    <>
      <Tabs base={base} active={tab} isMe={isMe} />
      {tab === "genel" && <GeneralPanel person={person} isMe={isMe} stats={stats} noShows={noShows} upcoming={upcoming} />}
      {tab === "istatistik" &&
        (locked ? <LockedCard name={person.profile.displayName} /> : <StatsPanel person={person} stats={stats} noShows={noShows ?? 0} isMe={isMe} allMatches={matches ?? []} />)}
      {tab === "maclar" && (locked ? <LockedCard name={person.profile.displayName} /> : <MatchesPanel matches={matches} isMe={isMe} viewerGroups={viewerGroups} upcoming={upcoming} />)}
      {tab === "ayarlar" && isMe && settings}
    </>
  );
}

function LockedCard({ name }: { name: string }) {
  return (
    <Card className="text-center text-sm text-muted">
      <div className="text-3xl">🔒</div>
      <p className="mt-2">
        {name} istatistiklerini ve maç geçmişini sadece takım arkadaşlarına açık tutuyor. Kartı ve yetenekleri herkese görünür.
      </p>
    </Card>
  );
}

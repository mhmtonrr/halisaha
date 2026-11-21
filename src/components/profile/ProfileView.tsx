import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, SectionTitle, cx } from "@/components/ui";
import { PlayerCard, PositionChip } from "@/components/PlayerCard";
import { SkillBars } from "@/components/SkillBars";
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
    <div className="mb-4 flex gap-1 rounded-xl border border-line bg-pitch-900/80 p-1" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t}
          href={t === "genel" ? base : `${base}?sekme=${t}`}
          replace
          role="tab"
          aria-selected={active === t}
          className={cx(
            "min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-center text-sm font-semibold transition",
            active === t ? "bg-accent text-pitch-950" : "text-muted hover:bg-pitch-800",
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
  draw: "bg-pitch-700 text-muted",
  loss: "bg-red-400/20 text-red-300",
};
const outcomeLetter: Record<Outcome, string> = { win: "G", draw: "B", loss: "M" };

function ResultChip({ outcome, className }: { outcome: Outcome; className?: string }) {
  return (
    <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold", outcomeStyle[outcome], className)}>
      {outcomeLetter[outcome]}
    </span>
  );
}

const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : "–");

// ---------------------------------------------------------------------------
// Genel
// ---------------------------------------------------------------------------

function GeneralPanel({
  person,
  isMe,
  stats,
  noShows,
}: {
  person: Person;
  isMe: boolean;
  stats: ReturnType<typeof computeProfileStats> | null;
  noShows: number | null;
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
      <PlayerCard
        name={p.displayName}
        cardName={p.cardName}
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
          <Card className="p-0">
            <dl className="divide-y divide-line text-sm">
              {facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="text-right font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
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

function StatsPanel({ person, stats, noShows, isMe }: { person: Person; stats: ReturnType<typeof computeProfileStats>; noShows: number; isMe: boolean }) {
  const t = stats.totals;
  const keeper = person.profile.position === "GK";
  const rel = reliability(t.played, noShows);
  const streak = streakText(stats.streak);

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
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((x) => (
          <Card key={x.label} className="p-3 text-center">
            <div className="text-2xl font-black tabular-nums">{x.value}</div>
            <div className="text-xs text-muted">{x.label}</div>
          </Card>
        ))}
      </div>
      <Card className="mt-2 flex items-center justify-around py-3 text-sm">
        <span><b className="text-accent">{t.wins}</b> <span className="text-muted">G</span></span>
        <span><b>{t.draws}</b> <span className="text-muted">B</span></span>
        <span><b className="text-red-300">{t.losses}</b> <span className="text-muted">M</span></span>
      </Card>

      <SectionTitle>Form</SectionTitle>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {stats.form.map((o, i) => (
              <ResultChip key={i} outcome={o} className="h-8 w-8 text-sm" />
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

      <SectionTitle>Güvenilirlik</SectionTitle>
      <Card className="flex items-center justify-between text-sm">
        <span className="text-muted">Oynadığı / gelmediği maç</span>
        <span className="font-medium tabular-nums">
          {rel.played} / {rel.noShows}
          {rel.pct !== null && rel.tone !== "new" && <span className="ml-2 text-accent">%{rel.pct}</span>}
        </span>
      </Card>
      <p className="mt-3 text-center text-[11px] text-muted">
        Sonucu girilmiş (oylamada veya kapanmış) tüm grup ve takım maçları sayılır. Gruplardaki maçlar rating&apos;e yarım etki eder.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Maçlar
// ---------------------------------------------------------------------------

function MatchesPanel({ matches, isMe, viewerGroups }: { matches: ProfileMatch[]; isMe: boolean; viewerGroups: Set<string> }) {
  if (matches.length === 0) {
    return <Card className="text-center text-sm text-muted">Henüz sonucu girilmiş maç yok.</Card>;
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {matches.slice(0, 50).map((h) => {
          // Özel topluluğun adı sadece üyelerine (ve geçmişi kendisine) açık; maç ekranı sadece aktif üyelere; takımlar herkese açık
          const nameOpen = isMe || h.groupKind === "team" || viewerGroups.has(h.groupId);
          const open = h.groupKind === "team" || viewerGroups.has(h.groupId);
          const body = (
            <div className="flex items-center gap-3 px-4 py-3">
              <ResultChip outcome={h.outcome} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{h.kind === "external" ? `vs ${h.opponentName ?? "Rakip"}` : "Kendi aramızda"}</span>
                  <PositionChip position={h.position as Position | null} />
                  {h.mvp && "⭐"}
                </div>
                <div className="truncate text-xs text-muted">
                  {nameOpen ? h.groupName : "Özel grup"} · {formatDate(h.playedAt)}
                  {h.goals > 0 && ` · ${h.goals} gol`}
                  {h.assists > 0 && ` · ${h.assists} asist`}
                  {h.saves > 0 && ` · ${h.saves} kurtarış`}
                </div>
              </div>
              <div className="text-right">
                <div className="font-black tabular-nums">{h.scoreUs}-{h.scoreThem}</div>
                <div className="text-[10px] text-muted tabular-nums">
                  {h.status === "voting" ? "oylamada" : h.matchScore !== null && h.weight > 0 ? h.matchScore.toFixed(1) : "–"}
                </div>
              </div>
            </div>
          );
          return (
            <li key={`${h.matchId}`}>
              {open ? (
                <Link href={`/g/${h.groupId}/m/${h.matchId}`} className="block transition hover:bg-pitch-800">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </Card>
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
  /** Ayarlar sekmesi içeriği (sadece kendi profil) */
  settings?: ReactNode;
}) {
  const locked = stats === null || matches === null;
  return (
    <>
      <Tabs base={base} active={tab} isMe={isMe} />
      {tab === "genel" && <GeneralPanel person={person} isMe={isMe} stats={stats} noShows={noShows} />}
      {tab === "istatistik" &&
        (locked ? <LockedCard name={person.profile.displayName} /> : <StatsPanel person={person} stats={stats} noShows={noShows ?? 0} isMe={isMe} />)}
      {tab === "maclar" && (locked ? <LockedCard name={person.profile.displayName} /> : <MatchesPanel matches={matches} isMe={isMe} viewerGroups={viewerGroups} />)}
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
